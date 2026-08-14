# Profile storage & sync — the algorithm

How a user's identity (name, photo, interests, headline) is stored, shared, and
kept consistent across three independent channels, in every connectivity state.

## The three stores

| Store | Scope | Role |
|---|---|---|
| **Device (AsyncStorage)** | this phone | Source of truth for **my own** profile; offline cache of **peers'** profiles. Always available. |
| **Firebase (Firestore + Storage)** | all phones | The shared backend. How two phones that aren't in Bluetooth range (or on different networks) learn each other's identity. Best-effort. |
| **Bluetooth (GATT)** | the peer in front of me | Serverless, offline peer-to-peer identity exchange. Works with no network at all. |

Design rule: **local-first**. The device store is written first and always
succeeds; Firebase and Bluetooth are best-effort layers on top. Nothing the user
does is ever blocked on the network.

## Writing my profile (Save & continue)

```
1. Save to DEVICE storage            → always succeeds (saveMyProfileLocal)
2. ensureSignedIn()                  → bounded by an 8 s timeout (never hangs)
3. Upload photo to Storage (if new)  → 8 s timeout → { url | deferred | error }
4. Write profile doc to Firestore    → 8 s timeout → { ok | deferred | error }
5. Decide:
     ok            → done
     deferred      → stash a PENDING sync (pendingSync.ts) + show "offline, will
                     sync" indicator, then continue (never hang)
     real error    → show the real code (permission-denied / storage/...) and let
                     the user continue anyway
6. In parallel, once bonded, my profile + photo also go to the peer over GATT.
```

**Deferred = offline.** A Firestore/Storage write's promise only settles on server
ack, so offline it would hang forever — the 8 s timeout converts that into a
`deferred` result. The write is *not* lost: the local save already holds it, and a
pending-sync record is queued.

## Syncing when connectivity returns

`useProfileSync` (mounted in the running app) retries the pending record on mount
and every 30 s:

```
pending? → upload photo if still needed → write Firestore doc
  ok        → clear pending, drop the "will sync" indicator
  deferred  → still offline, keep pending, try again next tick
  real error→ clear pending (retrying won't help)
```

So a name/photo edited in airplane mode lands in the cloud automatically within
~30 s of regaining signal, with no user action.

## Reading a peer's profile

`useProfiles` resolves each nearby peer, with this precedence (strongest wins):

```
GATT (peer-supplied over Bluetooth)   ← authoritative for name/interests
  > Firebase (fetched from Firestore) ← fills in / refreshes, esp. the photo
    > Device cache (last known)       ← shown instantly, even offline
```

Every successful resolution (GATT **or** Firebase) is written to the device cache
(`profileCache.ts`), and the cache is re-hydrated at launch — so a peer you've seen
before shows their name/photo immediately, and still shows it when Firebase is
unreachable.

## Every connectivity scenario

| Scenario | My profile write | Seeing a peer |
|---|---|---|
| **Online, both on Firebase** | Device + Firestore + Storage all succeed | Firebase (full-size photo); GATT also fills in live |
| **Offline (airplane mode)** | Device succeeds; Firestore/Storage **deferred** → pending queued, "will sync" shown | Bluetooth/GATT (name + thumbnail) and device cache; Firebase silent-fails in the background |
| **Offline → back online** | Pending sync flushes within ~30 s; indicator clears | Firebase catches up and refreshes cached entries |
| **iPhone with no Firebase config** | Device + GATT only (Firestore returns `firebase-unconfigured`) | Bluetooth/GATT + device cache (see `IOS_SETUP.md` to enable Firebase) |
| **Two Androids, no GATT link** | Device + Firebase | Firebase + cache (Android↔Android is connectionless — no GATT profile exchange) |
| **In Bluetooth range, no network** | Device only; Firestore deferred | GATT delivers the peer's name + thumbnail with no backend at all |

## Why nothing is lost

- The **device store** is written before any network call and never fails on the
  happy path, so the user's own profile is always safe.
- A failed/slow cloud write becomes a **pending sync**, retried until it lands.
- Peer identities are **cached** on every resolution and survive relaunch.
- Bluetooth/GATT carries identity peer-to-peer with **no network dependency at
  all**, so two phones facing each other always exchange at least a name +
  thumbnail even with everything else down.
