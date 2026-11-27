import assert from "node:assert/strict";

type FirebaseSceneInitModule = {
  addFirebaseConfigure(contents: string): string;
};

const { addFirebaseConfigure } = require(
  "../plugins/withFirebaseSceneInit.js",
) as FirebaseSceneInitModule;

// Short synthetic copy of the AppDelegate.swift that SDK 58's prebuild generates.
const sdk58AppDelegate = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let factory = ExpoReactNativeFactory(delegate: ReactNativeDelegate())
    reactNativeFactory = factory
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

const countCalls = (source: string) => source.split("FirebaseApp.configure()").length - 1;

// (a) Inserts exactly one call before super.application(...) and imports FirebaseCore.
const once = addFirebaseConfigure(sdk58AppDelegate);
assert.equal(countCalls(once), 1);
assert.ok(
  once.indexOf("FirebaseApp.configure()") < once.indexOf("return super.application("),
  "FirebaseApp.configure() must come before super.application(...)",
);
assert.match(once, /^internal import Expo\nimport FirebaseCore$/m);

// (b) Running the transform again changes nothing.
assert.equal(addFirebaseConfigure(once), once);

// (c) A commented-out call does not count as already present.
const commentedOut = sdk58AppDelegate.replace(
  "    reactNativeFactory = factory\n",
  "    reactNativeFactory = factory\n    // FirebaseApp.configure()\n",
);
const fromCommented = addFirebaseConfigure(commentedOut);
assert.equal(countCalls(fromCommented), 2);
assert.match(fromCommented, /^ {4}FirebaseApp\.configure\(\)$/m);

// (d) No anchor and no active call: fail loudly instead of skipping Firebase.
const noAnchor = sdk58AppDelegate.replace(
  "return super.application(application, didFinishLaunchingWithOptions: launchOptions)",
  "return true",
);
assert.throws(() => addFirebaseConfigure(noAnchor), /withFirebaseSceneInit.*Firebase would not be initialized/s);

console.log("Firebase scene init plugin tests passed.");
