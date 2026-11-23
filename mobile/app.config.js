const app = require("./app.json");

const e2eApiUrl = process.env.LISTFLICK_E2E_API_URL;
const e2eResetAiSettings = process.env.LISTFLICK_E2E_RESET_AI_SETTINGS === "true";

if (e2eApiUrl) {
  const url = new URL(e2eApiUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("LISTFLICK_E2E_API_URL must use HTTP on a loopback host");
  }
}

if (e2eResetAiSettings && !e2eApiUrl) {
  throw new Error("LISTFLICK_E2E_RESET_AI_SETTINGS requires LISTFLICK_E2E_API_URL");
}

module.exports = {
  ...app.expo,
  extra: {
    ...app.expo.extra,
    ...(e2eApiUrl ? { e2eApiUrl } : {}),
    ...(e2eResetAiSettings ? { e2eResetAiSettings: true } : {}),
  },
};
