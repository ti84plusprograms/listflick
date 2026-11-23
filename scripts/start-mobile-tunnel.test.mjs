import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  bundlePlatformForLine,
  buildExpoArgs,
  buildExpoEnv,
  createJsonlRecorder,
  createReopenMeasurementTracker,
  failureCategoryForOutput,
  median,
  milestoneForLine,
  parseArgs,
  startupEventForLine,
  summarizeReopenMeasurements,
} from "./start-mobile-tunnel.mjs";

const require = createRequire(import.meta.url);
const {
  shouldCompressMultipartBundle,
} = require("../mobile/config/metroMultipartCompression.cjs");

test("defaults to the warm interactive launcher", () => {
  assert.deepEqual(parseArgs([]), {
    clear: false,
    measure: false,
    benchmarkRuns: 0,
    help: false,
  });
  assert.deepEqual(buildExpoArgs({ clear: false }), [
    "start",
    "--dev-client",
    "--tunnel",
  ]);
});

test("supports an explicit clean benchmark", () => {
  assert.deepEqual(parseArgs(["--clear", "--benchmark", "7"]), {
    clear: true,
    measure: false,
    benchmarkRuns: 7,
    help: false,
  });
  assert.deepEqual(buildExpoArgs({ clear: true }), [
    "start",
    "--dev-client",
    "--tunnel",
    "--clear",
  ]);
});

test("enables multipart bundle compression only for the tunnel child", () => {
  const baseEnv = { PATH: "/test/bin" };
  assert.deepEqual(buildExpoEnv(baseEnv), {
    PATH: "/test/bin",
    LISTFLICK_METRO_COMPRESS_MULTIPART: "1",
  });
  assert.equal(baseEnv.LISTFLICK_METRO_COMPRESS_MULTIPART, undefined);
});

test("uses five runs when benchmark count is omitted", () => {
  assert.equal(parseArgs(["--benchmark"]).benchmarkRuns, 5);
});

test("rejects invalid and conflicting options", () => {
  assert.throws(() => parseArgs(["--unknown"]), /Unknown option/);
  assert.throws(() => parseArgs(["--benchmark", "0"]), /integer from 1 to 20/);
  assert.throws(
    () => parseArgs(["--measure", "--benchmark"]),
    /either --measure or --benchmark/
  );
});

test("recognizes Expo startup milestones", () => {
  assert.equal(milestoneForLine("Starting project at /tmp/mobile"), "project_started");
  assert.equal(milestoneForLine("Starting Metro Bundler"), "metro_started");
  assert.equal(milestoneForLine("Tunnel connected."), "tunnel_connected");
  assert.equal(milestoneForLine("\u001b[32mTunnel ready.\u001b[0m"), "tunnel_ready");
  assert.equal(milestoneForLine("iOS Bundled 835ms index.js"), "first_bundle_served");
  assert.equal(
    milestoneForLine(" LOG  [AppStartup] first_usable_screen"),
    "first_usable_screen"
  );
  assert.equal(milestoneForLine("Waiting on http://localhost:8081"), null);
});

test("recognizes recurring bundle and usable-screen events", () => {
  assert.equal(startupEventForLine("Android Bundled 24ms index.js"), "bundle_served");
  assert.equal(bundlePlatformForLine("Android Bundled 24ms index.js"), "android");
  assert.equal(bundlePlatformForLine("iOS Bundled 24ms index.js"), "ios");
  assert.equal(
    startupEventForLine("\u001b[32m LOG  [AppStartup] first_usable_screen\u001b[0m"),
    "usable_screen"
  );
  assert.equal(startupEventForLine("Tunnel ready."), null);
});

test("excludes warm-up and summarizes five accepted reopen measurements", () => {
  const tracker = createReopenMeasurementTracker();
  assert.deepEqual(tracker.record(9_500), { kind: "warmup", durationMs: 9_500 });

  const durations = [4_120, 3_870, 4_540, 4_010, 5_200];
  const outcomes = durations.map((duration) => tracker.record(duration));
  assert.deepEqual(outcomes.slice(0, 4).map(({ run, summary }) => ({ run, summary })), [
    { run: 1, summary: null },
    { run: 2, summary: null },
    { run: 3, summary: null },
    { run: 4, summary: null },
  ]);
  assert.deepEqual(outcomes[4].summary, {
    targetRuns: 5,
    completedRuns: 5,
    durationsMs: durations,
    medianMs: 4_120,
    maxMs: 5_200,
    medianLimitMs: 8_000,
    maxLimitMs: 12_000,
    complete: true,
    passed: true,
  });
});

test("fails a complete measurement session when either threshold is exceeded", () => {
  assert.equal(
    summarizeReopenMeasurements([7_000, 8_100, 8_200, 8_300, 11_000]).passed,
    false
  );
  assert.equal(
    summarizeReopenMeasurements([3_000, 3_100, 3_200, 3_300, 12_001]).passed,
    false
  );
  assert.equal(summarizeReopenMeasurements([3_000, 3_100]).complete, false);
});

test("persists newline-delimited session records", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "listflick-tunnel-metrics-"));
  const filePath = join(tempDirectory, "session.jsonl");
  try {
    const recorder = await createJsonlRecorder(filePath, {
      recordType: "session",
      targetRuns: 5,
    });
    recorder.append({ recordType: "measurement", run: 1, bundleToUsableMs: 4_120 });
    recorder.append({ recordType: "summary", result: "PASS" });
    await recorder.flush();

    const records = (await readFile(filePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(records, [
      { recordType: "session", targetRuns: 5 },
      { recordType: "measurement", run: 1, bundleToUsableMs: 4_120 },
      { recordType: "summary", result: "PASS" },
    ]);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("selects multipart bundle responses for forced compression", () => {
  const multipartResponse = {
    getHeader: () => "multipart/mixed; boundary=test",
  };
  const javascriptResponse = {
    getHeader: () => "application/javascript",
  };

  assert.equal(
    shouldCompressMultipartBundle(
      { url: "/node_modules/expo-router/entry.bundle?platform=ios" },
      multipartResponse
    ),
    true
  );
  assert.equal(
    shouldCompressMultipartBundle({ url: "/status" }, multipartResponse),
    false
  );
  assert.equal(
    shouldCompressMultipartBundle({ url: "/entry.bundle" }, javascriptResponse),
    false
  );
});

test("calculates odd and even medians without changing input", () => {
  const odd = [4705, 2795, 2290, 1859, 2207];
  assert.equal(median(odd), 2290);
  assert.deepEqual(odd, [4705, 2795, 2290, 1859, 2207]);
  assert.equal(median([2608, 2543, 2909, 2603]), 2605.5);
  assert.equal(median([]), null);
});

test("classifies local and external startup failures", () => {
  assert.equal(
    failureCategoryForOutput("CommandError: ngrok tunnel took too long to connect."),
    "tunnel_provider_timeout"
  );
  assert.equal(
    failureCategoryForOutput("Port 8081 is running this app in another window"),
    "local_port_in_use"
  );
  assert.equal(
    failureCategoryForOutput("CommandError: failed to start tunnel\nremote gone away"),
    "tunnel_provider_failure"
  );
  assert.equal(failureCategoryForOutput("Unexpected Expo failure"), "expo_start_failed");
});
