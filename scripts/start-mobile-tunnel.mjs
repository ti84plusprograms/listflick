#!/usr/bin/env node

import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SCRIPT_DIR);
const MOBILE_DIR = join(ROOT, "mobile");
const EXPO_CLI = join(MOBILE_DIR, "node_modules", ".bin", "expo");
const DEFAULT_BENCHMARK_RUNS = 5;
const DEFAULT_REOPEN_RUNS = 5;
const REOPEN_MEDIAN_LIMIT_MS = 8_000;
const REOPEN_MAX_LIMIT_MS = 12_000;
const BENCHMARK_TIMEOUT_MS = 90_000;
const ANSI_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const BUNDLE_SERVED_PATTERN = /\b(iOS|Android|Web) Bundled\b/;
const USABLE_SCREEN_PATTERN = /\[AppStartup\] first_usable_screen\b/;
const MULTIPART_COMPRESSION_ENV = "LISTFLICK_METRO_COMPRESS_MULTIPART";

export const MILESTONES = [
  ["project_started", /Starting project at/],
  ["metro_started", /Starting Metro Bundler/],
  ["tunnel_connected", /Tunnel connected\./],
  ["tunnel_ready", /Tunnel ready\./],
  ["first_bundle_served", BUNDLE_SERVED_PATTERN],
  ["first_usable_screen", USABLE_SCREEN_PATTERN],
];

export function parseArgs(argv) {
  const options = {
    clear: false,
    measure: false,
    benchmarkRuns: 0,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--clear") {
      options.clear = true;
    } else if (argument === "--measure") {
      options.measure = true;
    } else if (argument === "--benchmark") {
      const rawRuns = argv[index + 1];
      if (rawRuns === undefined || rawRuns.startsWith("--")) {
        options.benchmarkRuns = DEFAULT_BENCHMARK_RUNS;
      } else {
        const runs = Number.parseInt(rawRuns, 10);
        if (!Number.isInteger(runs) || runs < 1 || runs > 20 || String(runs) !== rawRuns) {
          throw new Error("--benchmark must be followed by an integer from 1 to 20");
        }
        options.benchmarkRuns = runs;
        index += 1;
      }
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.measure && options.benchmarkRuns > 0) {
    throw new Error("Use either --measure or --benchmark, not both");
  }
  return options;
}

export function buildExpoArgs({ clear }) {
  const args = ["start", "--dev-client", "--tunnel"];
  if (clear) args.push("--clear");
  return args;
}

export function buildExpoEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    [MULTIPART_COMPRESSION_ENV]: "1",
  };
}

export function startupEventForLine(line) {
  const plainLine = line.replace(ANSI_PATTERN, "");
  if (BUNDLE_SERVED_PATTERN.test(plainLine)) return "bundle_served";
  if (USABLE_SCREEN_PATTERN.test(plainLine)) return "usable_screen";
  return null;
}

export function bundlePlatformForLine(line) {
  const match = line.replace(ANSI_PATTERN, "").match(BUNDLE_SERVED_PATTERN);
  return match?.[1]?.toLowerCase() ?? null;
}

export function milestoneForLine(line) {
  const plainLine = line.replace(ANSI_PATTERN, "");
  return MILESTONES.find(([, pattern]) => pattern.test(plainLine))?.[0] ?? null;
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function summarizeReopenMeasurements(
  durations,
  {
    targetRuns = DEFAULT_REOPEN_RUNS,
    medianLimitMs = REOPEN_MEDIAN_LIMIT_MS,
    maxLimitMs = REOPEN_MAX_LIMIT_MS,
  } = {}
) {
  const medianMs = median(durations);
  const maxMs = durations.length === 0 ? null : Math.max(...durations);
  const complete = durations.length === targetRuns;
  return {
    targetRuns,
    completedRuns: durations.length,
    durationsMs: [...durations],
    medianMs,
    maxMs,
    medianLimitMs,
    maxLimitMs,
    complete,
    passed: complete && medianMs <= medianLimitMs && maxMs <= maxLimitMs,
  };
}

export function createReopenMeasurementTracker(options = {}) {
  const targetRuns = options.targetRuns ?? DEFAULT_REOPEN_RUNS;
  const durations = [];
  let warmupComplete = false;

  return {
    record(durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new Error("Reopen duration must be a non-negative finite number");
      }
      if (!warmupComplete) {
        warmupComplete = true;
        return { kind: "warmup", durationMs };
      }
      if (durations.length >= targetRuns) {
        return { kind: "ignored", durationMs };
      }

      durations.push(durationMs);
      const summary = summarizeReopenMeasurements(durations, {
        ...options,
        targetRuns,
      });
      return {
        kind: "measurement",
        run: durations.length,
        durationMs,
        summary: summary.complete ? summary : null,
      };
    },
    snapshot() {
      return summarizeReopenMeasurements(durations, {
        ...options,
        targetRuns,
      });
    },
  };
}

