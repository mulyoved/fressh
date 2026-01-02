# Fressh Mobile App

## Build Configuration

- **Platform**: Android only
- **Build System**: EAS (Expo Application Services)

### Building

Use EAS to build the app:

```bash
eas build --platform android --profile development
```

For the full dev build procedure (including native/UniFFI changes), see:
`docs/dev-builds.md`.

### Native Dependencies

When Rust code changes (e.g., in `packages/react-native-uniffi-russh`), a new EAS build is required to regenerate UniFFI bindings.
