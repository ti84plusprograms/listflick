# Set up the mobile app and device networking

For a simulator, set `EXPO_PUBLIC_API_URL=http://localhost:8000`, then run a
development build with `npx expo run:ios` or `npx expo run:android`. The native
`ios/` and `android/` folders are generated and not committed: copy the Firebase
files into `mobile/config/` first; `npx expo run:ios` runs prebuild if the
folders are missing. After changing `app.json`, `app.config.js` or a plugin in
`mobile/plugins/`, run `npx expo prebuild --clean`.

The notifications, video and appearance features add native configuration to
`mobile/app.json`, so rebuild the development client after pulling them:

- `expo-notifications` is listed as a plugin. ListFlick sends only local
  notifications, so `mobile/plugins/withoutPushEntitlement.js` removes the
  `aps-environment` (Push Notifications) entitlement that the plugin adds.
  This lets a personal Apple development team sign the app. Remove that plugin
  only if the app starts using remote push.
- `expo-camera`, `expo-image-picker` and `expo-media-library` carry camera,
  microphone and photo-library permission text for photo and video capture, and
  `expo-video` handles playback.
- The iOS icon has light and dark variants (`assets/images/icon.png` and
  `icon-dark.png`), and the `expo-splash-screen` plugin has a dark variant
  (`logo-mark-dark.png` on `#121212`). Changing these needs a prebuild.

For a physical device:

1. Start the backend with `make backend`.
2. Run `make mobile`; it writes the Mac LAN IP to `mobile/.env`.
3. Ensure the phone and Mac are on the same network.
4. Allow Local Network access for the iOS app.
5. Install or rebuild the development client.
   To sign it for the device, set `APPLE_TEAM_ID` to your Apple team ID before
   `npx expo prebuild --clean` or `npx expo run:ios --device`.

The phone must reach both Metro and the backend. Expo's `--tunnel` option
addresses Metro connectivity only; it does not expose port 8000.

If LAN access is unavailable, expose port 8000 separately with
`npx localtunnel --port 8000`, set `EXPO_PUBLIC_API_URL` to the HTTPS tunnel
URL, and restart the app. Tunnel URLs can change and add latency; use Render
for preview or production testing.

## Start Metro through an Expo tunnel

LAN mode is normally the fastest development path. Use the Expo tunnel when
the phone cannot reach Metro over the local network:

```bash
make mobile-tunnel
```

This warm path:

- runs the repository-installed Expo CLI directly;
- selects the custom development client explicitly;
- reuses Metro's existing cache;
- compresses the development client's `multipart/mixed` JavaScript bundle for
  tunnel transfer; and
- prints the selected cache, client, and transport modes before Expo starts.

It does not modify `mobile/.env`. Confirm that `EXPO_PUBLIC_API_URL` still
points to a backend the phone can reach.

If Metro's cache is known to be stale or corrupted, use the slower recovery
path deliberately:

```bash
make mobile-tunnel-clean
```

Do not use the clean command for routine restarts. An empty cache requires
Metro to rebuild its state and can make startup appear slower.

## Measure tunnel startup

Measure the user-visible reopen path interactively:

```bash
make mobile-tunnel-measure
```

After the tunnel becomes ready and the app has opened once, force-quit the app
on the device and reopen it five times. The command automatically excludes the
first completed load as warm-up, accepts the next five bundle-to-usable cycles,
prints progress after every accepted run, and then stops Metro.

Each session is stored in a gitignored file under
`mobile/.metrics/tunnel-reopen-<timestamp>.jsonl`. The file contains, in order:

- one `session` record with thresholds and host metadata;
- one excluded `warmup` record;
- five `measurement` records with platform, elapsed milestones, and
  `bundleToUsableMs`; and
- one `summary` record with the durations, median, maximum, and `PASS`, `FAIL`,
  or `INCOMPLETE` result.

The command passes when the five-run median is at most 8,000 ms and every run
is at most 12,000 ms. It exits successfully for `PASS` and unsuccessfully for
`FAIL` or `INCOMPLETE`. Stopping the command before five accepted runs still
writes an `INCOMPLETE` summary.

The trace pairs every platform bundle with the app's `first_usable_screen`
marker. `bundleToUsableMs` includes tunnel transfer, JavaScript startup,
Firebase auth restoration, and the initial route becoming renderable. A
usable-screen marker without a preceding bundle is stored as `invalidCycle`
and does not count toward the five runs.

The marker is emitted two animation frames after the authenticated or signed-
out navigation shell is ready. It is closer to what the person sees than
Metro's bundle-build duration, but physical-device observation remains the
final check for visual usability.

For user-like acceptance testing without a Metro download at every launch,
install an EAS preview build with `make build-preview`. Preview and production
builds embed the JavaScript bundle and use the deployed Render backend.

Run five warm starts only when diagnosing relay setup reliability and report
the median time to Expo's `Tunnel ready` milestone:

```bash
make mobile-tunnel-benchmark
```

Measure cache-cleared starts separately when comparing cold and warm behavior:

```bash
node scripts/start-mobile-tunnel.mjs --clear --benchmark 5
```

The equivalent npm command for the persisted five-run session is
`cd mobile && npm run measure:tunnel`.

Benchmark mode exits each temporary Metro process after `Tunnel ready`; it does
not measure app reopen or bundle download time. It classifies known provider
timeouts separately from local port conflicts and returns a failure status if
any requested run does not become ready.

Compare runs on the same computer, device, network, Node version, Expo version,
and development build. Tunnel-provider latency can dominate the result, so do
not treat a relay timeout as a local Metro regression.

## Interpret tunnel startup failures

- `failure=tunnel_provider_timeout` means Expo started Metro but the external
  ngrok relay did not become ready in time. Retry later or use LAN mode.
- `failure=tunnel_provider_failure` means the external relay closed or failed
  while Expo was starting it. Check the provider status and retry later.
- `failure=local_port_in_use` means another Expo process owns the Metro port.
  Stop that process before benchmarking.
- `missing_local_dependency` means mobile dependencies are not installed. Run
  `make install-mobile`.
- A backend connection failure after Metro is ready is separate from the Expo
  tunnel. Verify `EXPO_PUBLIC_API_URL` from the phone.
