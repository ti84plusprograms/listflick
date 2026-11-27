const fs = require("fs");
const plist = require("@expo/plist").default;

const GOOGLE_URL_SCHEME_PLACEHOLDER = "com.googleusercontent.apps.REPLACE_WITH_YOUR_REVERSED_CLIENT_ID";

// Returns the REVERSED_CLIENT_ID from a GoogleService-Info.plist, or null when the
// file is missing, unreadable, or has no REVERSED_CLIENT_ID (a fresh clone has no plist).
function readReversedClientId(plistPath) {
  try {
    const parsed = plist.parse(fs.readFileSync(plistPath, "utf8"));
    const id = parsed && parsed.REVERSED_CLIENT_ID;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

module.exports = { readReversedClientId, GOOGLE_URL_SCHEME_PLACEHOLDER };
