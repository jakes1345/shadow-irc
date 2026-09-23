import crypto from 'crypto';

/**
 * SHADOW-IRC Native E2EE Engine
 * AES-256-GCM with PBKDF2 key derivation and random 12-byte IVs
 */

export class ShadowCrypto {
  static deriveKey(passphrase, salt = 'SHADOW_COSMOS_SALT_2026') {
    return crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  }

  static encrypt(text, passphrase) {
    try {
      const key = this.deriveKey(passphrase);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      const payload = {
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted
      };

      return '+OK ' + Buffer.from(JSON.stringify(payload)).toString('base64');
    } catch (err) {
      // Never fall back to plaintext: the caller believes E2EE is on, so
      // emitting the cleartext here would silently publish it.
      throw new Error('encryption failed: ' + err.message);
    }
  }

  static decrypt(cipherText, passphrase) {
    try {
      if (!cipherText.startsWith('+OK ')) return null;
      const rawPayload = cipherText.substring(4);
      const payload = JSON.parse(Buffer.from(rawPayload, 'base64').toString('utf8'));

      const key = this.deriveKey(passphrase);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

      let decrypted = decipher.update(payload.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (err) {
      return null; // Decryption failed or wrong key
    }
  }

  static isEncrypted(text) {
    return typeof text === 'string' && text.startsWith('+OK ');
  }
}
