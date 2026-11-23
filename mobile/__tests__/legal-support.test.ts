import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LEGAL_CONTENT_REVISION,
  PRIVACY_POLICY_MARKDOWN,
  TERMS_OF_USE_MARKDOWN,
} from "../content/legalDocuments";
import { parseLegalMarkdown } from "../utils/legalContent";
import {
  buildSupportEmailBody,
  buildSupportMailtoUrl,
  SUPPORT_EMAIL,
} from "../utils/supportEmail";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

const privacySource = readFileSync(resolve(__dirname, "../../docs/legal/privacy-policy.md"), "utf8");
const termsSource = readFileSync(resolve(__dirname, "../../docs/legal/terms-of-use.md"), "utf8");
equal(privacySource, PRIVACY_POLICY_MARKDOWN, "bundled privacy text matches its canonical document");
equal(termsSource, TERMS_OF_USE_MARKDOWN, "bundled terms text matches its canonical document");
equal(
  privacySource.includes(`legal-content-revision: ${LEGAL_CONTENT_REVISION}`),
  true,
  "privacy revision is shared",
);
equal(
  termsSource.includes(`legal-content-revision: ${LEGAL_CONTENT_REVISION}`),
  true,
  "terms revision is shared",
);

const privacyBlocks = parseLegalMarkdown(PRIVACY_POLICY_MARKDOWN);
equal(privacyBlocks[0]?.kind, "title", "privacy content starts with a title");
equal(
  privacyBlocks.some((block) => block.kind === "heading"),
  true,
  "privacy content preserves headings",
);
equal(
  privacyBlocks.some((block) => block.kind === "list-item"),
  true,
  "privacy content preserves lists",
);
equal(
  privacyBlocks.some(
    (block) =>
      block.kind === "list-item" &&
      block.text.includes("Firebase Authentication provides an account UID, email address"),
  ),
  true,
  "privacy content keeps wrapped list items together",
);
equal(
  privacyBlocks.some((block) => block.text.includes("Settings > Delete Account")),
  true,
  "privacy content preserves account deletion guidance",
);

equal(SUPPORT_EMAIL, "aaryaman04@gmail.com", "support uses the approved email address");
const supportBody = buildSupportEmailBody("1.0.4", "ios");
equal(supportBody.includes("App version: 1.0.4"), true, "support template includes app version");
equal(supportBody.includes("Platform: ios"), true, "support template includes platform");
equal(
  supportBody.includes("Do not include passwords, tokens, API keys, logs, or private photos."),
  true,
  "support template warns against private data",
);
equal(supportBody.includes("Firebase"), false, "support template does not include account identifiers");
const mailtoUrl = buildSupportMailtoUrl("1.0.4", "ios");
equal(mailtoUrl.startsWith(`mailto:${SUPPORT_EMAIL}?`), true, "support action uses mailto");
equal(mailtoUrl.includes(encodeURIComponent("ListFlick support request")), true, "support subject is encoded");
equal(mailtoUrl.includes(encodeURIComponent(supportBody)), true, "support body is encoded");

const settingsSource = readFileSync(resolve(__dirname, "../app/(tabs)/settings.tsx"), "utf8");
for (const expected of [
  "Contact Support",
  "Privacy & Data",
  "Terms of Service",
  'router.push("/privacy-policy")',
  'router.push("/terms-of-use")',
  "Linking.canOpenURL",
  "Clipboard.setStringAsync(text)",
  "copySupportText(SUPPORT_EMAIL",
  "copySupportText(supportBody",
  "Delete Account",
  "deleteAccount()",
  "clearLocalUserData(uid)",
]) {
  equal(settingsSource.includes(expected), true, `Settings includes ${expected}`);
}
equal(settingsSource.includes("LEGAL_URLS"), false, "Settings no longer depends on GitHub legal URLs");
equal(settingsSource.includes("github.com"), false, "Settings legal actions do not require GitHub");

const legalScreenSource = readFileSync(
  resolve(__dirname, "../components/legal/LegalDocumentScreen.tsx"),
  "utf8",
);
equal(legalScreenSource.includes("selectable"), true, "legal text is selectable");
equal(legalScreenSource.includes('accessibilityRole="header"'), true, "legal headings are accessible");
equal(legalScreenSource.includes('accessibilityLabel="Back to Settings"'), true, "legal screen has a clear back action");
equal(legalScreenSource.includes("minHeight: 48"), true, "legal back control has a large tap target");
equal(legalScreenSource.includes("numberOfLines={1}"), false, "legal header can grow with large text");

for (const route of ["privacy-policy", "terms-of-use"]) {
  const routeSource = readFileSync(resolve(__dirname, `../app/${route}.tsx`), "utf8");
  equal(routeSource.includes("<LegalDocumentScreen"), true, `${route} uses the bundled legal screen`);
}

const apiSource = readFileSync(resolve(__dirname, "../services/api.ts"), "utf8");
equal(apiSource.includes("/api/account"), true, "mobile API client retains account deletion");

const storageSource = readFileSync(resolve(__dirname, "../services/storage.ts"), "utf8");
equal(storageSource.includes("AsyncStorage.multiRemove"), true, "local account cleanup retains stored-key removal");

console.log("Legal, support, and account deletion wiring tests passed.");
