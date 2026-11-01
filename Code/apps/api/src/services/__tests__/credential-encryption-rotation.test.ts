import { createCipheriv, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { reencryptCredential } from '../credential-encryption-rotation.js'

const OLD_KEY = '11'.repeat(32)
const NEW_KEY = '22'.repeat(32)

function encryptForTest(plaintext: string, keyHex: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`
}

describe('credential encryption key rotation', () => {
  it('re-encrypts old-key ciphertext and recognizes the new-key ciphertext on rerun', () => {
    const stored = encryptForTest('smtp app password', OLD_KEY)

    const firstPass = reencryptCredential(stored, OLD_KEY, NEW_KEY)
    expect(firstPass.alreadyEncryptedWithNewKey).toBe(false)

    const resumedPass = reencryptCredential(firstPass.encryptedValue, OLD_KEY, NEW_KEY)
    expect(firstPass.encryptedValue).not.toBe(stored)
    expect(resumedPass).toEqual({
      encryptedValue: firstPass.encryptedValue,
      alreadyEncryptedWithNewKey: true,
    })
  })

  it('rejects malformed keys, identical keys, and ciphertext that neither key can decrypt', () => {
    expect(() => reencryptCredential('invalid', 'bad', NEW_KEY)).toThrow(/64 hexadecimal/)
    expect(() => reencryptCredential('invalid', OLD_KEY, OLD_KEY)).toThrow(/must be different/)
    expect(() => reencryptCredential('invalid', OLD_KEY, NEW_KEY)).toThrow(/could not be decrypted/)
  })
})
