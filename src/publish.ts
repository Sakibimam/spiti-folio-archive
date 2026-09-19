import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  Bee,
  BatchId,
  Duration,
  FeedIndex,
  PostageBatch,
  Reference,
  Size,
  Topic,
} from '@ethersphere/bee-js'
import { makeBee, preflight } from './bee.js'
import { loadPrivateKey, ownerAddress } from './identity.js'
import { buildInventory, writeInventory } from './inventory.js'
import { INVENTORY_FILENAME } from './config.js'
import {
  ARCHIVE_DESCRIPTION,
  ARCHIVE_TITLE,
  BATCH_ID_FROM_ENV,
  FEED_TOPIC_STRING,
  FOLIOS_DIR,
  POSTAGE,
  PUBLIC_GATEWAY,
  REPO_ROOT,
} from './config.js'

/** Pick an existing usable batch, or buy one. */
async function resolveBatch(bee: Bee): Promise<PostageBatch> {
  if (BATCH_ID_FROM_ENV) {
    const batch = await bee.stamp.get(BATCH_ID_FROM_ENV)
    console.log(`  Using batch from BATCH_ID: ${batch.batchID.toHex()}`)
    return batch
  }

  const existing = await bee.stamp.getAll()
  const reusable = existing
    .filter(
      (b) =>
        b.usable &&
        b.duration.toDays() > POSTAGE.minAcceptableDaysToReuse &&
        b.remainingSize.toBytes() > 0,
    )
    .sort((a, b) => b.duration.toSeconds() - a.duration.toSeconds())[0]

  if (reusable) {
    console.log(`  Reusing batch ${reusable.batchID.toHex()} (${reusable.duration.toDays().toFixed(1)} days left)`)
    return reusable
  }

  console.log(
    `  No usable batch found. Buying one ` +
      `(${POSTAGE.sizeGigabytes} GB / ${POSTAGE.durationDays} days, ` +
      `${POSTAGE.immutable ? 'immutable' : 'mutable'})...`,
  )
  const batchId: BatchId = await bee.storage.buy(
    Size.fromGigabytes(POSTAGE.sizeGigabytes),
    Duration.fromDays(POSTAGE.durationDays),
    {
      label: POSTAGE.label,
      // Mutable by default: feeds are republished repeatedly, and an immutable
      // batch becomes unusable once its buckets fill. See README.
      immutableFlag: POSTAGE.immutable,
    },
  )
  console.log(`  Bought batch ${batchId.toHex()}. Waiting for it to become usable...`)
  return await bee.stamp.get(batchId)
}

/**
 * Resolve the next feed index by READING THE FEED FROM THE NETWORK.
 *
 * This is deliberately never cached, never counted locally and never persisted.
 * A local counter would desynchronise the moment the app is reinstalled, run
 * from a second machine, or the state file is lost — which is the exact failure
 * this whole project exists to avoid.
 *
 * An empty feed (nothing published yet) is a normal first-run state, not an
 * error: it resolves to index 0.
 */
async function resolveNextIndex(bee: Bee, topic: Topic, owner: ReturnType<typeof ownerAddress>): Promise<FeedIndex> {
  const reader = bee.feed.makeReader(topic, owner)
  try {
    const latest = await reader.downloadReference()
    const next = latest.feedIndexNext
    if (!next) {
      // Only set on the latest update; absent means we fetched an exact index.
      throw new Error('feedIndexNext missing from feed response')
    }
    console.log(
      `  Feed currently at index ${latest.feedIndex.toBigInt()} ` +
        `-> next index ${next.toBigInt()} (resolved from the network)`,
    )
    return next
  } catch (error) {
    console.log(`  No updates on this feed yet (${(error as Error).message}). Starting at index 0.`)
    return FeedIndex.fromBigInt(0n)
  }
}