function metricsPathForSession(startedAt) {
  const timestamp = startedAt.toISOString().replaceAll(":", "-");
  return join(MOBILE_DIR, ".metrics", `tunnel-reopen-${timestamp}.jsonl`);
}

export async function createJsonlRecorder(filePath, sessionRecord) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(sessionRecord)}\n`, { flag: "wx" });
  let writeQueue = Promise.resolve();

  return {
    filePath,
    append(record) {
      writeQueue = writeQueue.then(() => (
        appendFile(filePath, `${JSON.stringify(record)}\n`)
      ));
      return writeQueue;
    },
    flush() {
      return writeQueue;
    },
  };
}

export function failureCategoryForOutput(output) {
  const plainOutput = output.replace(ANSI_PATTERN, "");
  if (/ngrok tunnel took too long to connect/i.test(plainOutput)) {
    return "tunnel_provider_timeout";
  }
  if (/failed to start tunnel|remote gone away|status\.ngrok\.com/i.test(plainOutput)) {
    return "tunnel_provider_failure";
  }
  if (/Port \d+ is running this app in another window/i.test(plainOutput)) {
    return "local_port_in_use";
  }
  if (/Cannot find module|Expo CLI is not installed locally/i.test(plainOutput)) {
    return "missing_local_dependency";
  }
  return "expo_start_failed";
}

function elapsedMilliseconds(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function printUsage() {
  process.stdout.write(`Usage: node scripts/start-mobile-tunnel.mjs [options]

Options:
  --clear              clear Metro's cache before starting
  --measure            exclude one warm-up, persist five reopen runs, then summarize and exit
  --benchmark [runs]   measure tunnel-ready time, then exit; default ${DEFAULT_BENCHMARK_RUNS} runs
  -h, --help           show this help
