import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { PrivateKey, EthAddress } from '@ethersphere/bee-js'
import { PUBLISHER_KEY_FILE } from './config.js'

/**
 * The publisher identity is a plain secp256k1 key. Its *address* is public and
 * gets committed to ARCHIVE.md; the key itself never leaves this machine and is
 * excluded by .gitignore.
 */
export function loadPrivateKey(): PrivateKey {
  if (!existsSync(PUBLISHER_KEY_FILE)) {
    throw new Error(
      `No publisher key at ${PUBLISHER_KEY_FILE}.\n` +
        `Run \`npm run init\` once to create one.`,
    )
  }
  const hex = readFileSync(PUBLISHER_KEY_FILE, 'utf8').trim()
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${PUBLISHER_KEY_FILE} does not contain a 32-byte hex private key.`)
  }
  return new PrivateKey(hex.replace(/^0x/, ''))
}

export function createPrivateKey(): PrivateKey {
  const key = new PrivateKey(randomBytes(32))
  writeFileSync(PUBLISHER_KEY_FILE, key.toHex(), { mode: 0o600 })
  chmodSync(PUBLISHER_KEY_FILE, 0o600)
  return key
}

export function ownerAddress(key: PrivateKey): EthAddress {
  return key.publicKey().address()
}

export function hasIdentity(): boolean {
  return existsSync(PUBLISHER_KEY_FILE)
}