async function main(): Promise<void> {
  const bee = makeBee()

  console.log('\nChecking the node...')
  const status = await preflight(bee)
  console.log(`  ${status.message}`)
  if (!status.canUpload) {
    console.error('\nCannot publish yet. See the message above.')
    process.exitCode = 1
    return
  }

  const privateKey = loadPrivateKey()
  const owner = ownerAddress(privateKey)
  const topic = Topic.fromString(FEED_TOPIC_STRING)

  console.log('\nIdentity')
  console.log(`  Owner address : ${owner.toHex()}`)
  console.log(`  Topic string  : "${FEED_TOPIC_STRING}"`)
  console.log(`  Topic (hex)   : ${topic.toHex()}`)

  console.log('\nPostage batch')
  const batch = await resolveBatch(bee)

  // ── Batch lifetime, read from the node and carried into every output ──────
  const daysRemaining = batch.duration.toDays()
  const paidUntil = batch.duration.toEndDate()
  console.log(`  Batch ID      : ${batch.batchID.toHex()}`)
  console.log(`  Depth         : ${batch.depth}   Usable: ${batch.usable}   Mutable: ${!batch.immutableFlag}`)
  console.log(`  Capacity      : ${batch.remainingSize.toFormattedString()} free of ${batch.size.toFormattedString()} (${batch.usageText} used)`)
  console.log(`  PAID UNTIL    : ${paidUntil.toISOString()}  (${daysRemaining.toFixed(1)} days from now)`)
  console.log(`  After that date this archive stops being served unless the batch is topped up.`)

  // ── 1. Upload the archive contents as their own collection ───────────────
  console.log('\nUploading archive contents')
  const inventory = buildInventory(FOLIOS_DIR, {
    title: ARCHIVE_TITLE,
    description: ARCHIVE_DESCRIPTION,
    publishedAt: new Date().toISOString(),
    storage: {
      batchId: batch.batchID.toHex(),
      paidUntil: paidUntil.toISOString(),
      daysRemainingAtPublish: Number(daysRemaining.toFixed(2)),
      warning:
        'Swarm storage is prepaid, not permanent. After paidUntil the postage ' +
        'batch expires and these chunks stop being served. Top the batch up to extend it.',
    },
  })
  writeInventory(FOLIOS_DIR, inventory)
  console.log(`  ${inventory.fileCount} files, ${inventory.totalBytes} bytes (plus index.json)`)

  const uploaded = await bee.collection.uploadFromDirectory(batch.batchID, FOLIOS_DIR, {
    pin: true,
    deferred: false,
    indexDocument: INVENTORY_FILENAME,
  })
  const collectionReference: Reference = uploaded.reference
  console.log(`  Collection reference: ${collectionReference.toHex()}`)
  console.log('  (this hash changes every time the contents change — it is NOT the published address)')

  // ── 2. Write that reference into the feed ────────────────────────────────
  console.log('\nUpdating the feed')
  const nextIndex = await resolveNextIndex(bee, topic, owner)
  const writer = bee.feed.makeWriter(topic, privateKey)

  // uploadReference stores a POINTER to the collection, not its bytes. The
  // archive is far larger than one 4 KB chunk, so the payload must be a
  // reference; bee-js resolves the append index from the network when `index`
  // is omitted, and we pass the index we just read for an explicit audit trail.
  const update = await writer.uploadReference(batch.batchID, collectionReference, {
    index: nextIndex,
    deferred: false,
  })
  console.log(`  Wrote index ${nextIndex.toBigInt()} -> ${collectionReference.toHex()}`)
  console.log(`  Update chunk: ${update.reference.toHex()}`)

  // ── 3. Feed manifest: one stable bzz address a stranger can be handed ────
  const feedManifest = await bee.feed.createManifest(batch.batchID, topic, owner)
  console.log(`\n  Feed manifest: ${feedManifest.toHex()}`)

  // ── 4. Publish the identifiers into tracked files ───────────────────────
  const record = {
    archive: ARCHIVE_TITLE,
    feed: {
      owner: owner.toHex(),
      topicString: FEED_TOPIC_STRING,
      topicHex: topic.toHex(),
      manifest: feedManifest.toHex(),
    },
    latest: {
      index: Number(nextIndex.toBigInt()),
      collectionReference: collectionReference.toHex(),
      publishedAt: inventory.publishedAt,
      fileCount: inventory.fileCount,
      totalBytes: inventory.totalBytes,
    },
    storage: inventory.storage,
    read: {
      gateway: `${PUBLIC_GATEWAY}/bzz/${feedManifest.toHex()}/`,
      withThisRepo: `npm run recover -- --owner ${owner.toHex()} --topic "${FEED_TOPIC_STRING}" --out ./restored`,
    },
  }
  writeFileSync(resolve(REPO_ROOT, 'archive.json'), JSON.stringify(record, null, 2) + '\n')
  writeStatusMarkdown(record, batch)

  console.log('\n─────────────────────────────────────────────────────────────')
  console.log('  THE ADDRESS TO PUBLISH (stable across every future update):')
  console.log(`    owner : ${owner.toHex()}`)
  console.log(`    topic : "${FEED_TOPIC_STRING}"`)
  console.log(`    bzz   : ${PUBLIC_GATEWAY}/bzz/${feedManifest.toHex()}/`)
  console.log('─────────────────────────────────────────────────────────────')
  console.log(`\n  Paid for until ${paidUntil.toISOString()} — ${daysRemaining.toFixed(1)} days.`)
  console.log('  Written to archive.json and STATUS.md.\n')
}

function writeStatusMarkdown(record: Record<string, any>, batch: PostageBatch): void {
  const days = batch.duration.toDays()
  const urgency =
    days < 3 ? '🔴 EXPIRING' : days < 14 ? '🟠 SHORT' : days < 90 ? '🟡 LIMITED' : '🟢 FUNDED'
  const md = `# Archive status

_Generated by \`npm run publish\` on ${new Date().toISOString()}. Do not edit by hand._

## How long this data is actually paid for

| | |
|---|---|
| Status | **${urgency}** |
| Paid until | **${record.storage.paidUntil}** |
| Days remaining | **${days.toFixed(1)}** |
| Postage batch | \`${batch.batchID.toHex()}\` |
| Batch type | ${batch.immutableFlag ? 'immutable' : 'mutable'} |
| Capacity used | ${batch.usageText} (${batch.remainingSize.toFormattedString()} free of ${batch.size.toFormattedString()}) |

Swarm storage is **prepaid, not permanent**. The manuscripts survived eight
centuries in an unheated room; these scans survive exactly as long as this
postage batch is funded. When the date above passes, the chunks stop being
served and the address below resolves to nothing.

To extend it, top the batch up — see \`README.md\`.

## The published address

| | |
|---|---|
| Owner | \`${record.feed.owner}\` |
| Topic | \`${record.feed.topicString}\` |
| Feed manifest | \`${record.feed.manifest}\` |
| Latest feed index | ${record.latest.index} |
| Latest collection | \`${record.latest.collectionReference}\` |
| Files | ${record.latest.fileCount} (${record.latest.totalBytes} bytes) |
`
  writeFileSync(resolve(REPO_ROOT, 'STATUS.md'), md)
}

main().catch((error) => {
  console.error('\nPublish failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
