/**
 * Cardano wallet service — handles CIP-30 wallet detection, connection,
 * and the challenge-response authentication flow.
 */

import type {
  CardanoWalletApi,
  CardanoWalletId,
  WalletInfo,
  DataSignature,
} from './cardano-types'
import { apiClient } from './api-client'
import { supabase } from './supabase'
import type { AuthUser } from './auth-service'
import type { Session } from '@supabase/supabase-js'

// ── Known wallets ─────────────────────────────────────────────────────

interface KnownWallet {
  id: CardanoWalletId
  name: string
  keys: string[]
}

const KNOWN_WALLETS: KnownWallet[] = [
  { id: 'eternl', name: 'Eternl', keys: ['eternl'] },
  { id: 'lace', name: 'Lace', keys: ['lace'] },
  // Typhon versions may expose either `typhonwallet` or `typhoncip30`.
  { id: 'typhonwallet', name: 'Typhon', keys: ['typhonwallet', 'typhoncip30'] },
  { id: 'yoroi', name: 'Yoroi', keys: ['yoroi'] },
]

function resolveWalletEntry(walletId: CardanoWalletId) {
  const descriptor = KNOWN_WALLETS.find((wallet) => wallet.id === walletId)
  if (!descriptor || !window.cardano) return null

  for (const key of descriptor.keys) {
    const entry = window.cardano[key]
    if (entry) {
      return entry
    }
  }

  return null
}

// ── Wallet detection ──────────────────────────────────────────────────

/**
 * Detect which Cardano wallets are installed in the browser.
 * Returns an array of wallet info objects with their availability.
 */
export function detectWallets(): WalletInfo[] {
  if (typeof window === 'undefined' || !window.cardano) {
    return KNOWN_WALLETS.map((w) => ({ ...w, installed: false }))
  }

  return KNOWN_WALLETS.map((w) => {
    const entry = w.keys
      .map((key) => window.cardano?.[key])
      .find((candidate) => !!candidate)

    return {
      id: w.id,
      name: w.name,
      installed: !!entry,
      icon: entry?.icon,
    }
  })
}

/**
 * Check if any Cardano wallet is available in the browser.
 */
export function hasCardanoWallet(): boolean {
  return detectWallets().some((w) => w.installed)
}

// ── Wallet connection ─────────────────────────────────────────────────

/**
 * Connect to a specific Cardano wallet via CIP-30.
 * @param walletId - The wallet identifier (e.g. 'nami', 'eternl')
 * @returns The CIP-30 wallet API
 * @throws If wallet is not installed or user rejects connection
 */
export async function connectWallet(walletId: CardanoWalletId): Promise<CardanoWalletApi> {
  if (!window.cardano) {
    throw new Error('No Cardano wallet detected. Please install a wallet extension.')
  }

  const walletEntry = resolveWalletEntry(walletId)
  if (!walletEntry) {
    throw new Error(`${walletId} wallet is not installed. Please install it and try again.`)
  }

  try {
    // Race enable() against a timeout — some wallets hang after authorization
    const api = await Promise.race([
      walletEntry.enable(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Wallet authorization timed out. Please try again.')), 30000)
      ),
    ])

    if (!api || typeof api.getUsedAddresses !== 'function') {
      throw new Error('Wallet returned an invalid API. Please try reconnecting.')
    }

    return api
  } catch (error: unknown) {
    // Wallets may throw strings, objects, or Error instances
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error) || 'Connection failed'

    if (message.includes('refuse') || message.includes('reject') || message.includes('denied') || message.includes('cancel')) {
      throw new Error('Wallet connection was rejected. Please approve the connection request.')
    }
    throw new Error(`Failed to connect to ${walletId}: ${message}`)
  }
}

/**
 * Get the primary address from a connected wallet.
 * CIP-30 returns hex-encoded CBOR address bytes.
 */
export async function getWalletAddress(api: CardanoWalletApi): Promise<string> {
  const addresses = await api.getUsedAddresses()
  if (!addresses || addresses.length === 0) {
    // Try unused addresses as fallback
    const unused = await api.getUnusedAddresses()
    if (!unused || unused.length === 0) {
      throw new Error('No addresses found in wallet. Please ensure your wallet has been set up.')
    }
    return unused[0]
  }
  return addresses[0]
}

// ── Hex encoding helpers ──────────────────────────────────────────────

/** Convert a UTF-8 string to hex */
function toHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Challenge-response authentication ─────────────────────────────────

