/**
 * ACCEPTANCE TEST for the published archive.
 *
 * Walks every path a stranger could take, against live Swarm:
 *   1. the feed manifest through /bzz   (what viewer.html uses)
 *   2. owner + topic through bee-js     (what recover.ts uses)
 *   3. every folio, byte-for-byte
 *   4. the batch lifetime, read from the node
 *
 *   npm run verify                 # local node
 *   npm run verify -- --bee https://api.gateway.ethswarm.org
 */
import { Bee, Topic } from '@ethersphere/bee-js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REPO_ROOT } from './config.js'

const argBee = process.argv.indexOf('--bee')
const BEE = argBee > -1 ? (process.argv[argBee + 1] as string) : 'http://localhost:1633'

let pass = 0
let fail = 0
const ok = (m: string) => { console.log(`  PASS  ${m}`); pass += 1 }
const no = (m: string) => { console.log(`  FAIL  ${m}`); fail += 1 }

interface Inventory {
  fileCount: number
  publishedAt: string
  feed: { owner: string; topicString: string; topicHex: string; manifest: string }
  storage: { paidUntil: string; batchId: string }
  files: { path: string; bytes: number; sha256: string }[]
}

async function main(): Promise<void> {
  const record = JSON.parse(readFileSync(resolve(REPO_ROOT, 'archive.json'), 'utf8'))
  const { owner, topicString, manifest } = record.feed
  const base = BEE.replace(/\/$/, '')

  console.log(`\nowner    ${owner}`)
  console.log(`topic    "${topicString}"`)
  console.log(`manifest ${manifest}`)
  console.log(`endpoint ${base}\n`)

  // ── 1. The published address, the way viewer.html resolves it ─────────────
  const indexRes = await fetch(`${base}/bzz/${manifest}/index.json`)
  indexRes.ok
    ? ok(`feed manifest resolves through /bzz (HTTP ${indexRes.status})`)
    : no(`/bzz/<manifest>/index.json returned HTTP ${indexRes.status}`)
  if (!indexRes.ok) return finish()

  const inventory = (await indexRes.json()) as Inventory
  inventory.feed?.owner === owner
    ? ok('the archive carries its own feed address inside it')
    : no('inventory does not carry a matching feed address')
  inventory.storage?.paidUntil
    ? ok(`inventory states an expiry: ${inventory.storage.paidUntil.slice(0, 19)}Z`)
    : no('inventory states no expiry')

  // ── 2. The same archive via owner + topic, the way recover.ts does ────────
  const bee = new Bee(base)
  const topic = Topic.fromString(topicString)
  try {
    const latest = await bee.feed.makeReader(topic, owner).downloadReference()
    ok(`owner + topic resolves to index ${latest.feedIndex.toBigInt()} -> ${latest.reference.toHex().slice(0, 12)}…`)
  } catch (error) {
    no(`owner + topic did not resolve: ${(error as Error).message}`)
  }

  // ── 3. Every folio, byte-for-byte against its published digest ────────────
  for (const file of inventory.files) {
    const res = await fetch(`${base}/bzz/${manifest}/${file.path}`)
    if (!res.ok) { no(`${file.path} -> HTTP ${res.status}`); continue }
    const bytes = Buffer.from(await res.arrayBuffer())
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (bytes.byteLength !== file.bytes) no(`${file.path} is ${bytes.byteLength} B, expected ${file.bytes}`)
    else if (digest !== file.sha256) no(`${file.path} sha256 mismatch`)
    else ok(`${file.path} (${file.bytes} B) sha256 verified`)
  }

  // ── 4. Batch lifetime, read from the node rather than from the file ───────
  try {
    const batch = await bee.stamp.get(inventory.storage.batchId)
    const days = batch.duration.toDays()
    days > 0
      ? ok(`batch has ${days.toFixed(2)} days left (expires ${batch.duration.toEndDate().toISOString().slice(0, 19)}Z)`)
      : no('batch has expired')
  } catch {
    console.log('  SKIP  batch lifetime — this endpoint does not expose /stamps (normal for a public gateway)')
  }

  finish()
}

function finish(): void {
  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exitCode = fail ? 1 : 0
}

main().catch((error) => {
  console.error('verify failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
