# EAS Native Generation Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every EAS Android build regenerates native code from Expo config plugins, then build and safely install a preview APK containing the Tailscale native module.

**Architecture:** Keep `apps/mobile/android/` as generated output and exclude it completely from the EAS archive. A focused integration test locks this packaging boundary, while the existing config-plugin tests continue to verify the generated Tailscale module and registration.

**Tech Stack:** Expo 54, EAS local build, TypeScript, Node test runner, Android SDK tools, ADB.

## Global Constraints

- Keep Android as generated output; do not commit the complete native project.
- Keep the canonical preview EAS build command unchanged.
- Do not uninstall `com.finalapp.vibe2`, clear its data, or run destructive e2e state resets.
- Stop before installation if the new APK signer differs from the installed app.
- Target device: `100.113.210.6:36185`.

---

### Task 1: Enforce clean Android generation in EAS builds

**Files:**
- Create: `apps/mobile/test/integration/eas-native-generation.test.ts`
- Modify: `.easignore:34-40`
- Modify: `docs/dev-builds.md:117-133`

**Interfaces:**
- Consumes: the root `.easignore` file used to create EAS build archives.
- Produces: the exact active ignore rule `apps/mobile/android/`, which makes EAS run Expo prebuild instead of consuming a local generated Android tree.

- [ ] **Step 1: Write the failing archive-boundary test**

Create `apps/mobile/test/integration/eas-native-generation.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

void test('EAS excludes the generated Android project so prebuild always runs', async () => {
	const easIgnore = await readFile(path.join(repoRoot, '.easignore'), 'utf8');
	const activeRules = easIgnore
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.startsWith('#'));

	assert.ok(
		activeRules.includes('apps/mobile/android/'),
		'EAS must exclude apps/mobile/android/ so stale generated native code cannot skip Expo prebuild',
	);
});
```

- [ ] **Step 2: Run the test and verify the missing rule causes failure**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test test/integration/eas-native-generation.test.ts
```

Expected: FAIL with `EAS must exclude apps/mobile/android/ so stale generated native code cannot skip Expo prebuild`.

- [ ] **Step 3: Replace granular Android artifact exclusions with the native-project boundary**

In `.easignore`, replace the individual `apps/mobile/android/.gradle/` through `apps/mobile/android/local.properties` rules with:

```gitignore
# Generated native Android project. Excluding the whole directory makes EAS run
# Expo prebuild and apply every config plugin from apps/mobile/app.config.ts.
apps/mobile/android/
```

- [ ] **Step 4: Document the invariant beside the canonical build command**

After the preview build command in `docs/dev-builds.md`, add:

```markdown
The root `.easignore` excludes `apps/mobile/android/`. This is required: EAS
must regenerate Android from `app.config.ts` so every config plugin runs. If the
local generated Android directory enters the build archive, EAS skips prebuild
and can package stale or missing native modules.
```

- [ ] **Step 5: Run the focused and related integration tests**

Run:

```bash
pnpm --filter @fressh/mobile exec tsx --test \
  test/integration/eas-native-generation.test.ts \
  test/integration/tailscale-plugin.test.ts \
  test/integration/app-config.test.ts
```

Expected: all tests PASS with zero failures.

- [ ] **Step 6: Run mobile quality checks**

Run:

```bash
pnpm --filter @fressh/mobile fmt:check
pnpm --filter @fressh/mobile lint:check
pnpm --filter @fressh/mobile typecheck
pnpm --filter @fressh/mobile test:integration
git diff --check
```

Expected: every command exits 0; integration tests report zero failures.

- [ ] **Step 7: Commit the permanent guard**

```bash
git add .easignore \
  apps/mobile/test/integration/eas-native-generation.test.ts \
  docs/dev-builds.md
git commit -m "Fix EAS Android native generation"
```

Expected: one commit containing the test, ignore rule, and runbook update.

---

### Task 2: Build, inspect, and safely deploy the corrected APK

**Files:**
- Verify generated output: `apps/mobile/android/app/src/main/java/com/finalapp/vibe2/TailscaleModule.kt`
- Verify generated output: `apps/mobile/android/app/src/main/java/com/finalapp/vibe2/TailscalePackage.kt`
- Verify generated output: `apps/mobile/android/app/src/main/java/com/finalapp/vibe2/MainApplication.kt`
- Verify generated output: `apps/mobile/android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: the EAS archive boundary from Task 1 and Tailscale config plugin in `apps/mobile/plugins/with-tailscale.ts`.
- Produces: an APK signed for the existing `com.finalapp.vibe2` installation and containing `com.finalapp.vibe2.TailscaleModule` and `com.finalapp.vibe2.TailscalePackage`.

- [ ] **Step 1: Confirm the device and installed package are available**

Run:

```bash
adb connect 100.113.210.6:36185
adb -s 100.113.210.6:36185 get-state
adb -s 100.113.210.6:36185 shell pm path com.finalapp.vibe2
adb -s 100.113.210.6:36185 shell dumpsys package com.finalapp.vibe2 \
  | sed -n 's/^[[:space:]]*firstInstallTime=//p' \
  > /tmp/fressh-first-install-before.txt
```

Expected: ADB reports `connected` or `already connected`, state is `device`, and `pm path` prints an APK path.

- [ ] **Step 2: Run native generation and Kotlin compilation**