`);
}

async function assertLocalExpoCli() {
  try {
    await access(EXPO_CLI, constants.X_OK);
  } catch {
    throw new Error(
      "Expo CLI is not installed locally. Run `make install-mobile` from the repository root."
    );
  }
}

function printLaunchSummary(options) {
  const mode = options.clear ? "clean" : "warm";
  const cache = options.clear ? "reset" : "reuse";
  process.stdout.write(`[TunnelStartup] mode=${mode} cache=${cache}\n`);
  process.stdout.write(
    `[TunnelStartup] cli=${relative(ROOT, EXPO_CLI)} target=development-client transport=tunnel\n`
  );
  process.stdout.write(
    "[TunnelStartup] multipart_bundle_compression=enabled scope=tunnel-only\n"
  );
  process.stdout.write(
    "[TunnelStartup] Metro tunnel only; EXPO_PUBLIC_API_URL must independently reach the backend.\n"
  );
}

function forwardSignal(child, signal) {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

function runInteractive(options) {
  printLaunchSummary(options);
  const child = spawn(EXPO_CLI, buildExpoArgs(options), {
    cwd: MOBILE_DIR,
    env: buildExpoEnv(),
    stdio: "inherit",
  });

  const onSigint = () => forwardSignal(child, "SIGINT");
  const onSigterm = () => forwardSignal(child, "SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function stopProcessGroup(child, signal = "SIGINT") {
  try {
    process.kill(-child.pid, signal);
  } catch {
    forwardSignal(child, signal);
  }
}

async function runMeasured(options, { stopAtTunnelReady }) {
  const sessionStartedAt = new Date();
  const startedAt = performance.now();
  const milestones = new Map();
  let combinedOutput = "";
  let pendingLine = "";
  let reachedTunnelReady = false;
  let timedOut = false;
  let timeout;
  let bundleSequence = 0;
  let pendingBundle = null;
  let measurementSummary = null;
  const measurementTracker = stopAtTunnelReady
    ? null
    : createReopenMeasurementTracker();
  const metricsRecorder = stopAtTunnelReady
    ? null
    : await createJsonlRecorder(metricsPathForSession(sessionStartedAt), {
      recordType: "session",
      schemaVersion: 1,
      startedAt: sessionStartedAt.toISOString(),
      targetRuns: DEFAULT_REOPEN_RUNS,
      excludedWarmupRuns: 1,
      medianLimitMs: REOPEN_MEDIAN_LIMIT_MS,
      maxLimitMs: REOPEN_MAX_LIMIT_MS,
      nodeVersion: process.version,
      hostPlatform: process.platform,
      hostArchitecture: process.arch,
    });

  if (metricsRecorder) {
    process.stdout.write(
      `[TunnelStartup] metrics_file=${relative(ROOT, metricsRecorder.filePath)} target_runs=${DEFAULT_REOPEN_RUNS} warmup_runs=1\n`
    );
    process.stdout.write(
      "[TunnelStartup] Load once for warm-up, then force-quit and reopen five times.\n"
    );
  }

  const child = spawn(EXPO_CLI, buildExpoArgs(options), {
    cwd: MOBILE_DIR,
    detached: true,
    env: buildExpoEnv(stopAtTunnelReady ? { ...process.env, CI: "1" } : process.env),
    stdio: [stopAtTunnelReady ? "ignore" : "inherit", "pipe", "pipe"],
  });

  const inspectLine = (line) => {
    const elapsedMs = elapsedMilliseconds(startedAt);
    const startupEvent = startupEventForLine(line);
    if (startupEvent === "bundle_served") {
      bundleSequence += 1;
      pendingBundle = {
        bundleSequence,
        bundleServedElapsedMs: elapsedMs,
        platform: bundlePlatformForLine(line),
      };
      process.stdout.write(
        `[TunnelStartup] bundle_cycle=${bundleSequence} bundle_served=+${elapsedMs}ms\n`
      );
    } else if (startupEvent === "usable_screen") {
      const completedBundle = pendingBundle;
      pendingBundle = null;
      const bundleToUsableMs = completedBundle === null
        ? null
        : Math.max(0, elapsedMs - completedBundle.bundleServedElapsedMs);
      process.stdout.write(
        `[TunnelStartup] bundle_cycle=${completedBundle?.bundleSequence ?? "unknown"} usable_screen=+${elapsedMs}ms bundle_to_usable=${bundleToUsableMs === null ? "unknown" : `${bundleToUsableMs}ms`}\n`
      );

      if (metricsRecorder && measurementTracker) {
        if (bundleToUsableMs === null) {
          metricsRecorder.append({
            recordType: "invalidCycle",
            recordedAt: new Date().toISOString(),
            reason: "usable_screen_without_bundle",
            usableScreenElapsedMs: elapsedMs,
          });
          process.stderr.write(
            "[TunnelStartup] measurement_invalid reason=usable_screen_without_bundle\n"
          );
        } else {
          const outcome = measurementTracker.record(bundleToUsableMs);
          if (outcome.kind === "ignored") return;
          const cycleRecord = {
            recordType: outcome.kind === "warmup" ? "warmup" : "measurement",
            recordedAt: new Date().toISOString(),
            platform: completedBundle.platform,
            bundleCycle: completedBundle.bundleSequence,
            bundleServedElapsedMs: completedBundle.bundleServedElapsedMs,
            usableScreenElapsedMs: elapsedMs,
            bundleToUsableMs,
            ...(outcome.kind === "measurement" ? { run: outcome.run } : {}),
          };
          metricsRecorder.append(cycleRecord);

          if (outcome.kind === "warmup") {
            process.stdout.write(
              `[TunnelStartup] measurement_warmup bundle_to_usable_ms=${bundleToUsableMs} excluded=true\n`
            );
          } else if (outcome.kind === "measurement") {
            process.stdout.write(
              `[TunnelStartup] measurement_run=${outcome.run}/${DEFAULT_REOPEN_RUNS} bundle_to_usable_ms=${bundleToUsableMs}\n`
            );
            if (outcome.summary) {
              measurementSummary = outcome.summary;
              metricsRecorder.append({
                recordType: "summary",
                recordedAt: new Date().toISOString(),
                ...measurementSummary,
                result: measurementSummary.passed ? "PASS" : "FAIL",
              });
              process.stdout.write(
                `[TunnelStartup] measurement_summary runs=${measurementSummary.completedRuns} median_bundle_to_usable_ms=${measurementSummary.medianMs} max_bundle_to_usable_ms=${measurementSummary.maxMs} median_limit_ms=${measurementSummary.medianLimitMs} max_limit_ms=${measurementSummary.maxLimitMs} result=${measurementSummary.passed ? "PASS" : "FAIL"} metrics_file=${relative(ROOT, metricsRecorder.filePath)}\n`
              );
              stopProcessGroup(child);
            }
          }
        }
      }
    }

    const milestone = milestoneForLine(line);
    if (!milestone || milestones.has(milestone)) return;
    milestones.set(milestone, elapsedMs);
    process.stdout.write(`[TunnelStartup] ${milestone}=+${elapsedMs}ms\n`);
    if (milestone === "tunnel_ready") {
      reachedTunnelReady = true;
      if (stopAtTunnelReady) {
        stopProcessGroup(child);
      } else {
        clearTimeout(timeout);
      }
    }
  };

  const consume = (chunk) => {
    const text = chunk.toString();
    combinedOutput += text;
    process.stdout.write(text);
    pendingLine += text;
    const lines = pendingLine.split(/\r?\n/);
    pendingLine = lines.pop() ?? "";
    for (const line of lines) inspectLine(line);
  };

  child.stdout.on("data", consume);
  child.stderr.on("data", consume);

  timeout = setTimeout(() => {
    timedOut = true;
    process.stderr.write(
      `[TunnelStartup] timeout=${BENCHMARK_TIMEOUT_MS}ms before Tunnel ready\n`
    );
    stopProcessGroup(child, "SIGTERM");
  }, BENCHMARK_TIMEOUT_MS);

  const onSigint = () => stopProcessGroup(child);
  const onSigterm = () => stopProcessGroup(child, "SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      void (async () => {
        clearTimeout(timeout);
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
        if (pendingLine) inspectLine(pendingLine);
        const failureCategory = reachedTunnelReady
          ? null
          : failureCategoryForOutput(combinedOutput);
        if (failureCategory) {
          const lastMilestone = [...milestones.keys()].at(-1) ?? "launcher_started";
          process.stderr.write(
            `[TunnelStartup] failure=${failureCategory} last_milestone=${lastMilestone}\n`
          );
        }
        if (metricsRecorder && !measurementSummary) {
          const incompleteSummary = measurementTracker.snapshot();
          metricsRecorder.append({
            recordType: "summary",
            recordedAt: new Date().toISOString(),
            ...incompleteSummary,
            result: "INCOMPLETE",
          });
          process.stderr.write(
            `[TunnelStartup] measurement_summary runs=${incompleteSummary.completedRuns}/${incompleteSummary.targetRuns} result=INCOMPLETE metrics_file=${relative(ROOT, metricsRecorder.filePath)}\n`
          );
        }
        await metricsRecorder?.flush();
        const measurementCode = metricsRecorder
          ? (measurementSummary?.passed ? 0 : 1)
          : null;
        resolve({
          code: measurementCode
            ?? (reachedTunnelReady && stopAtTunnelReady ? 0 : (code ?? 1)),
          elapsedMs: milestones.get("tunnel_ready") ?? null,
          milestones: Object.fromEntries(milestones),
          reachedTunnelReady,
          timedOut,
          failureCategory,
          measurementSummary,
          metricsFile: metricsRecorder?.filePath ?? null,
          output: combinedOutput,
        });
      })().catch(reject);
    });
  });
}

async function runBenchmark(options) {
  const mode = options.clear ? "clean" : "warm";
  const successful = [];
  const milestoneSamples = new Map(MILESTONES.map(([name]) => [name, []]));
  let failures = 0;
  const failureCategories = new Map();
  printLaunchSummary(options);
  process.stdout.write(`[TunnelStartup] benchmark_runs=${options.benchmarkRuns}\n`);

  for (let run = 1; run <= options.benchmarkRuns; run += 1) {
    process.stdout.write(`[TunnelStartup] benchmark_run=${run}/${options.benchmarkRuns}\n`);
    const result = await runMeasured(options, { stopAtTunnelReady: true });
    for (const [name, elapsedMs] of Object.entries(result.milestones)) {
      milestoneSamples.get(name)?.push(elapsedMs);
    }
    if (result.reachedTunnelReady && result.elapsedMs !== null) {
      successful.push(result.elapsedMs);
    } else {
      failures += 1;
      const category = result.failureCategory ?? "unknown";
      failureCategories.set(category, (failureCategories.get(category) ?? 0) + 1);
    }
  }

  const medianMs = median(successful);
  const milestoneSummary = [...milestoneSamples.entries()]
    .flatMap(([name, samples]) => {
      if (name === "tunnel_ready") return [];
      const value = median(samples);
      return value === null ? [] : [`median_${name}_ms=${Math.round(value)}`];
    })
    .join(" ");
  process.stdout.write(
    `[TunnelStartup] benchmark_summary mode=${mode} successful=${successful.length} failures=${failures}`
      + `${medianMs === null ? "" : ` median_tunnel_ready_ms=${Math.round(medianMs)}`}`
      + `${milestoneSummary ? ` ${milestoneSummary}` : ""}`
      + `${failureCategories.size === 0 ? "" : ` failure_categories=${JSON.stringify(Object.fromEntries(failureCategories))}`}\n`
  );
  return failures === 0 ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`[TunnelStartup] ${error.message}\n`);
    printUsage();
    return 2;
  }

  if (options.help) {
    printUsage();
    return 0;
  }

  try {
    await assertLocalExpoCli();
  } catch (error) {
    process.stderr.write(`[TunnelStartup] ${error.message}\n`);
    return 1;
  }

  if (options.benchmarkRuns > 0) return runBenchmark(options);
  if (options.measure) {
    printLaunchSummary(options);
    const result = await runMeasured(options, { stopAtTunnelReady: false });
    return result.code;
  }
  return runInteractive(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
