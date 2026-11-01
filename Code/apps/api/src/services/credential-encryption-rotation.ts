import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ENCRYPTION_KEY_PATTERN = /^[0-9a-fA-F]{64}$/
const IV_HEX_LENGTH = 24
const AUTH_TAG_HEX_LENGTH = 32

export interface RotatedCredential {
  encryptedValue: string
  alreadyEncryptedWithNewKey: boolean
}

function validateKey(key: string, label: string): Buffer {
  if (!ENCRYPTION_KEY_PATTERN.test(key)) {
    throw new Error(`${label} must be exactly 64 hexadecimal characters`)
  }
  return Buffer.from(key, 'hex')
}

function decrypt(encryptedValue: string, key: Buffer): string {
  const parts = encryptedValue.split(':')
  if (
    parts.length !== 3
    || parts[0].length !== IV_HEX_LENGTH
    || parts[1].length !== AUTH_TAG_HEX_LENGTH
    || !parts.every(part => /^[0-9a-f]*$/i.test(part))
    || parts[2].length % 2 !== 0
  ) {
    throw new Error('Invalid encrypted credential format')
  }

  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const ciphertext = Buffer.from(parts[2], 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`
}

function canDecrypt(encryptedValue: string, key: Buffer): boolean {
  try {
    decrypt(encryptedValue, key)
    return true
  } catch {
    return false
  }
}

export function reencryptCredential(
  encryptedValue: string,
  oldKeyValue: string,
  newKeyValue: string,
): RotatedCredential {
  const oldKey = validateKey(oldKeyValue, 'Old encryption key')
  const newKey = validateKey(newKeyValue, 'New encryption key')

  if (oldKey.equals(newKey)) {
    throw new Error('Old and new encryption keys must be different')
  }

  if (canDecrypt(encryptedValue, newKey)) {
    return { encryptedValue, alreadyEncryptedWithNewKey: true }
  }

  let plaintext: string
  try {
    plaintext = decrypt(encryptedValue, oldKey)
  } catch {
    throw new Error('Credential could not be decrypted with either supplied key')
  }

  const rotatedValue = encrypt(plaintext, newKey)
  if (decrypt(rotatedValue, newKey) !== plaintext) {
    throw new Error('Credential re-encryption verification failed')
  }

  return { encryptedValue: rotatedValue, alreadyEncryptedWithNewKey: false }
}
