# Auto-Connect Latest Shell Plan

**Overall Progress:** `100%`

## Tasks:

- [x] 🟩 **Step 1: Add auto-connect manager (app start + resume)**
  - [x] 🟩 Create a lightweight manager component in the root layout that listens to app start and AppState resume events
  - [x] 🟩 Guard against concurrent/duplicate attempts and skip if active shells already exist
  - [x] 🟩 Pick the most recent active shell by `createdAtMs` and navigate to `/shell/detail`

- [x] 🟩 **Step 2: Implement silent auto-connect using latest saved key-based connection**
  - [x] 🟩 Fetch saved connections, select latest by `metadata.modifiedAtMs`
  - [x] 🟩 If latest is key-based and key exists, connect + start shell + navigate (no UI state changes)
  - [x] 🟩 Skip silently on password-based, missing key, or connect failure

- [x] 🟩 **Step 3: Prefill Host form when pristine**
  - [x] 🟩 Detect pristine state (no user edits) on the Host form
  - [x] 🟩 Prefill fields from latest saved connection without overriding user input

- [x] 🟩 **Step 4: Auto-reconnect on disconnect with simple backoff**
  - [x] 🟩 On disconnect, schedule limited backoff retries (e.g., 1s/3s/5s)
  - [x] 🟩 Keep `/shell/detail` visible during reconnect attempts
  - [x] 🟩 Stop retries and return to Host only after final failure

- [x] 🟩 **Step 5: Adjust shell detail missing-connection behavior**
  - [x] 🟩 Gate the existing `router.back()` so it doesn’t run during auto-reconnect
  - [x] 🟩 Ensure normal back behavior when auto-reconnect is not in progress
