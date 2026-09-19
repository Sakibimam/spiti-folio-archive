import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { INVENTORY_FILENAME, VIEWER_FILENAME } from './config.js'

export interface InventoryEntry {
  path: string
  bytes: number
  sha256: string
}

export interface Inventory {
  /** Human-readable description of what this address holds. */
  title: string
  description: string
  /**
   * The archive's own permanent address, carried INSIDE the archive.
   *
   * A reader who somehow ends up holding only a content hash can still learn
   * the feed it belongs to, and so can follow it forward to later versions.
   */
  feed: {
    owner: string
    topicString: string
    topicHex: string
    manifest: string
  }
  /** ISO timestamp of the publish that produced this inventory. */
  publishedAt: string
  /** Honest statement of paid-for lifetime, written at publish time. */
  storage: {
    batchId: string
    paidUntil: string
    daysRemainingAtPublish: number
    warning: string
  }
  fileCount: number
  totalBytes: number
  files: InventoryEntry[]
}

function walk(dir: string, root: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === INVENTORY_FILENAME || name === VIEWER_FILENAME || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, root, out)
    else out.push(relative(root, full).split(sep).join('/'))
  }
  return out
}

export function buildInventory(
  dir: string,
  meta: Omit<Inventory, 'fileCount' | 'totalBytes' | 'files'>,
): Inventory {
  const paths = walk(dir, dir).sort()
  const files: InventoryEntry[] = paths.map((p) => {
    const bytes = readFileSync(join(dir, p))
    return {
      path: p,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  })
  return {
    ...meta,
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    files,
  }
}

/**
 * The inventory is written INTO the uploaded collection, not just to disk.
 * That is what makes recovery possible with no local state: a reader who
 * resolves the feed gets the file list along with the files.
 */
export function writeInventory(dir: string, inventory: Inventory): void {
  writeFileSync(join(dir, INVENTORY_FILENAME), JSON.stringify(inventory, null, 2) + '\n')
}
