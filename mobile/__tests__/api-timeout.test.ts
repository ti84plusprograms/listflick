import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiSource = readFileSync(resolve(__dirname, "../services/api.ts"), "utf8");

for (const expected of [
  "const DEFAULT_TIMEOUT_MS = 25000",
  "const ANALYZE_TIMEOUT_MS = 120000",
  "type RequestOptions = {",
  "timeoutMs?: number",
  "options: RequestOptions = {}",
  "const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS",
  "setTimeout(() => controller.abort(), timeoutMs)",
  "options?: RequestOptions",
  "fetchWithAuth(`${API_BASE_URL}${path}`, init, options)",
  "{ timeoutMs: ANALYZE_TIMEOUT_MS, headers }",
]) {
  if (!apiSource.includes(expected)) {
    throw new Error(`Mobile API timeout wiring is missing ${JSON.stringify(expected)}`);
  }
}

if (apiSource.includes("requestJson(\"/api/items/analyze\", \"POST\", \"Analysis failed\", { item_id: itemId })")) {
  throw new Error("analyzeItem still uses the default requestJson timeout");
}

console.log("Mobile API timeout wiring tests passed.");
