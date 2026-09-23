import crypto from 'crypto';

/**
 * SHADOW-IRC Native E2EE Engine
 * AES-256-GCM with PBKDF2 key derivation and random 12-byte IVs.
 *
 * Wire format (base64 JSON after a '+OK ' prefix):
 *   v2: { s, iv, tag, data }  — s is a random 16-byte salt, 600k iterations
 *   v1: {    iv, tag, data }  — legacy fixed salt, 100k iterations (read-only)
 *
 * v1 used one salt for the entire network, so a single precomputed table
 * worked against every user and every message forever. v2 gives each
 * passphrase a random salt and ships it alongside the ciphertext. Decryption
 * still accepts v1 so messages sent by clients that predate this stay readable.
 *
 * Any change here must be mirrored in the browser implementation in
 * src-desktop/index.html or the two clients cannot read each other.
 */

const LEGACY_SALT = 'SHADOW_COSMOS_SALT_2026';
const LEGACY_ITERATIONS = 100000;
const ITERATIONS = 600000;
const SALT_BYTES = 16;

export class ShadowCrypto {
  // Derivation is ~300ms, so cache per (passphrase, salt, iterations).
  static _keyCache = new Map();
  // One salt per passphrase per process, so senders derive once rather than
  // once per message while still not sharing a salt with the rest of the network.
  static _sessionSalts = new Map();

  static deriveKey(passphrase, salt = LEGACY_SALT, iterations = LEGACY_ITERATIONS) {
    const saltHex = Buffer.isBuffer(salt) ? salt.toString('hex') : salt;
    const cacheKey = `${passphrase}|${saltHex}|${iterations}`;

    let key = this._keyCache.get(cacheKey);
    if (!key) {
      key = crypto.pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256');
      this._keyCache.set(cacheKey, key);
    }
    return key;
  }

  static sessionSalt(passphrase) {
    let saltHex = this._sessionSalts.get(passphrase);
    if (!saltHex) {
      saltHex = crypto.randomBytes(SALT_BYTES).toString('hex');
      this._sessionSalts.set(passphrase, saltHex);
    }
    return saltHex;
  }

  static encrypt(text, passphrase) {
    try {
      const saltHex = this.sessionSalt(passphrase);
      const key = this.deriveKey(passphrase, Buffer.from(saltHex, 'hex'), ITERATIONS);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const payload = {
        s: saltHex,
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
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
      const payload = JSON.parse(Buffer.from(cipherText.substring(4), 'base64').toString('utf8'));

      const key = payload.s
        ? this.deriveKey(passphrase, Buffer.from(payload.s, 'hex'), ITERATIONS)
        : this.deriveKey(passphrase, LEGACY_SALT, LEGACY_ITERATIONS);

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
