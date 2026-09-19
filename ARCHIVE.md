# The archive address

These two values are the whole address. They never change, no matter how many
times the contents are republished. Anyone holding them can recover every folio
with no cooperation from the publisher, no account, and no copy of this app.

| | |
|---|---|
| **Owner address** | `da99a7d6955e279a45758141990fde3102719ca1` |
| **Topic (string)** | `spiti-folio-archive-v1` |
| **Topic (hex)** | `6b40a2f9f41706c4a970ab110d94445e03833d888184bb61cee98320891d90e0` |

The topic hex is `keccak256` of the topic string, so either form works:
`Topic.fromString('spiti-folio-archive-v1')`.

After the first `npm run publish`, a feed manifest hash is also written to
`archive.json` — a single `bzz` address that resolves through any gateway.

## Recover the archive from these two values alone

With this repo:

```bash
npm install
npm run recover -- \
  --owner da99a7d6955e279a45758141990fde3102719ca1 \
  --topic "spiti-folio-archive-v1" \
  --bee https://api.gateway.ethswarm.org \
  --out ./restored
```

Without this repo, against any Bee node, using nothing but curl:

```bash
# resolve the feed to the current collection reference
curl -s "http://localhost:1633/feeds/da99a7d6955e279a45758141990fde3102719ca1/6b40a2f9f41706c4a970ab110d94445e03833d888184bb61cee98320891d90e0?type=sequence"

# then fetch the collection, which carries its own index.json inventory
curl -s "http://localhost:1633/bzz/<reference-from-above>/index.json"
curl -sO "http://localhost:1633/bzz/<reference-from-above>/<path-from-index.json>"
```

## What is NOT here

The publisher's private key. It lives in ``publisher.key``, which is
gitignored, and it is only needed to *write* new updates. Reading requires
nothing. If the key is lost the archive stays readable forever — it simply
stops being updatable, which is the correct failure mode for an archive.
