# SecureStore Failure and Commit Semantics

## Scope

This research characterizes the storage contract available to Fressh from:

- Expo SDK 54's recommended `expo-secure-store` version, `15.0.8`;
- that package's exact installed source at commit
  `172a69f5f70c1d0e043e1532f924de97210cabc3`;
- Android `SharedPreferences` and Android Keystore documentation; and
- Apple Keychain Services and keychain data-protection documentation.

The result is a least-common-denominator contract for a transactional private
key store. Platform documentation and installed implementation observations are
stated separately from architectural inferences.

## Executive answer

Fressh may rely on SecureStore for OS-protected, per-key string storage that is
normally persistent across app restarts and updates. It may sequence operations
itself by awaiting them, and it may inspect a key after a write. It must not
treat SecureStore as a transactional database or as the sole durable copy of
irreplaceable data.

In particular, Fressh must not rely on any of these properties:

- atomicity, ordering, or isolation across two SecureStore keys;
- a fulfilled `setItemAsync()` promise as proof that an Android write reached
  durable storage;
- a fulfilled `deleteItemAsync()` promise as proof that an iOS item was deleted;
- `null` meaning only “this key never existed”;
- acceptance of every string at or below a universal 2048-byte limit;
- JavaScript string length matching stored UTF-8 byte length;
- persistence across Android uninstall, Android backup/restore, device transfer,
  or iOS reinstall; or
- recovery, enumeration, rollback, or compare-and-swap supplied by Expo.

Therefore storage v2 must implement transactions above SecureStore using
immutable generations, explicit validation, a publish-last commit protocol, more
than one recoverable commit candidate, serialized writers, and non-authoritative
best-effort garbage collection. It must retain the complete previous generation
until a newer generation has survived validation and must fall back to that
previous generation whenever the newest candidate is missing or incomplete.

## Fressh's current SecureStore profile

Fressh's adapter calls `getItemAsync`, `setItemAsync`, and `deleteItemAsync`
without options in
[`secrets-manager.ts`](../../../../apps/mobile/src/lib/secrets-manager.ts).
Consequently:

- `requireAuthentication` is `false` on both platforms;
- iOS uses the default `SecureStore.WHEN_UNLOCKED` accessibility class;
- Android uses the default `key_v1` keychain service and an unauthenticated
  Android Keystore AES key; and
- the plain `expo-secure-store` config plugin in
  [`app.config.ts`](../../../../apps/mobile/app.config.ts) keeps its default
  Android backup configuration, which excludes the `SecureStore` shared
  preferences file.

Biometric enrollment invalidation is therefore not part of today's Fressh
profile. It becomes a data-loss condition if `requireAuthentication` is enabled
later and must not be introduced silently during storage v2.

## Guarantee matrix

