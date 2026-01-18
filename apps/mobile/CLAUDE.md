# Fressh Mobile App

## Build Configuration

- **Platform**: Android only
- **Build System**: EAS (local preview builds by default)

### Building

Use a local preview build:

```bash
pnpm exec eas build --local --profile preview --platform android
```

For the full preview build + OTA update procedure (including native/UniFFI
changes), see:
`docs/dev-builds.md`.

### Native Dependencies

When Rust code changes (e.g., in `packages/react-native-uniffi-russh`), a new
EAS build is required to regenerate UniFFI bindings.
