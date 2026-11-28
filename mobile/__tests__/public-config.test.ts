import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(__dirname, path), "utf8");
}

const eas = JSON.parse(source("../eas.json"));
const app = JSON.parse(source("../app.json"));
const login = source("../app/(auth)/login.tsx");
const gitignore = source("../../.gitignore");
const render = source("../../render.yaml");
const firebaseConfig = source("../../firebase.json");
const firebaseRcExample = source("../../.firebaserc.example");
const androidExample = source("../config/google-services.json.example");
const iosExample = source("../config/GoogleService-Info.plist.example");

if (eas.build.preview.env?.EXPO_PUBLIC_API_URL || eas.build.production.env?.EXPO_PUBLIC_API_URL) {
  throw new Error("Preview and production builds must not default to an owner-hosted backend");
}
if (app.expo.extra?.eas?.projectId) {
  throw new Error("The public template must not target the repository owner's EAS project");
}
for (const expected of ["EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID", "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"]) {
  if (!login.includes(expected)) throw new Error(`Google Sign-In must use ${expected}`);
}
for (const ignored of [
  ".firebaserc",
  "mobile/config/google-services.json",
  "mobile/config/GoogleService-Info.plist",
  "mobile/android/app/google-services.json",
  "mobile/ios/ListingAssistant/GoogleService-Info.plist",
  "mobile/ios/",
  "mobile/android/",
]) {
  if (!gitignore.includes(ignored)) throw new Error(`Public config must ignore ${ignored}`);
}
if (!render.includes("- key: ALLOW_SERVER_AI_KEY_FALLBACK\n        value: false")) {
  throw new Error("The public Render template must default to BYOK");
}
if (!androidExample.includes("REPLACE_WITH_YOUR_FIREBASE_ANDROID_API_KEY")) {
  throw new Error("Android Firebase example must contain placeholders only");
}
if (!iosExample.includes("REPLACE_WITH_YOUR_FIREBASE_IOS_API_KEY")) {
  throw new Error("iOS Firebase example must contain placeholders only");
}
if (!firebaseConfig.includes("REPLACE_WITH_YOUR_SUPPORT_EMAIL")) {
  throw new Error("Firebase CLI config must not contain the maintainer's project support email");
}
if (!firebaseRcExample.includes("replace-with-your-firebase-project-id")) {
  throw new Error("Firebase project selection must be a local, deployer-owned choice");
}

const publicRuntimeConfiguration = [
  JSON.stringify(eas),
  JSON.stringify(app),
  login,
  render,
  firebaseConfig,
  firebaseRcExample,
  androidExample,
  iosExample,
].join("\n");
for (const forbiddenPattern of [/https:\/\/[^\s"']+\.onrender\.com/i, /AIza[\w-]+/, /\b\d{10,}-[\w-]+\.apps\.googleusercontent\.com/]) {
  if (forbiddenPattern.test(publicRuntimeConfiguration)) {
    throw new Error(`Public runtime configuration contains an owner-specific value matching ${forbiddenPattern}`);
  }
}

console.log("Public configuration isolation tests passed.");