| Concern                  | Android, Expo 15.0.8                                                                                                            | iOS, Expo 15.0.8                                                                                                    | Safe cross-platform reliance                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Storage form             | Ciphertext JSON in private `SharedPreferences`; AES key in Android Keystore                                                     | `kSecClassGenericPassword` Keychain item                                                                            | Values receive platform access protection; this says nothing about multi-key transactions                                         |
| One write                | One `SharedPreferences.Editor.putString(...).commit()`                                                                          | One `SecItemAdd` or `SecItemUpdate`                                                                                 | An individual call is attempted; handle rejection and validate the visible result                                                 |
| Write acknowledgement    | Normal-value path ignores `commit()`'s boolean result                                                                           | Add/update status is checked and non-success throws                                                                 | A fulfilled promise is not a durable-write acknowledgement on the least-common-denominator contract                               |
| One delete               | Each present alias is removed with `commit()` and failures throw                                                                | Three alias deletions are attempted, but every `SecItemDelete` status is ignored                                    | Deletion is cleanup, not a commit boundary; confirm logical absence through the committed generation                              |
| Read                     | Returns decrypted string, `null`, or throws                                                                                     | Returns string, `null` for not found, or throws                                                                     | `null` means unavailable, not provably never-created                                                                              |
| Invalid/corrupt material | Missing Keystore key or bad padding can return `null`; bad padding also deletes the ciphertext                                  | Authentication invalidation can yield `null`; other Keychain statuses throw                                         | A reader must validate complete generations and fall back without pruning the last known-good generation                          |
| Ordering                 | Separate editor commits; same-key concurrent commits are last-writer-wins                                                       | Separate Keychain calls; Expo documents no concurrent-writer ordering                                               | Serialize every store mutation in Fressh and never use `Promise.all` to imply commit ordering                                     |
| Multi-key atomicity      | None exposed                                                                                                                    | None exposed                                                                                                        | Never require two keys to change atomically                                                                                       |
| Crash durability         | Android documents `commit()` as synchronous, but also documents SharedPreferences durability limitations; Expo hides the result | Successful Keychain calls return a status, but Expo and Apple publish no Fressh-usable cross-call crash transaction | Design recovery for any acknowledged step to be missing after restart                                                             |
| Size                     | Expo warns above 2048 UTF-8 bytes but still calls native code                                                                   | Large values can be rejected; historical failures occurred around 2048 bytes                                        | Enforce an app-owned conservative UTF-8 byte ceiling, still handle native rejection, and never size or split by UTF-16 code units |
| Uninstall/restore        | Data and Keystore keys are removed; backup and transfer exclude SecureStore                                                     | Same-bundle reinstall often retains Keychain data, but Expo says not to rely on it                                  | Automatic migration covers an in-place app upgrade only; it cannot promise uninstall or device-transfer recovery                  |
| Enumeration              | Native Android implementation can enumerate internally, but Expo exposes no listing API                                         | Expo exposes no listing API                                                                                         | All discoverability and garbage tracking must be represented in fixed, known keys or committed manifests                          |

## Documented platform semantics

### Expo API and persistence

The
[Expo SDK 54 SecureStore documentation](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/)
states that Android stores encrypted values in SharedPreferences using Android
Keystore, while iOS stores generic-password Keychain items. It also says:

- large payloads may be rejected, Expo does not enforce a hard maximum, and some
  historical iOS releases rejected values above roughly 2048 bytes;
- the store is intended to persist across restarts and updates but must not be
  the sole source of truth for irreplaceable critical data;
- Android data is lost on uninstall and SecureStore must be excluded from
  Android backup because restored ciphertext cannot be decrypted without the
  deleted Keystore key;
- iOS same-bundle reinstall persistence is an implementation detail, not a
  guarantee; and
- `getItemAsync()` returns `null` for either a missing entry or an invalidated
  authenticated key.

The documented `setItemAsync()` and `deleteItemAsync()` contracts say their
promises reject when the operation fails. The installed native implementations
weaken those statements in two important cases described below.

### Android SharedPreferences and Keystore

