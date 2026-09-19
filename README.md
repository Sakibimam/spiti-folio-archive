# Spiti Folio Archive

> The manuscripts lasted eight centuries in a room with no electricity.
> The scans nearly died in six years.

A publishing tool that puts a manuscript collection on [Swarm](https://ethswarm.org)
behind **one address that never changes**, and a recovery tool that gets the whole
collection back from that address alone — with no account, no credential, and no
copy of this app.

---

## The address

Everything a stranger needs is in **[ARCHIVE.md](./ARCHIVE.md)** and
**[archive.json](./archive.json)**, both committed to this repo: a **feed owner
address** and a **topic**. Both are written there by `npm run init`, and neither
changes again.

That pair is the archive. Republish the folios a hundred times and the pair is
unchanged; only the content hash behind it moves.

## Recover the archive

Requires nothing from the publisher. Point it at your own node, or at a public
gateway if you have none:

```bash
npm install
npm run recover -- \
  --owner  <owner address from ARCHIVE.md> \
  --topic  "<topic from ARCHIVE.md>" \
  --bee    https://api.gateway.ethswarm.org \
  --out    ./restored
```

`ARCHIVE.md` carries the exact command with this archive's values filled in.

`src/recover.ts` reads no local index, no database, no state file, and never
touches `archive.json`. It resolves the feed, walks the collection's Mantaray
manifest **from the network** to enumerate every path, and writes the files out.
If the manifest walk is unavailable it falls back to `index.json`, an inventory
that is uploaded *inside* the collection for exactly this purpose.

### The archive carries its own reader

`viewer.html` is **uploaded inside the collection** and set as its index
document. So the published address is not a hex string a stranger has to know
what to do with — it opens a browsable page listing every folio, with the expiry
stated at the top:

```
http://localhost:1633/bzz/<feed-manifest>/
```

**A caveat, measured rather than assumed.** On your own Bee node (or Swarm
Desktop) that URL returns the page and it renders. On the *public* gateway at
`api.gateway.ethswarm.org` it does not: the gateway redirects HTML documents to
`bzz.link/forbidden` as an anti-phishing measure, so the viewer will not render
there. Every folio still downloads from the public gateway perfectly —

```
https://api.gateway.ethswarm.org/bzz/<feed-manifest>/catalogue.txt   # 200, exact bytes
https://api.gateway.ethswarm.org/bzz/<feed-manifest>/index.json      # 200, the inventory
```

— so a stranger with no node still recovers the whole archive via `npm run
recover`, and a stranger with a node gets the page as well. The data is never
the thing that is blocked; only HTML rendering on that one host is.

That page detects where it is running. Served from inside the archive it reads
the `index.json` sitting next to it and needs no gateway, no feed lookup and no
repository. Opened from this git checkout it reads `archive.json` and resolves
the feed over a gateway instead. Neither mode has an address hardcoded in it.

This matters for the brief: "delete the app and a stranger still gets the folios
back" should not quietly mean "…as long as GitHub is still up". The interface
lives with the data.

---

## Setup (publishing side)

You only need this to *write* to the archive. Reading needs none of it.

### 1. A funded Bee node

Install [Swarm Desktop](https://desktop.ethswarm.org). It bundles Bee and exposes
the API at `http://localhost:1633`.

A fresh node starts in **ultra-light** mode, which can only download. Redeem your
gift code (Desktop → Info → Setup wallet), let the node restart and sync the
postage stamp store, and wait for Mode to read **light**. Only then can you buy a
batch. `npm run status` will tell you which mode you are in and refuse to
continue from ultra-light rather than failing obscurely mid-upload.

### 2. Configure

Archive settings live in **[archive.config.json](./archive.config.json)** — the
topic, the title, the source directory, and the postage batch size and duration.
It is committed on purpose: a reader has to be able to rederive the topic from
this repository alone, and a value that lived only in an untracked `.env` would
die with the publisher's laptop. Any field can be overridden by an environment
variable of the same name for local experiments.

```bash
cp .env.example .env    # defaults are fine for a local Swarm Desktop node
npm install
npm run init            # creates publisher.key (gitignored) + ARCHIVE.md
```

### 3. Publish

```bash
npm run publish
```

Which does, in order:

1. Refuses to continue unless the node is out of ultra-light mode.
2. Reuses a usable postage batch, or prices a new one against the wallet and
   buys it — refusing, with the affordable duration named, rather than failing
   deep inside the node when the wallet is short.
3. Reads the batch's **remaining lifetime from the node** and prints it.
4. Creates the feed manifest first — it depends only on batch, topic and owner,
   so the archive can carry its own permanent address inside it.
5. Builds `folios/index.json` (inventory, sizes, sha256 digests, feed address)
   and copies `viewer.html` in beside it.
6. Uploads `folios/` as a collection → a content reference.
7. **Reads the feed from the network** to discover the next index.
8. Writes the collection reference into the feed with `uploadReference`.
9. Writes `archive.json` + `STATUS.md`.

### 4. Check what you are paying for

```bash
npm run status
```

### 5. Keep it alive

The story behind this project is an invoice nobody renewed. A tool that can only
publish, never renew, recreates that failure with extra steps — so topping up is
a first-class command:

```bash
npm run extend -- --days 7           # extend by a week
npm run extend -- --max              # spend the wallet down to whatever fits
npm run extend -- --days 7 --dry-run # price it without spending
```

It prices the extension from the node at the live storage rate, refuses what the
wallet cannot cover and names the number of days it *can*, and then waits for
Gnosis to confirm before reporting — because the node returns the old TTL for a
minute after the transaction is accepted, which makes a successful top-up look
like a no-op.

---

## How long is this actually paid for?

**Swarm storage is prepaid, not permanent.** "Permanent" on Swarm is a payment
schedule with an end date, and pretending otherwise is how the original cloud
account died.

So the batch's remaining lifetime is read live from the node (`bee.stamp.get()`
→ `batch.duration`) and surfaced in three places: the publish output, the
generated `STATUS.md`, and `index.json` *inside the uploaded collection* — so
the expiry travels with the data and a reader in five years learns it from the
archive itself, not from this repo.

Nothing about the lifetime is hardcoded. To extend it, use `npm run extend`
(above) — no second tool required.

### Why a mutable batch

Immutable batches protect history but become unusable once their buckets fill,
and a feed is republished repeatedly by design. This tool buys a **mutable**
batch (`immutableFlag: false`) so republishing does not brick the archive
mid-project. For a genuinely final deposit, an immutable batch with a long
`amount` is the better choice — that is a deliberate trade, not an oversight.

---

## Verify it yourself

```bash
npm run verify                                        # against your own node
npm run verify -- --bee https://api.gateway.ethswarm.org   # as a stranger would
```

It resolves the published address, re-reads the archive by owner + topic the
way `recover.ts` does, and checks every folio byte-for-byte against the sha256
digests published inside the archive. Last run against the public gateway:
**12 passed, 0 failed** (the batch-lifetime check skips there, because a public
gateway does not expose `/stamps`).

### A bug this test found

`viewer.html` used to resolve the archive with `GET /feeds/{owner}/{topic}`.
That does not work from a browser, for two reasons worth writing down:

- The endpoint **dereferences the feed and returns the stored bytes**, not a
  `{"reference": "..."}` envelope. This feed points at a collection manifest,
  so the body is binary and `JSON.parse` throws.
- The reference is in the `ETag` header, but `ETag` is not CORS-safelisted and
  Bee does not list it in `Access-Control-Expose-Headers`, so cross-origin
  JavaScript cannot read it either.

The viewer now resolves through the **feed manifest** instead, which Bee
resolves server-side: `{gateway}/bzz/{manifest}/index.json`. Verified on both a
local node and the public gateway.

## Design

```
folios/  ──uploadFromDirectory──▶  collection reference   (changes every publish)
                                            │
                                     uploadReference
                                            ▼
                         FEED = owner + topic   ◀── stable, published, forever
```

**The feed payload is a reference, never the file bytes.** A feed update is one
~4 KB single-owner chunk; `folios/catalogue.txt` alone is 19 KB. Contents are
uploaded separately and only the resulting reference is written to the feed.

**The next index is always resolved from the network.** `resolveNextIndex()` in
`src/publish.ts` reads the feed with `downloadReference()` and takes
`feedIndexNext` from the response. It is never cached, counted in memory, or
persisted to a file — a local counter desynchronises the moment you reinstall
the app or publish from a second machine, which is precisely the fragility this
project exists to eliminate.

**An empty feed is a state, not an error.** The first publish has nothing to
read; that read is guarded and resolves to index 0. `recover.ts` and `status.ts`
guard their reads too, and report "no updates yet" instead of crashing.

## Layout

| Path | |
|---|---|
| `src/publish.ts` | Buy/reuse batch → upload → resolve index → write feed |
| `src/recover.ts` | **Stateless recovery from published identifiers only** |
| `src/status.ts` | Live batch lifetime from the node |
| `src/extend.ts` | Top up the batch — renew the invoice before it lapses |
| `src/init.ts` | Creates the identity, writes the tracked address files |
| `src/inventory.ts` | Builds the in-collection `index.json` |
| `src/bee.ts` | Client + ultra-light/light preflight |
| `archive.config.json` | **Tracked** — topic, title, batch size/duration. Nothing is hardcoded in source |
| `ARCHIVE.md` | **Tracked** — owner address + topic |
| `archive.json` | **Tracked** — machine-readable identifiers |
| `STATUS.md` | Generated — honest expiry report |
| `viewer.html` | Static reader, no build, no server |

## Secrets

No private key, mnemonic, gift code or authenticated URL appears anywhere in
this repository, including in this file.

- `publisher.key` is generated locally, `chmod 0600`, and gitignored.
- The gift code goes into Swarm Desktop once and is never written to disk here.
- `.env` is gitignored; `.env.example` contains only a localhost URL.
- Losing `publisher.key` means the feed can never be **updated** again. It does
  not make the archive unreadable — reading requires no key at all. For an
  archive that is the correct failure mode.

## Pinned versions

`@ethersphere/bee-js` is pinned to **13.1.0**. v13 moved every flat method into a
namespace and most examples online are still v12:

| v12 | v13 |
|---|---|
| `bee.uploadData(...)` | `bee.data.upload(...)` |
| `bee.getAllPostageBatch()` | `bee.stamp.getAll()` |
| `bee.makeFeedWriter(...)` | `bee.feed.makeWriter(...)` |
| `bee.makeFeedReader(...)` | `bee.feed.makeReader(...)` |
| `bee.createFeedManifest(...)` | `bee.feed.createManifest(...)` |
| `bee.getNodeInfo()` | `bee.status.getNodeInfo()` |

Run `npm run typecheck` to confirm the calls match the pinned version.

## Licence

MIT.
