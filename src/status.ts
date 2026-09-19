/**
 * Reports how long the archive is actually paid for, read live from the node.
 * Nothing here is hardcoded — every number comes from `bee.stamp`.
 */
import { makeBee, preflight } from './bee.js'
import { BATCH_ID_FROM_ENV, FEED_TOPIC_STRING } from './config.js'
import { hasIdentity, loadPrivateKey, ownerAddress } from './identity.js'
import { Topic } from '@ethersphere/bee-js'

function bar(fraction: number, width = 24): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

async function main(): Promise<void> {
  const bee = makeBee()
  const status = await preflight(bee)
  console.log(`\n${status.message}\n`)
  if (!status.reachable) {
    process.exitCode = 1
    return
  }

  const batches = BATCH_ID_FROM_ENV
    ? [await bee.stamp.get(BATCH_ID_FROM_ENV)]
    : await bee.stamp.getAll()

  if (batches.length === 0) {
    console.log('No postage batches on this node. Nothing is paid for; nothing can be uploaded.')
    console.log('Run `npm run publish` to buy one (requires light mode).\n')
    return
  }

  console.log('Postage batches — how long the data is actually paid for')
  console.log('═'.repeat(68))
  for (const batch of batches) {
    const days = batch.duration.toDays()
    const endsAt = batch.duration.toEndDate()
    const label =
      days < 3 ? 'EXPIRING' : days < 14 ? 'SHORT' : days < 90 ? 'LIMITED' : 'FUNDED'

    console.log(`\n  ${batch.batchID.toHex()}`)
    console.log(`    Label       : ${batch.label || '(none)'}`)
    console.log(`    Status      : ${label}${batch.usable ? '' : '  (not yet usable)'}`)
    console.log(`    Paid until  : ${endsAt.toISOString()}`)
    console.log(`    Remaining   : ${days.toFixed(1)} days`)
    console.log(`    Capacity    : ${bar(batch.usage)} ${batch.usageText}`)
    console.log(`                  ${batch.remainingSize.toFormattedString()} free of ${batch.size.toFormattedString()}`)
    console.log(`    Type        : ${batch.immutableFlag ? 'immutable' : 'mutable'}  depth ${batch.depth}`)
  }
  console.log('\n' + '═'.repeat(68))
  console.log('Swarm storage is prepaid. When a batch expires its chunks stop being')
  console.log('served and the published address resolves to nothing. Top up before then.\n')

  // Feed position — a guarded read, because an unpublished feed is not an error.
  if (hasIdentity()) {
    const owner = ownerAddress(loadPrivateKey())
    const topic = Topic.fromString(FEED_TOPIC_STRING)
    const reader = bee.feed.makeReader(topic, owner)
    try {
      const latest = await reader.downloadReference()
      console.log(`Feed ${owner.toHex()} / "${FEED_TOPIC_STRING}"`)
      console.log(`  at index ${latest.feedIndex.toBigInt()} -> ${latest.reference.toHex()}\n`)
    } catch {
      console.log(`Feed ${owner.toHex()} / "${FEED_TOPIC_STRING}"`)
      console.log('  has no updates yet — nothing published. Run `npm run publish`.\n')
    }
  }
}

main().catch((error) => {
  console.error('Status check failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
