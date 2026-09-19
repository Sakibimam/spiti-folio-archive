/**
 * One-time setup: create the publisher identity and write the PUBLIC half of it
 * (owner address + topic) into tracked files, so a reader can find the archive
 * without any access to this machine.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Topic } from '@ethersphere/bee-js'
import { createPrivateKey, hasIdentity, loadPrivateKey, ownerAddress } from './identity.js'
import { FEED_TOPIC_STRING, PUBLIC_GATEWAY, PUBLISHER_KEY_FILE, REPO_ROOT } from './config.js'

function main(): void {
  const created = !hasIdentity()
  const key = created ? createPrivateKey() : loadPrivateKey()
  const owner = ownerAddress(key)
  const topic = Topic.fromString(FEED_TOPIC_STRING)

  console.log(created ? '\nCreated a new publisher identity.' : '\nUsing the existing publisher identity.')
  console.log(`  Private key -> ${PUBLISHER_KEY_FILE}  (gitignored, mode 0600)`)
  console.log(`  Owner       -> ${owner.toHex()}`)
  console.log(`  Topic       -> "${FEED_TOPIC_STRING}" = ${topic.toHex()}`)

  const archiveMd = `# The archive address

These two values are the whole address. They never change, no matter how many
times the contents are republished. Anyone holding them can recover every folio
with no cooperation from the publisher, no account, and no copy of this app.

| | |
|---|---|
| **Owner address** | \`${owner.toHex()}\` |
| **Topic (string)** | \`${FEED_TOPIC_STRING}\` |
| **Topic (hex)** | \`${topic.toHex()}\` |

The topic hex is \`keccak256\` of the topic string, so either form works:
\`Topic.fromString('${FEED_TOPIC_STRING}')\`.

After the first \`npm run publish\`, a feed manifest hash is also written to
\`archive.json\` — a single \`bzz\` address that resolves through any gateway.

## Recover the archive from these two values alone

With this repo:

\`\`\`bash
npm install
npm run recover -- \\
  --owner ${owner.toHex()} \\
  --topic "${FEED_TOPIC_STRING}" \\
  --bee ${PUBLIC_GATEWAY} \\
  --out ./restored
\`\`\`

Without this repo, against any Bee node, using nothing but curl:

\`\`\`bash
# resolve the feed to the current collection reference
curl -s "http://localhost:1633/feeds/${owner.toHex().replace(/^0x/, '')}/${topic.toHex()}?type=sequence"

# then fetch the collection, which carries its own index.json inventory
curl -s "http://localhost:1633/bzz/<reference-from-above>/index.json"
curl -sO "http://localhost:1633/bzz/<reference-from-above>/<path-from-index.json>"
\`\`\`

## What is NOT here

The publisher's private key. It lives in \`${'`'}publisher.key${'`'}\`, which is
gitignored, and it is only needed to *write* new updates. Reading requires
nothing. If the key is lost the archive stays readable forever — it simply
stops being updatable, which is the correct failure mode for an archive.
`
  writeFileSync(resolve(REPO_ROOT, 'ARCHIVE.md'), archiveMd)

  writeFileSync(
    resolve(REPO_ROOT, 'archive.json'),
    JSON.stringify(
      {
        archive: 'Spiti Valley birch-bark folio scans',
        feed: {
          owner: owner.toHex(),
          topicString: FEED_TOPIC_STRING,
          topicHex: topic.toHex(),
          manifest: null,
        },
        latest: null,
        storage: null,
        read: {
          gateway: null,
          withThisRepo: `npm run recover -- --owner ${owner.toHex()} --topic "${FEED_TOPIC_STRING}" --out ./restored`,
        },
      },
      null,
      2,
    ) + '\n',
  )

  console.log('\nWrote ARCHIVE.md and archive.json — commit both.')
  console.log('Back up publisher.key somewhere safe: lose it and the feed can never be updated again.\n')
}

main()
