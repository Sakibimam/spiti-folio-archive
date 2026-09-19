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

interface ArchiveConfigFile {
  title: string
  description: string
  feedTopic: string
  sourceDirectory: string
  postage: {
    sizeGigabytes: number
    durationDays: number
    immutable: boolean
    label: string
    minAcceptableDaysToReuse: number
  }
  publicGateway: string
}

/**
 * Archive settings live in a TRACKED json file, not in source and not in .env.
 *
 * That placement is deliberate. The topic in particular has to be committed:
 * a reader must be able to rederive it from the repository alone, and a value
 * that existed only in an untracked env file would die with the publisher's
 * laptop — the exact failure this project exists to prevent. Environment
 * variables may override any of it for local experiments.
 */
const CONFIG_PATH = resolve(REPO_ROOT, 'archive.config.json')
const file = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ArchiveConfigFile

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return value !== undefined && Number.isFinite(parsed) ? parsed : fallback
}

export const BEE_API_URL = process.env.BEE_API_URL ?? 'http://localhost:1633'
export const PUBLIC_GATEWAY = process.env.PUBLIC_GATEWAY ?? file.publicGateway
export const PUBLISHER_KEY_FILE = resolve(REPO_ROOT, process.env.PUBLISHER_KEY_FILE ?? './publisher.key')
export const BATCH_ID_FROM_ENV = process.env.BATCH_ID?.trim() || undefined

export const ARCHIVE_TITLE = process.env.ARCHIVE_TITLE ?? file.title
export const ARCHIVE_DESCRIPTION = process.env.ARCHIVE_DESCRIPTION ?? file.description

/**
 * The feed topic. Hashed to 32 bytes with keccak256 by `Topic.fromString`,
 * so the human-readable string is the canonical published form.
 */
export const FEED_TOPIC_STRING = process.env.FEED_TOPIC ?? file.feedTopic

/** Directory whose contents are published as the archive. */
export const FOLIOS_DIR = resolve(REPO_ROOT, process.env.SOURCE_DIR ?? file.sourceDirectory)

export const POSTAGE = {
  sizeGigabytes: num(process.env.BATCH_SIZE_GB, file.postage.sizeGigabytes),
  durationDays: num(process.env.BATCH_DURATION_DAYS, file.postage.durationDays),
  immutable: process.env.BATCH_IMMUTABLE ? process.env.BATCH_IMMUTABLE === 'true' : file.postage.immutable,
  label: process.env.BATCH_LABEL ?? file.postage.label,
  minAcceptableDaysToReuse: num(
    process.env.BATCH_MIN_DAYS,
    file.postage.minAcceptableDaysToReuse,
  ),
}

/** Filename of the inventory written *inside* the uploaded collection. */
export const INVENTORY_FILENAME = 'index.json'

/**
 * The reader UI is uploaded WITH the archive and served as its index document,
 * so the published address opens a browsable page rather than a hex reference.
 * The archive carries its own interface; it does not depend on this repo, on
 * GitHub, or on anything the publisher keeps running.
 */
export const VIEWER_FILENAME = 'viewer.html'
export const VIEWER_SOURCE = resolve(REPO_ROOT, VIEWER_FILENAME)
