# EAS profile reference

`mobile/eas.json` defines:

| Profile | Distribution | API URL | Use |
|---|---|---|---|
| `development` | internal development client | `http://localhost:8000` | local simulator/development build |
| `preview` | internal | deployer-supplied `EXPO_PUBLIC_API_URL` | shared acceptance build |
| `production` | store/default | deployer-supplied `EXPO_PUBLIC_API_URL` | release build |

Commands are `npx eas-cli build --profile development`,
`npx eas-cli build --profile preview`, and
`npx eas-cli build --profile production` from `mobile/`. The Makefile exposes
the preview and production commands.

The repository does not contain an EAS project ID or a preview/production API
URL. Run `eas init` against your own Expo account and configure
`EXPO_PUBLIC_API_URL` in your own EAS environment before building either
profile. This prevents a fork or clone from consuming the repository owner's
EAS or backend resources.

## Brand and native identity

The public app name is **ListFlick**. The Expo configuration and checked-in
iOS and Android projects use that name for the home-screen label and permission
prompts.

The existing Expo slug, URL scheme, iOS bundle identifier, Android application
ID/package, and native project/target paths retain their original
`marketplace-listing-assistant` or `listingassistant` values. The EAS project ID
is intentionally absent. Self-hosters should choose unique identifiers before
store distribution and coordinate them with EAS, Firebase, deep links, and
signing.
