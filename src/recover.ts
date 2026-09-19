/**
 * RECOVERY ENTRYPOINT
 * ===================
 *
 * This file is the whole point of the project. It takes ONLY:
 *
 *   --owner  <0x…>   the feed owner's address        (published)
 *   --topic  <text>  the feed topic string           (published)
 *   --bee    <url>   any Bee endpoint or gateway     (the reader's own)
 *
 * …or, equivalently, a single published feed manifest reference:
 *
 *   --manifest <hash> --bee <url>
 *
 * It reads NO local index, NO database, NO state file, NO archive.json, and
 * needs no credential of any kind. Nothing this repo stores on disk is
 * consulted. Delete the publishing app, delete this repo's data files, lose
 * the publisher's key — the archive still comes back from the two public
 * identifiers alone.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Bee, MantarayNode, Topic } from '@ethersphere/bee-js'

interface Args {
  owner?: string
  topic?: string
  manifest?: string
  bee: string
  out: string
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token && token.startsWith('--')) {
      const key = token.slice(2)
      const value = argv[i + 1]
      if (value && !value.startsWith('--')) {
        args[key] = value
        i += 1
      } else {
        args[key] = 'true'
      }
    }
  }
  return {
    owner: args.owner,
    topic: args.topic,
    manifest: args.manifest,
    bee: args.bee ?? process.env.BEE_API_URL ?? 'http://localhost:1633',
    out: args.out ?? './restored',
  }
}

const USAGE = `
Recover a Swarm archive from its published identifiers alone.

  npx tsx src/recover.ts --owner <0x…> --topic "<topic string>" [--bee <url>] [--out <dir>]
  npx tsx src/recover.ts --manifest <hash>  [--bee <url>] [--out <dir>]

  --bee defaults to http://localhost:1633
        A public gateway also works: --bee https://api.gateway.ethswarm.org
`

/**
 * Resolve the archive's current collection reference.
 *
 * Reading a feed that has never been written is a defined state, not a crash:
 * we report it and exit cleanly.
 */
async function resolveCollectionReference(bee: Bee, args: Args): Promise<string | null> {
  if (args.manifest) {
    console.log(`Resolving feed manifest ${args.manifest}`)
    return args.manifest
  }

  const topic = Topic.fromString(args.topic as string)
  console.log(`Resolving feed`)
  console.log(`  owner : ${args.owner}`)
  console.log(`  topic : "${args.topic}" -> ${topic.toHex()}`)

  const reader = bee.feed.makeReader(topic, args.owner as string)
  try {
    const latest = await reader.downloadReference()
    console.log(`  feed index ${latest.feedIndex.toBigInt()}`)
    console.log(`  -> collection ${latest.reference.toHex()}`)
    return latest.reference.toHex()
  } catch (error) {
    console.error(
      `\nNo updates found on this feed.\n` +
        `  Either nothing has been published to it yet, or the owner/topic pair is wrong,\n` +
        `  or this Bee endpoint cannot reach the chunks.\n` +
        `  (${error instanceof Error ? error.message : String(error)})`,
    )
    return null
  }
}

/**
 * Enumerate every file in the collection by walking its Mantaray manifest,
 * downloaded from the network. This is what makes the recovery stateless:
 * the file list lives in Swarm, not on the publisher's disk.
 */
async function listPaths(bee: Bee, reference: string): Promise<string[]> {
  try {
    const node = await MantarayNode.unmarshal(bee, reference)
    await node.loadRecursively(bee)
    const map = node.collectAndMap()
    const paths = Object.keys(map).filter((p) => p && !p.endsWith('/'))
    if (paths.length > 0) return paths.sort()
  } catch (error) {
    console.warn(`  Could not walk the manifest directly (${(error as Error).message}).`)
  }

  // Fallback: the archive carries its own inventory at index.json.
  console.log('  Falling back to the collection’s own index.json inventory.')
  const indexFile = await bee.file.download(reference, 'index.json')
  const inventory = JSON.parse(indexFile.data.toUtf8()) as { files: { path: string }[] }
  return inventory.files.map((f) => f.path).sort()
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (!args.manifest && (!args.owner || !args.topic)) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const bee = new Bee(args.bee)
  console.log(`\nReading from ${args.bee}\n`)

  const reference = await resolveCollectionReference(bee, args)
  if (!reference) {
    process.exitCode = 1
    return
  }

  console.log('\nEnumerating archive contents from the network')
  const paths = await listPaths(bee, reference)
  console.log(`  ${paths.length} files`)

  const outDir = resolve(process.cwd(), args.out)
  mkdirSync(outDir, { recursive: true })

  let restored = 0
  let failed = 0
  for (const path of paths) {
    try {
      const file = await bee.file.download(reference, path)
      const target = join(outDir, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.data.toUint8Array())
      console.log(`  ✓ ${path} (${file.data.length} bytes)`)
      restored += 1
    } catch (error) {
      console.error(`  ✗ ${path} — ${(error as Error).message}`)
      failed += 1
    }
  }

  console.log(`\nRestored ${restored} file(s) to ${outDir}`)
  if (failed > 0) {
    console.error(`${failed} file(s) could not be retrieved.`)
    process.exitCode = 1
  } else {
    console.log('The archive is recoverable from its published address alone.\n')
  }
}

main().catch((error) => {
  console.error('\nRecovery failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
