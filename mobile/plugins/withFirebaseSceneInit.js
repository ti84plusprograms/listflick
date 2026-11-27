const { withAppDelegate } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// Expo SDK 58 starts React Native from SceneDelegate, so AppDelegate.swift no longer
// contains `factory.startReactNative(`, the anchor @react-native-firebase/app 25 uses
// to add `FirebaseApp.configure()`. Without it the default Firebase app is never
// created. Add the call before `super.application(...)` in didFinishLaunching, as
// @react-native-firebase/app 27+ does. Remove this plugin after upgrading to 27+.
const PLUGIN_NAME = 'withFirebaseSceneInit';
const ANCHOR = /return\s+super\.application\(\s*application\s*,\s*didFinishLaunchingWithOptions:\s*launchOptions\s*\)/;
// A `FirebaseApp.configure()` call with no `//` before it on the same line.
const ACTIVE_CONFIGURE_CALL = /^(?:(?!\/\/).)*FirebaseApp\.configure\(\)/m;

function addFirebaseConfigure(contents) {
  if (ACTIVE_CONFIGURE_CALL.test(contents)) {
    return contents;
  }
  if (!ANCHOR.test(contents)) {
    throw new Error(
      `[${PLUGIN_NAME}] Could not find \`return super.application(application, didFinishLaunchingWithOptions: launchOptions)\` ` +
        'in AppDelegate.swift, so FirebaseApp.configure() could not be added and Firebase would not be initialized. ' +
        'Update plugins/withFirebaseSceneInit.js for the new AppDelegate template.',
    );
  }
  let next = contents;
  if (!next.includes('import FirebaseCore')) {
    next = next.replace(/^(internal )?import Expo$/m, (line) => `${line}\nimport FirebaseCore`);
  }
  return mergeContents({
    tag: 'listflick-firebase-scene-init',
    src: next,
    newSrc: '    FirebaseApp.configure()',
    anchor: ANCHOR,
    offset: 0,
    comment: '//',
  }).contents;
}

function withFirebaseSceneInit(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      return config;
    }
    config.modResults.contents = addFirebaseConfigure(config.modResults.contents);
    return config;
  });
}

module.exports = withFirebaseSceneInit;
module.exports.addFirebaseConfigure = addFirebaseConfigure;
