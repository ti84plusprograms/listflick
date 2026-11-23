export const SUPPORT_EMAIL = "aaryaman04@gmail.com";
export const SUPPORT_SUBJECT = "ListFlick support request";

export function buildSupportEmailBody(appVersion: string, platform: string): string {
  return [
    `App version: ${appVersion}`,
    `Platform: ${platform}`,
    "",
    "What happened?",
    "[Describe the issue here]",
    "",
    "Error shown (optional):",
    "[Enter the user-facing error message]",
    "",
    "Do not include passwords, tokens, API keys, logs, or private photos.",
  ].join("\n");
}

export function buildSupportMailtoUrl(appVersion: string, platform: string): string {
  const subject = encodeURIComponent(SUPPORT_SUBJECT);
  const body = encodeURIComponent(buildSupportEmailBody(appVersion, platform));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}
