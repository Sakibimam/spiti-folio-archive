import { Bee } from '@ethersphere/bee-js'
import { BEE_API_URL } from './config.js'

export function makeBee(url: string = BEE_API_URL): Bee {
  return new Bee(url)
}

export interface NodePreflight {
  reachable: boolean
  beeMode?: string
  canUpload: boolean
  message: string
}

/**
 * A fresh Bee node starts in ULTRA-LIGHT mode, which can only download. Buying a
 * postage batch requires LIGHT mode, which only happens after the gift code is
 * redeemed, the node restarts, and the postage stamp store has synced.
 *
 * Failing here with a clear message saves an hour of debugging "upload failed".
 */
export async function preflight(bee: Bee): Promise<NodePreflight> {
  let beeMode: string | undefined
  try {
    const info = await bee.status.getNodeInfo()
    beeMode = String(info.beeMode)
  } catch {
    return {
      reachable: false,
      canUpload: false,
      message:
        `Cannot reach a Bee node at ${BEE_API_URL}.\n` +
        `  Install Swarm Desktop (https://desktop.ethswarm.org), start it, and\n` +
        `  confirm with: curl localhost:1633`,
    }
  }

  if (beeMode === 'ultra-light') {
    return {
      reachable: true,
      beeMode,
      canUpload: false,
      message:
        `Node is in ULTRA-LIGHT mode — it can download but cannot buy a postage batch.\n` +
        `  Nothing is broken; the gift code has not landed yet.\n` +
        `  Redeem it in Swarm Desktop (Info tab -> Setup wallet), wait for the restart\n` +
        `  and for the postage stamp store to sync, then check that Mode says "light".`,
    }
  }

  return {
    reachable: true,
    beeMode,
    canUpload: true,
    message: `Node reachable at ${BEE_API_URL}, mode: ${beeMode}.`,
  }
}
