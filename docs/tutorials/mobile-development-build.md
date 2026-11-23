# Build the mobile development client

The project uses `@react-native-firebase/*`, so the supported development
runtime is an Expo Development Build. Expo Go does not contain the native
Firebase modules required by this app.

## Configure Firebase files

Download Firebase configuration files for your own project. Place them at:

- iOS: `mobile/config/GoogleService-Info.plist`
- Android: `mobile/config/google-services.json`

Copy them to `mobile/ios/ListingAssistant/GoogleService-Info.plist` and
`mobile/android/app/google-services.json` respectively before building the
checked-in native projects. All four usable config paths are ignored by Git;
the checked-in `.example` files contain placeholders only. Configure the
Google OAuth client IDs and iOS reversed-client-ID URL scheme as described in
[Firebase Authentication](../how-to/firebase-authentication.md).

Do not upload Firebase Admin service-account JSON to the mobile app. Do not use
the repository maintainer's Firebase, EAS, Render, Supabase, or provider
credentials.

## Install and build

```bash
cd mobile
npm install
npx expo run:ios
# or
npx expo run:android
```

Use `make mobile-manual` to run the iOS device command from the repository
root. After native dependency changes, rebuild the development client.

## Verify authentication

The root route guard sends signed-out users to the auth group and signed-in
users to the tab group. Development logs use the `[Auth]` prefix. See the
[authentication reference](../reference/authentication-contract.md).
