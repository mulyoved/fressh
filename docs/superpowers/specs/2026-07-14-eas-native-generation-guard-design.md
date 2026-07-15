# EAS Native Generation Guard Design

## Problem

The mobile app uses Expo continuous native generation, so `apps/mobile/android/`
is ignored by Git. The root `.easignore` replaces Git's ignore rules during EAS
packaging, but it does not exclude the complete Android directory. As a result,
a stale local Android project can enter a local EAS build.

When EAS sees that Android project, it skips Expo prebuild. Config plugins then
do not run. The affected APK contained the JavaScript Tailscale integration but
not its generated `FresshTailscale` Android module, so connections were blocked
before SSH started.

## Design

Keep Android as generated output. Add `apps/mobile/android/` to the root
`.easignore` so the native project never enters an EAS build archive. EAS will
then run Expo prebuild and create Android from `apps/mobile/app.config.ts` and
the configured plugins on every build.

The existing canonical preview command remains unchanged. Local Gradle commands
may still use the generated Android directory, but EAS builds may not consume
that local copy.

## Guard

Add an integration test that reads the root `.easignore` and requires an exact
rule excluding `apps/mobile/android/`. The test documents the boundary that
prevents stale generated native code from being shipped.

The existing Tailscale plugin tests remain responsible for proving that Expo
prebuild generates the package visibility entry, native module files, and React
package registration.

## Documentation

Update the mobile build runbook to state that EAS excludes the local Android
directory and regenerates it from config plugins. Also explain that removing the
ignore rule can cause EAS to skip prebuild and package stale native code.

## Verification and Deployment

1. Run the new guard test before the `.easignore` change and confirm it fails.
2. Add the ignore rule and confirm the test passes.
3. Run the mobile integration tests, formatting check, lint check, and
   typecheck.
4. Run an Android prebuild/compile check to prove the Tailscale native files and
   registration compile.
5. Build a local EAS preview APK and confirm the log shows Expo prebuild rather
   than skipping it.
6. Inspect the APK package, version, and signing certificate.
7. Confirm the installed app uses the same signer, then install with
   `adb install -r` on `100.113.210.6:36185`.
8. Launch Fressh and verify the process starts without clearing application
   data.

## Safety

Do not uninstall Fressh, clear its data, or run destructive e2e state resets.
If the APK signer differs from the installed app, stop before installation.