Run:

```bash
ANDROID_HOME=/home/muly/Android/Sdk \
ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
FRESSH_UPDATE_CHANNEL=preview \
pnpm --filter @fressh/mobile android:prebuild-compile-debug-kotlin
```

Expected: Expo prebuild finishes and Gradle reports `BUILD SUCCESSFUL`.

- [ ] **Step 3: Verify generated Tailscale wiring**

Run:

```bash
test -f apps/mobile/android/app/src/main/java/com/finalapp/vibe2/TailscaleModule.kt
test -f apps/mobile/android/app/src/main/java/com/finalapp/vibe2/TailscalePackage.kt
rg -F 'add(TailscalePackage())' \
  apps/mobile/android/app/src/main/java/com/finalapp/vibe2/MainApplication.kt
rg -F 'android:name="com.tailscale.ipn"' \
  apps/mobile/android/app/src/main/AndroidManifest.xml
git diff --check
```

Expected: both files exist, both searches match, and `git diff --check` exits 0. Review any tracked generated diff before continuing; do not discard it destructively.

- [ ] **Step 4: Build the local preview APK and capture the log**

Run:

```bash
cd apps/mobile
set -o pipefail
ANDROID_HOME=/home/muly/Android/Sdk \
ANDROID_SDK_ROOT=/home/muly/Android/Sdk \
EAS_SKIP_AUTO_FINGERPRINT=1 \
pnpm exec eas build --local --profile preview --platform android \
  2>&1 | tee /tmp/fressh-eas-preview.log
```

Expected: EAS exits 0 and prints the generated APK path.

- [ ] **Step 5: Prove EAS did not reuse the local Android project**

Run from the repository root:

```bash
if rg -F 'Skipped running "expo prebuild" because the "android" directory already exists' \
  /tmp/fressh-eas-preview.log; then
  echo 'ERROR: EAS reused a stale Android project' >&2
  exit 1
fi
rg -i 'prebuild' /tmp/fressh-eas-preview.log
```

Expected: the stale-project error check does not match, and the log contains the successful prebuild phase.

- [ ] **Step 6: Inspect native classes and signing certificates before installation**

Run from the repository root:

```bash
APK="$(find apps/mobile -maxdepth 1 -type f -name 'build-*.apk' -printf '%T@ %p\n' \
  | sort -nr | head -1 | cut -d' ' -f2-)"
test -n "$APK"

/home/muly/Android/Sdk/cmdline-tools/latest/bin/apkanalyzer dex packages \
  --defined-only "$APK" \
  | rg 'com\.finalapp\.vibe2\.Tailscale(Module|Package)$'

INSTALLED_APK="$(adb -s 100.113.210.6:36185 shell pm path com.finalapp.vibe2 \
  | head -1 | sed 's/^package://' | tr -d '\r')"
adb -s 100.113.210.6:36185 pull "$INSTALLED_APK" /tmp/fressh-installed.apk

NEW_SIGNER="$(/home/muly/Android/Sdk/build-tools/36.0.0/apksigner \
  verify --print-certs "$APK" \
  | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
INSTALLED_SIGNER="$(/home/muly/Android/Sdk/build-tools/36.0.0/apksigner \
  verify --print-certs /tmp/fressh-installed.apk \
  | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
test -n "$NEW_SIGNER"
test "$NEW_SIGNER" = "$INSTALLED_SIGNER"
```

Expected: both Tailscale classes are listed and the signer comparison exits 0. Stop if it fails.

- [ ] **Step 7: Install in place and launch without clearing data**

Run:

```bash
APK="$(find apps/mobile -maxdepth 1 -type f -name 'build-*.apk' -printf '%T@ %p\n' \
  | sort -nr | head -1 | cut -d' ' -f2-)"
test -n "$APK"
adb -s 100.113.210.6:36185 install -r "$APK"
adb -s 100.113.210.6:36185 shell am force-stop com.finalapp.vibe2
adb -s 100.113.210.6:36185 shell monkey \
  -p com.finalapp.vibe2 -c android.intent.category.LAUNCHER 1
adb -s 100.113.210.6:36185 shell pidof com.finalapp.vibe2
```

Expected: installation reports `Success`, the launcher starts, and `pidof` prints a process ID.

- [ ] **Step 8: Run final repository and device checks**

Run:

```bash
git status --short --branch
adb -s 100.113.210.6:36185 shell dumpsys package com.finalapp.vibe2 \
  | rg 'versionName|versionCode|firstInstallTime|lastUpdateTime'
test "$(adb -s 100.113.210.6:36185 shell dumpsys package com.finalapp.vibe2 \
  | sed -n 's/^[[:space:]]*firstInstallTime=//p' | tr -d '\r')" \
  = "$(cat /tmp/fressh-first-install-before.txt | tr -d '\r')"
adb -s 100.113.210.6:36185 logcat -d --pid="$(adb -s 100.113.210.6:36185 shell pidof -s com.finalapp.vibe2)" \
  -t 300 | rg -i 'FATAL EXCEPTION|AndroidRuntime|FresshTailscale|Tailscale is required' || true
```

Expected: the branch contains only intentional commits, `firstInstallTime` remains unchanged, `lastUpdateTime` reflects this install, and startup logs contain no fatal exception. Report any Tailscale message exactly rather than hiding it.
