import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Minimal .env loader. Avoids a dependency and makes it obvious that nothing
 * secret is required to *read* the archive — only to publish to it.
 */
function loadEnvFile(): void {
  const path = resolve(REPO_ROOT, '.env')
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnvFile()

export const BEE_API_URL = process.env.BEE_API_URL ?? 'http://localhost:1633'
export const PUBLIC_GATEWAY = process.env.PUBLIC_GATEWAY ?? 'https://api.gateway.ethswarm.org'
export const PUBLISHER_KEY_FILE = resolve(REPO_ROOT, process.env.PUBLISHER_KEY_FILE ?? './publisher.key')
export const BATCH_ID_FROM_ENV = process.env.BATCH_ID?.trim() || undefined

/**
 * The feed topic is a CONSTANT, derived by keccak256 from this exact string.
 *
 * It is deliberately hardcoded and committed rather than randomly generated,
 * because a reader must be able to rederive it from the published documentation
 * alone: `Topic.fromString(FEED_TOPIC_STRING)`. A random topic stored only on
 * the publisher's disk would die with the publisher's disk.
 */
export const FEED_TOPIC_STRING = 'spiti-folio-archive-v1'

/** Directory whose contents are published as the archive. */
export const FOLIOS_DIR = resolve(REPO_ROOT, 'folios')

/** Filename of the inventory written *inside* the uploaded collection. */
export const INVENTORY_FILENAME = 'index.json'
