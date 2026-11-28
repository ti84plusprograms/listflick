import assert from "node:assert/strict";

import { describeAuthUser } from "../utils/authDebug";

assert.deepEqual(
  describeAuthUser(null),
  { signedIn: false },
  "a missing user is signed out"
);

const anonymous = describeAuthUser({ uid: "anonymous-user", isAnonymous: true });
assert.equal(anonymous.isAnonymous, true, "an anonymous user is marked anonymous");
assert.deepEqual(anonymous.providers, [], "an anonymous user without provider data has no providers");

const linked = describeAuthUser({
  uid: "linked-user",
  isAnonymous: false,
  providerData: [{ providerId: "google.com" }, { providerId: "apple.com" }],
});
assert.deepEqual(
  linked.providers,
  ["google.com", "apple.com"],
  "provider IDs are listed in their original order"
);

assert.equal(
  describeAuthUser({ uid: "user-without-flag" }).isAnonymous,
  false,
  "a missing isAnonymous flag defaults to false"
);

console.log("Auth debug summary tests passed.");