Android documents an individual
[`SharedPreferences.Editor.commit()`](https://developer.android.com/reference/android/content/SharedPreferences.Editor)
as an atomic replacement of that editor's requested changes and says it returns
`true` when the new values were written to persistent storage. It also documents
last-committer-wins behavior for concurrent editors.

The broader
[`SharedPreferences` contract](https://developer.android.com/reference/android/content/SharedPreferences)
warns that:

- changes become visible in memory before durable persistence;
- crashes or termination can lose changes;
- `commit()` exposes only a boolean and can report `false` even if a write
  succeeded;
- read-modify-write operations have no transaction isolation; and
- the class does not support multiple processes.

Android recommends DataStore or Room for new general storage. Fressh cannot
substitute those directly for secrets because Expo SecureStore's confidentiality
comes from encrypting values with a key protected by the
[Android Keystore](https://developer.android.com/privacy-and-security/keystore).
The Keystore protects key material and can bind it to secure hardware, but it
does not add a transaction spanning multiple encrypted SharedPreferences values.

### Apple Keychain

Apple's
[`SecItemAdd`](https://developer.apple.com/documentation/security/secitemadd%28_%3A_%3A%29)
and
[`SecItemUpdate`](https://developer.apple.com/documentation/security/secitemupdate%28_%3A_%3A%29)
APIs return an `OSStatus`. Apple's examples require checking that status, and
the API surfaces errors including `errSecDataTooLarge`. Apple does not document
a transaction that groups separate Expo calls or separate generic-password
items.

The default Fressh value uses `kSecAttrAccessibleWhenUnlocked`. Apple's
[keychain accessibility guidance](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility)
and
[keychain data-protection reference](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web)
explain that accessibility classes govern when items can be decrypted and
whether they migrate through backup. Fressh must treat device-locked access
failure as an operational error, not as proof that a key is absent.

## Installed Expo 15.0.8 observations

These are version-specific source observations, not promises from the public
Expo API.

### JavaScript boundary

The exact
[`SecureStore.ts`](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-secure-store/src/SecureStore.ts)
implementation calculates UTF-8 byte count and warns above 2048 bytes, but it
still sends the value to native code. The source comment calls 2048 bytes a
limit; the current Expo documentation more accurately says no universal limit is
enforced.

### Android boundary

The exact
[`SecureStoreModule.kt`](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-secure-store/android/src/main/java/expo/modules/securestore/SecureStoreModule.kt)
implementation:

1. encrypts a normal string;
2. calls `SharedPreferences.commit()` in `saveEncryptedItem()`; and
3. ignores the returned boolean in `setItemImpl()`.

Thus a normal `setItemAsync()` can resolve even when Expo did not receive a
successful persistence acknowledgement. A same-process read-back is valuable for
schema, encryption, and visibility checking, but SharedPreferences can serve it
from memory, so it is not proof of post-crash durability.

Android deletion does accumulate `commit()` failures and throws. On read,
however, a missing Keystore key or permanently invalidated key returns `null`;
bad padding deletes the unreadable SharedPreferences value and also returns
`null`. Reading can therefore have a destructive cleanup side effect.

### iOS boundary

The exact
[`SecureStoreModule.swift`](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-secure-store/ios/SecureStoreModule.swift)
implementation checks `SecItemAdd` and `SecItemUpdate` statuses for writes.
Deletion calls `SecItemDelete` for the legacy, authenticated, and
unauthenticated aliases but discards all three statuses. A fulfilled Expo delete
promise therefore does not prove physical deletion on iOS 15.0.8.

## Contract storage v2 may use

The transactional model may assume only the following:

1. Fressh can address a bounded set of valid string keys directly.
2. A read returns a presently visible string, `null`, or an error.
3. A write or delete can reject, resolve, or appear to resolve without proving
   the least-common-denominator durable outcome.
4. Explicitly awaited calls establish JavaScript control-flow order only; they
   do not create a platform transaction.
5. A single Android editor commit has documented per-editor atomic replacement,
   and a single iOS add/update has an OS status, but the cross-platform adapter
   must tolerate either operation being absent after restart.
6. The current unauthenticated configuration avoids biometric-enrollment
   invalidation, while iOS values are normally readable only when unlocked.
7. Storage survives ordinary in-place app updates in the normal case, but
   uninstall, restore, transfer, lock state, corruption, and platform
   invalidation are loss or unavailability boundaries.

## Required consequences for the storage-model decision

The next storage-model decision must enforce these properties regardless of the
exact record layout it chooses:

- **Single writer:** serialize all reads that feed mutations and all mutations
  within the app process. Never depend on concurrent last-writer-wins behavior.
- **Immutable generations:** write new value chunks and metadata under new
  generation-specific keys. Never overwrite or delete the live generation while
  preparing its replacement.
- **Publish last:** attempt and validate every new record before publishing a
  commit candidate. Publication is a separate final step.
- **Recoverable commit candidates:** keep at least two fixed, discoverable
  commit candidates or an equivalent redundant scheme. At startup, validate
  referenced records and choose the highest complete generation; an incomplete
  newest candidate must fall back to the previous complete generation.
- **Conservative validation:** give every record a schema version, generation,
  expected chunk count, and integrity/checksum information. `null`, parse
  failure, checksum failure, or a missing reference invalidates that candidate
  without mutating the fallback candidate.
- **Byte-safe encoding:** measure the exact UTF-8 bytes sent to Expo, adopt a
  conservative application ceiling below the historical 2048-byte boundary,
  avoid splitting surrogate pairs or encoded byte sequences, and handle native
  rejection at any size. The exact ceiling is a tested Fressh policy, not a
  platform guarantee.
- **Logical deletion first:** publish a generation that omits or tombstones a
  deleted key. Physical deletion is retryable garbage collection and is never
  evidence that the logical commit succeeded.
- **Delayed garbage collection:** retain enough old records to recover the
  previous complete generation. Track garbage explicitly because the Expo API
  cannot enumerate keys. Treat delete success as advisory and verify absence
  when useful, without blocking correctness on cleanup.
- **Idempotent migration:** leave all version-1 records untouched until a
  complete version-2 generation is published and re-opened successfully. On any
  interruption, retry or resume without deleting the only readable legacy copy.

The choice between dual root slots, an append-style fixed-slot journal, or
another redundant commit layout remains for “Choose the Transactional
Secure-Storage Model.” This research rules out any model whose correctness
depends on one mutable manifest, delete-before-write, or a single promise as a
durable acknowledgement.

## Failure-injection obligations

The eventual implementation plan must test at least these adapter outcomes at
every write boundary:

- reject before a value becomes visible;
- reject after a value becomes visible;
- resolve while the value is visible now but absent after simulated restart;
- return `null` for a referenced record;
- return malformed or checksum-invalid content;
- resolve deletion while leaving the value present;
- crash before and after every staged record and every commit-candidate write;
- race two mutations and prove serialization prevents lost updates;
- interrupt migration and reopen from either the legacy store or the last
  complete version-2 generation; and
- store ASCII, multibyte Unicode, and surrogate-pair data near the application
  byte ceiling.

## Implications for the current version-1 store

The existing
[`chunked-storage.ts`](../../../../apps/mobile/src/lib/chunked-storage.ts)
violates the required contract in several independent ways:

- upsert deletes the existing entry before preparing its replacement;
- a new root manifest is published before its new manifest chunk and value
  chunks;
- manifest and value writes use `Promise.all`, so their completion order is not
  a commit protocol;
- missing or invalid manifest chunks are pruned from the live root during read;
- writes are not read back or protected by a mutation lock;
- cleanup success can be mistaken for logical correctness; and
- chunk and manifest sizes use JavaScript string length, not UTF-8 byte count.

The multi-manifest lookup hotfix remains safe and independently releasable, but
none of these mutation problems should be repaired incrementally in version 1.
They are requirements for the clean-slate version-2 model and automatic
migration plan.

## Sources

- [Expo SDK 54 SecureStore documentation](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/)
- [Expo 15.0.8 JavaScript implementation](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-secure-store/src/SecureStore.ts)
- [Expo 15.0.8 Android implementation](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-secure-store/android/src/main/java/expo/modules/securestore/SecureStoreModule.kt)
- [Expo 15.0.8 iOS implementation](https://github.com/expo/expo/blob/172a69f5f70c1d0e043e1532f924de97210cabc3/packages/expo-secure-store/ios/SecureStoreModule.swift)
- [Android SharedPreferences.Editor](https://developer.android.com/reference/android/content/SharedPreferences.Editor)
- [Android SharedPreferences](https://developer.android.com/reference/android/content/SharedPreferences)
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)
- [Apple SecItemAdd](https://developer.apple.com/documentation/security/secitemadd%28_%3A_%3A%29)
- [Apple SecItemUpdate](https://developer.apple.com/documentation/security/secitemupdate%28_%3A_%3A%29)
- [Apple keychain accessibility](https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility)
- [Apple keychain data protection](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web)