/**
 * Full wallet authentication flow:
 * 1. Connect to wallet
 * 2. Get address
 * 3. Request challenge from backend
 * 4. Sign challenge with wallet
 * 5. Submit signed challenge to backend
 * 6. Set Supabase session
 *
 * @param walletId - The wallet to authenticate with
 * @returns The authenticated user and session
 */
export async function signInWithCardanoWallet(
  walletId: CardanoWalletId,
  captchaToken?: string,
): Promise<{ session: Session; user: AuthUser }> {
  // Step 1: Connect to wallet
  const api = await connectWallet(walletId)

  // Step 2: Get the wallet address (hex-encoded from CIP-30)
  const hexAddress = await getWalletAddress(api)

  // Step 3: Request a challenge from the backend
  let challengeResponse
  try {
    challengeResponse = await apiClient.post('/api/auth/wallet/challenge', {
      address: hexAddress,
      captchaToken,
    })
  } catch (err: unknown) {
    // Extract the server message from the Axios error response
    const axiosErr = err as { response?: { status?: number; data?: { message?: string } } }
    const serverMsg = axiosErr?.response?.data?.message || ''
    const status = axiosErr?.response?.status

    if (status === 400 && (serverMsg.toLowerCase().includes('captcha') || serverMsg.toLowerCase().includes('verification'))) {
      throw new Error('Please complete the human verification checkbox (Cloudflare) before connecting your wallet.')
    }
    // Re-throw with server message if available, otherwise the original error
    if (serverMsg) throw new Error(serverMsg)
    throw err
  }

  const { nonce } = challengeResponse.data
  if (!nonce) {
    throw new Error('Failed to receive authentication challenge')
  }

  // Step 4: Build a short human-readable message and sign it.
  // The message shows intent in the wallet prompt. Kept short (< 80 chars)
  // to avoid Lace's signData dialog breaking on long payloads.
  const signMessage = `Coordination Manager Login\nNonce: ${nonce}`
  const hexPayload = toHex(signMessage)
  let dataSignature: DataSignature

  try {
    dataSignature = await api.signData(hexAddress, hexPayload)
  } catch (error: unknown) {
    // CIP-30 DataSignError is a plain object: { code: number, info: string }
    // Code 1 = ProofGeneration, 2 = AddressNotPK, 3 = UserDeclined, 4 = InvalidFormat
    const cipErr = error as Record<string, unknown>
    if (cipErr && typeof cipErr === 'object' && 'code' in cipErr) {
      const code = cipErr.code as number
      const info = ((cipErr.info as string) || '').trim()
      if (code === 3) throw new Error('Signing was cancelled. If the wallet prompt looked broken or frozen, close all open wallet windows and try again.')
      if (code === 2) throw new Error('This address cannot sign data. Try reconnecting your wallet.')
      if (code === 1) throw new Error(`Wallet could not generate a proof.${info ? ' ' + info : ''}`)
      throw new Error(`Wallet signing error (code ${code})${info ? ': ' + info : ''}`)
    }
    if (error instanceof Error) {
      const m = error.message.toLowerCase()
      if (m.includes('declined') || m.includes('rejected') || m.includes('cancel')) {
        throw new Error('Signing was cancelled. If the wallet prompt looked broken or frozen, close all open wallet windows and try again.')
      }
      throw new Error(`Failed to sign challenge: ${error.message}`)
    }
    throw new Error(`Failed to sign challenge: ${JSON.stringify(error) || 'Wallet returned an unexpected error'}`)
  }

  // Step 5: Submit the signed challenge to the backend for verification
  const verifyResponse = await apiClient.post('/api/auth/wallet/verify', {
    address: hexAddress,
    nonce,
    signature: dataSignature.signature,
    key: dataSignature.key,
  })

  const { session: sessionData, user } = verifyResponse.data

  // Step 6: Set the Supabase session
  // Clear any stale local auth state first to prevent internal lock contention
  // that can cause the Supabase client to throw an "AbortError: Signal Aborted"
  // when setSession() races with an ongoing background token refresh.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {})

  const { data, error } = await supabase.auth.setSession({
    access_token: sessionData.access_token,
    refresh_token: sessionData.refresh_token,
  })

  if (error || !data.session) {
    throw new Error('Failed to establish wallet session')
  }

  return {
    session: data.session,
    user: {
      id: user.id,
      email: user.email || '',
      displayName: user.displayName,
      roles: user.roles || ['user'],
      accountType: user.accountType || 'cardano',
      walletAddress: user.walletAddress,
    } as AuthUser,
  }
}
