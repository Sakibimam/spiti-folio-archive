/**
 * Extend the archive's paid lifetime.
 *
 * The whole story behind this project is an invoice nobody renewed. A tool that
 * can only publish, and never top up, recreates that failure with extra steps —
 * so keeping the archive alive is a first-class command, not a footnote in a
 * README telling someone to go and learn swarm-cli.
 *
 *   npm run extend -- --days 7          extend by 7 days
 *   npm run extend -- --max             spend the wallet down to whatever fits
 *   npm run extend -- --days 7 --dry-run    price it without spending
 */
import { Duration } from '@ethersphere/bee-js'
import { makeBee, preflight } from './bee.js'
import { BATCH_ID_FROM_ENV } from './config.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const value = process.argv[i + 1]
  return value && !value.startsWith('--') ? value : 'true'
}

async function main(): Promise<void> {
  const bee = makeBee()
  const status = await preflight(bee)
  console.log(`\n${status.message}`)
  if (!status.canUpload) {
    process.exitCode = 1
    return
  }

  // Which batch? An explicit id, else the longest-lived usable one.
  const batches = await bee.stamp.getAll()
  const batch = BATCH_ID_FROM_ENV
    ? await bee.stamp.get(BATCH_ID_FROM_ENV)
    : batches
        .filter((b) => b.usable)
        .sort((a, b) => b.duration.toSeconds() - a.duration.toSeconds())[0]

  if (!batch) {
    console.error('No usable postage batch on this node. Nothing to extend.')
    process.exitCode = 1
    return
  }

  const wallet = await bee.wallet.getBalance()
  console.log(`\nBatch       : ${batch.batchID.toHex()}`)
  console.log(`Paid until  : ${batch.duration.toEndDate().toISOString()}`)
  console.log(`Remaining   : ${batch.duration.toDays().toFixed(2)} days`)
  console.log(`Wallet      : ${wallet.bzzBalance.toSignificantDigits(6)} xBZZ`)

  // How many days does the wallet actually afford? Priced from the node, so it
  // tracks the live storage price rather than a number baked into this file.
  const probeDays = 7
  const probeCost = await bee.storage.getDurationExtensionCost(
    batch.batchID,
    Duration.fromDays(probeDays),
  )
  const perDay = Number(probeCost.toDecimalString()) / probeDays
  const affordableDays = Number(wallet.bzzBalance.toDecimalString()) / perDay
  console.log(`Price       : ${perDay.toFixed(4)} xBZZ per day at the current rate`)
  console.log(`Affordable  : ${affordableDays.toFixed(2)} more days`)

  const wantMax = arg('max') === 'true'
  // Leave a 2% margin so a price tick between quote and send does not reject.
  const requested = wantMax ? affordableDays * 0.98 : Number(arg('days') ?? 7)

  if (!Number.isFinite(requested) || requested <= 0) {
    console.error('\nPass --days <n> or --max.')
    process.exitCode = 1
    return
  }

  const duration = Duration.fromDays(requested)
  const cost = await bee.storage.getDurationExtensionCost(batch.batchID, duration)
  const newEnd = new Date(batch.duration.toEndDate().getTime() + requested * 86400000)

  console.log(`\nExtend by   : ${requested.toFixed(2)} days`)
  console.log(`Cost        : ${cost.toSignificantDigits(6)} xBZZ`)
  console.log(`New expiry  : ${newEnd.toISOString()}`)

  if (cost.gt(wallet.bzzBalance)) {
    console.error(
      `\nNot enough xBZZ. Need ${cost.toSignificantDigits(6)}, ` +
        `have ${wallet.bzzBalance.toSignificantDigits(6)}.\n` +
        `  Try: npm run extend -- --days ${Math.floor(affordableDays)}   (or --max)`,
    )
    process.exitCode = 1
    return
  }

  if (arg('dry-run')) {
    console.log('\nDry run — nothing spent.')
    return
  }

  console.log('\nExtending...')
  const before = batch.duration.toSeconds()
  await bee.storage.extendDuration(batch.batchID, duration)

  // The transaction is accepted before Gnosis confirms it and before the node
  // re-reads the batch, so an immediate read returns the OLD ttl and makes a
  // successful extension look like a no-op. Poll until the node agrees, and say
  // plainly if it has not caught up rather than printing a stale number.
  console.log('Waiting for the chain to confirm...')
  let after = await bee.stamp.get(batch.batchID)
  for (let i = 0; i < 30 && after.duration.toSeconds() <= before; i += 1) {
    await new Promise((r) => setTimeout(r, 5000))
    after = await bee.stamp.get(batch.batchID)
  }

  if (after.duration.toSeconds() <= before) {
    console.warn(
      `\nSpent, but the node still reports ${after.duration.toDays().toFixed(2)} days.\n` +
        `  The top-up transaction is most likely still confirming on Gnosis.\n` +
        `  Re-check in a minute with: npm run status`,
    )
    return
  }

  console.log(`\nDone. Paid until ${after.duration.toEndDate().toISOString()}`)
  console.log(
    `      ${before / 86400 < 1 ? '' : ''}${(before / 86400).toFixed(2)} days -> ` +
      `${after.duration.toDays().toFixed(2)} days`,
  )
  console.log('      Run `npm run publish` to refresh STATUS.md with the new date.\n')
}

main().catch((error) => {
  console.error('\nExtend failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
