# Dev Builds (EAS)

This repo uses an Expo dev client for Android builds. Any change to native code
or generated UniFFI bindings requires a new EAS development build.

## When You Must Rebuild
- Rust or UniFFI changes in `packages/react-native-uniffi-russh`
- Native module changes that affect Android/iOS bridge code
- Anything that adds/removes native methods (JS expects a new native symbol)

## Standard EAS Dev Build Procedure (Android)
1) Sync workspace deps
```bash
pnpm install
```

2) If Rust/UniFFI changed, regenerate bindings locally
```bash
pnpm --filter @fressh/react-native-uniffi-russh build:android
```
Confirm the generated files are updated and tracked.

3) Build the dev client via EAS (cloud)
```bash
cd apps/mobile
eas build --platform android --profile development
```
If the build seems to ignore native changes, add `--clear-cache`.

4) Install the new APK
```bash
cd apps/mobile
eas build:run -p android --latest
```
Or download the APK from EAS and:
```bash
adb install -r path/to/app-dev.apk
```

5) Start Metro for dev client
```bash
cd apps/mobile
pnpm exec expo start --dev-client
```

6) Verify native changes are present
- Trigger the feature that uses the new native method.
- If the app logs “method … is undefined” or similar, the device still has an
  older dev client.

## Notes
- EAS builds use the current git state. Avoid local-only changes when building.
- Generated artifacts (UniFFI bindings) must be committed for EAS to see them.

