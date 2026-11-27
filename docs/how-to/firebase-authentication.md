# Configure Firebase Authentication

Every clone must use its own Firebase project. The repository intentionally
does not track usable Firebase client files or a `.firebaserc`, so it cannot
authenticate against the repository owner's project by default.

1. Create a Firebase project and enable Email/Password authentication. Enable
   Google only if you intend to configure Google Sign-In.
2. Register Android package `com.listingassistant.app` and iOS bundle
   `com.listingassistant.app`, or first replace those identifiers with your own.
3. Download `google-services.json` and `GoogleService-Info.plist` into
   `mobile/config/`. These files are ignored by Git.
4. Run `npx expo prebuild --clean` in `mobile/` (or `npx expo run:ios`, which
   prebuilds when `ios/` is missing). Prebuild copies both files into the
   generated native projects.

5. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in `mobile/.env` if Google Sign-In is
   enabled. `mobile/app.config.js` reads the Google Sign-In `iosUrlScheme`
   from `REVERSED_CLIENT_ID` in your plist (falling back to a placeholder). When these variables are absent, the
   app hides Google Sign-In.
6. For Firebase CLI commands, copy `.firebaserc.example` to `.firebaserc` and
   replace its project ID. Never commit the resulting file.

The backend accepts Firebase Admin credentials through
`FIREBASE_SERVICE_ACCOUNT_PATH`, a local `service-account.json`, or
`FIREBASE_SERVICE_ACCOUNT_JSON`. It verifies ID tokens with revocation checks
and passes only the verified UID to route handlers. Missing or invalid bearer
credentials return 401 without provider exception details.

The mobile API layer attaches a Firebase ID token to protected requests and
retries once with a forced refresh after a 401/403 response. After sign-out,
the auth context clears signed-image URL cache and the route guard redirects to
login. Tokens are not stored in AsyncStorage.

Watch `[Auth]` messages in the development client and Firebase verification
warnings in Uvicorn logs. Never copy tokens or private keys into issue reports.
The files under `mobile/config/*.example` are shape references only; Firebase's
downloaded files are the source of truth for a working project.
