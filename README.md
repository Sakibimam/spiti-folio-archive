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

There is also **[viewer.html](./viewer.html)** — a single static file, no build,
no server. Open it in a browser and it resolves the same feed through a gateway
and lists the archive, with an honest expiry banner at the top.

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
2. Reuses a usable postage batch, or buys one (1 GB / 7 days).
3. Reads the batch's **remaining lifetime from the node** and prints it.
4. Builds `folios/index.json` — the inventory, with sizes and sha256 digests.
5. Uploads `folios/` as a collection → a content reference.
6. **Reads the feed from the network** to discover the next index.
7. Writes the collection reference into the feed with `uploadReference`.
8. Creates a feed manifest and writes `archive.json` + `STATUS.md`.

### 4. Check what you are paying for

```bash
npm run status
```

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

Nothing about the lifetime is hardcoded. To extend it:

```bash
swarm-cli stamp topup <batch-id> --amount <plur>
```

### Why a mutable batch

Immutable batches protect history but become unusable once their buckets fill,
and a feed is republished repeatedly by design. This tool buys a **mutable**
batch (`immutableFlag: false`) so republishing does not brick the archive
mid-project. For a genuinely final deposit, an immutable batch with a long
`amount` is the better choice — that is a deliberate trade, not an oversight.

---

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
