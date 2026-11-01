/**
 * Managed wallet service -- non-custodial, app-generated Cardano identity.
 *
 * Uses the native Web Crypto API (Ed25519 + AES-GCM + PBKDF2) with no
 * external dependencies. Requires modern browsers (Chrome 113+, Firefox 118+,
 * Safari 17+) which all support Ed25519 in SubtleCrypto.
 *
 * Key design:
 *   - Ed25519 keypair generated with crypto.subtle.generateKey
 *   - Private key JWK is AES-256-GCM encrypted with a PBKDF2-derived key
 *   - The PBKDF2 input is a random device secret stored in localStorage
 *   - Encrypted blob (salt|iv|ciphertext) stored server-side -- opaque to us
 *   - Address = "managed_" + hex(raw public key bytes)  [39+64 = 71 chars]
 *   - Platform never holds the plaintext private key
 */

const DEVICE_KEY_STORAGE = 'cm_wallet_device_key'
const PBKDF2_ITERATIONS = 100_000

// ── Device key ────────────────────────────────────────────────────────

/**
 * Get the device-local 32-byte secret used to encrypt the wallet key.
 * Creates and persists one if it does not yet exist.
 * This secret stays on the device and is never sent to the server.
 */
export function getOrCreateDeviceKey(): Uint8Array {
  const stored = localStorage.getItem(DEVICE_KEY_STORAGE)
  if (stored) {
    try {
      const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0))
      if (bytes.length === 32) return bytes
    } catch {
      // Fall through to generate new
    }
  }
  const key = crypto.getRandomValues(new Uint8Array(32))
  localStorage.setItem(DEVICE_KEY_STORAGE, btoa(String.fromCharCode(...key)))
  return key
}

/** True if this device has a stored wallet secret (can decrypt the blob). */
export function hasDeviceKey(): boolean {
  try {
    const stored = localStorage.getItem(DEVICE_KEY_STORAGE)
    if (!stored) return false
    const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0))
    return bytes.length === 32
  } catch {
    return false
  }
}

// ── AES helpers ──────────────────────────────────────────────────────

async function deriveAesKey(
  deviceKey: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    deviceKey as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encode a blob to base64url (URL-safe, no padding). */
function toBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/** Decode a base64url string back to bytes. */
function fromBase64url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    str.length + ((4 - (str.length % 4)) % 4),
    '=',
  )
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

// ── Wallet generation ────────────────────────────────────────────────

export interface ManagedWalletResult {
  /** Managed wallet address: "managed_" + 64 hex chars of public key. */
  address: string
  /** Base64url-encoded encrypted private key blob (salt|iv|ciphertext). */
  encryptedBlob: string
  /** Raw 32-byte public key as lowercase hex (64 chars). */
  publicKeyHex: string
}

/**
 * Generate a new Ed25519 managed wallet.
 * Encrypts the private key with the current device key.
 */
export async function generateManagedWallet(): Promise<ManagedWalletResult> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )

  // Export public key as raw bytes (32 bytes for Ed25519)
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const publicKeyBytes = new Uint8Array(publicKeyRaw)
  const publicKeyHex = Array.from(publicKeyBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const address = `managed_${publicKeyHex}`

  // Export private key as JWK so we can encrypt and restore it later
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  const jwkBytes = new TextEncoder().encode(JSON.stringify(privateKeyJwk))

  // Encrypt with device key
  const deviceKey = getOrCreateDeviceKey()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await deriveAesKey(deviceKey, salt)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, jwkBytes),
  )

  // Pack: salt (16) | iv (12) | ciphertext
  const packed = new Uint8Array(16 + 12 + ciphertext.byteLength)
  packed.set(salt, 0)
  packed.set(iv, 16)
  packed.set(ciphertext, 28)

  return { address, encryptedBlob: toBase64url(packed), publicKeyHex }
}

// ── Private key operations ───────────────────────────────────────────

/**
 * Decrypt the private key from an encrypted blob using the device key.
 * Returns null if decryption fails (wrong device / corrupted blob).
 */
async function decryptPrivateKey(
  encryptedBlob: string,
  deviceKey: Uint8Array,
): Promise<CryptoKey | null> {
  try {
    const packed = fromBase64url(encryptedBlob)
    const salt = packed.slice(0, 16)
    const iv = packed.slice(16, 28)
    const ciphertext = packed.slice(28)

    const aesKey = await deriveAesKey(deviceKey, salt)
    const jwkBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext)
    const jwk = JSON.parse(new TextDecoder().decode(jwkBytes)) as JsonWebKey

    return crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, true, ['sign'])
  } catch {
    return null
  }
}

/**
 * Export the raw private key bytes as a hex string for backup display.
 * Returns null if this device cannot decrypt the blob.
 */
export async function exportPrivateKeyHex(
  encryptedBlob: string,
): Promise<string | null> {
  const deviceKey = getOrCreateDeviceKey()
  const privateKey = await decryptPrivateKey(encryptedBlob, deviceKey)
  if (!privateKey) return null

  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  // JWK 'd' field is the base64url-encoded 32-byte private key scalar
  if (!jwk.d) return null
  const bytes = fromBase64url(jwk.d)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Format a managed address for compact display: "managed_abcd1234...5678" */
export function formatManagedAddress(address: string): string {
  if (!address.startsWith('managed_')) return address
  const key = address.slice('managed_'.length)
  return `managed_${key.slice(0, 8)}...${key.slice(-8)}`
}

/** True if an address is a managed (app-generated) wallet address. */
export function isManagedAddress(address: string): boolean {
  return /^managed_[0-9a-f]{64}$/.test(address)
}
