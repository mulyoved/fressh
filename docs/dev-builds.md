# Preview Builds (Local)

This repo uses **preview** builds (release-like) for day-to-day development
instead of debug/dev-client builds. Preview builds use `expo-updates`, so the app
runs standalone and only checks the update server on launch; no Metro or steady
connection required.

## When You Must Rebuild
- Rust or UniFFI changes in `packages/react-native-uniffi-russh`
- Native module changes that affect Android/iOS bridge code
- Anything that adds/removes native methods (JS expects a new native symbol)

## Standard Preview Build Procedure (Android, local)
1) Sync workspace deps
```bash
pnpm install
```

2) If Rust/UniFFI changed, regenerate bindings locally
```bash
pnpm --filter @fressh/react-native-uniffi-russh build:android
```
Confirm the generated files are updated and tracked.

3) Build the preview APK locally
```bash
cd apps/mobile
pnpm exec eas build --local --profile preview --platform android
```
Tip: add `--clear-cache` if the build seems to ignore native changes.

4) Install the new APK
```bash
adb install -r path/to/app-preview.apk
```
EAS prints the output path at the end of the build.

5) Launch the app
Preview builds run standalone and do not require Metro.

## JS-Only Updates (Preview OTA)
Use this when you only changed JS/TS (no native/Rust/UniFFI changes) and want
fast iteration without rebuilding.

### Prereqs (one-time)
- `expo-updates` is installed.
- Updates are enabled in `apps/mobile/app.config.ts`:
  - `updates.enabled: true`
  - `updates.url: https://u.expo.dev/<projectId>`
  - `runtimeVersion` is a **string** (bare workflow does not support policy).
- Install a fresh preview build once after enabling updates.

### Publish a JS update (preview)
```bash
cd apps/mobile
pnpm exec eas update --branch preview --message "Describe change"
```
Reopen the app to apply the update. No steady connection is required after the
update is downloaded.

## Channel + Branch Mapping
The build profiles pin to channels in `eas.json`:
- `preview` → `channel: preview` (default)
- `production` → `channel: production`
- `development` → `channel: development` (dev client, not used by default)

Publish updates to the matching branch (or update the channel to point at a
different branch):

```bash
# preview builds
pnpm exec eas update --branch preview --message "..."

# production builds
pnpm exec eas update --branch production --message "..."
```

### Default rule (preview mode)
During development, always use the **preview** channel/branch unless you
explicitly intend to update production.

## Build + Update Policy (Quick Reference)

- **Preview (default for day-to-day work)**
  - Build: `pnpm exec eas build --local --profile preview --platform android`
  - OTA: `pnpm exec eas update --branch preview`
- **Production (release only)**
  - Build: `pnpm exec eas build --profile production --platform android`
  - OTA: `pnpm exec eas update --branch production`
- **Development (dev client, legacy)**
  - Build: `pnpm exec eas build --profile development --platform android`
  - OTA: `pnpm exec eas update --branch development`
  - Requires Metro (`pnpm exec expo start --dev-client`)

**Rule:** use preview unless explicitly asked to use production or dev client.

### Confirm updates are enabled on-device
```bash
adb shell cmd package dump com.finalapp.vibe2 | rg "expo.modules.updates"
```
Expected: `expo.modules.updates.ENABLED=true`.

## Notes
- Local builds use your working tree (no need to commit), but keep generated
  artifacts tracked for teammates or future cloud builds.
- When distributing to others, build from a clean commit and publish matching
  updates.

## Android Release Keystore + Data-Preserving Migration
Use this when moving devices to a stable release keystore without losing data.

### Keystore source (Bitwarden)
The Android release keystore is stored in Bitwarden under **“fressh keystore”**.
- `login.username` → key alias
- `login.password` → store/key password
- Custom field `keystore` → base64-encoded keystore file

### Build a release-signed APK locally
Ensure `bw` is logged in and `BW_SESSION` is set (for example, `bw unlock --raw`).
The release keystore is stored locally at `apps/mobile/android/app/fressh-upload-key.keystore`
and is gitignored. If the file already exists, you can skip the Bitwarden fetch.
```bash
cd apps/mobile/android

# Requires an active Bitwarden session.
item=$(bw get item "fressh keystore" --raw)
alias=$(printf '%s' "$item" | jq -r '.login.username')
pass=$(printf '%s' "$item" | jq -r '.login.password')
printf '%s' "$item" | jq -r '.fields[] | select(.name=="keystore").value' \
  | base64 -d > app/fressh-upload-key.keystore
chmod 600 app/fressh-upload-key.keystore

ORG_GRADLE_PROJECT_FRESSH_UPLOAD_STORE_FILE=fressh-upload-key.keystore \
ORG_GRADLE_PROJECT_FRESSH_UPLOAD_STORE_PASSWORD="$pass" \
ORG_GRADLE_PROJECT_FRESSH_UPLOAD_KEY_ALIAS="$alias" \
ORG_GRADLE_PROJECT_FRESSH_UPLOAD_KEY_PASSWORD="$pass" \
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```
APK output:
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

To allow `adb shell run-as` during a one-time restore, build a debuggable
release:
```bash
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a \
  -PFRESSH_DEBUGGABLE_RELEASE=true
```

### Data-preserving migration (debug → release keystore)
1) **Create backup JSON on the device**
   - In-app: `Settings → Backup & Restore → Generate Backup → Copy`
   - Or (from the shell screen) `Config → Export backup` if available.
2) **Store the backup** in Bitwarden or a secure local file.  
   Backups include private keys and connection profiles.
3) **If signatures don’t match**, uninstall the old app:
   ```bash
   adb uninstall com.finalapp.vibe2
   ```
4) **Install the debuggable release APK** (for restore only):
   ```bash
   adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
   ```
5) **ADB restore (no clipboard):**
   ```bash
   adb push /path/to/backup.json /data/local/tmp/backup.json
   adb shell run-as com.finalapp.vibe2 cp /data/local/tmp/backup.json \
     /data/user/0/com.finalapp.vibe2/files/backup.json
   ```
   Then in-app:  
   `Settings → Backup & Restore → Import from files/backup.json → Restore`.
6) **Install the final non-debuggable release APK** (same keystore):
   ```bash
   ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
   adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
   ```

Notes:
- Keep the device **unlocked** and **dismiss the notification shade** if
  driving the UI via ADB taps.
- If the previous install already used the same keystore, you can skip the
  uninstall and use `adb install -r` to preserve data.

## Common Gotchas
- Run `eas build` from `apps/mobile` for non-interactive builds. Running from
  repo root can fail with “android.package is required”.
- When `android/` exists, EAS uses native config from `android/` and ignores
  `android.package` in `app.config.ts`. This is expected.
- `runtimeVersion` **must** be a string in bare workflow builds.
