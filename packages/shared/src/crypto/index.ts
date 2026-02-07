/**
 * End-to-end encryption using X25519 key exchange + AES-256-GCM
 *
 * Uses @noble/curves for the cryptographic primitives.
 * This module handles encrypting messages at rest in the local SQLite database.
 */

import { x25519 } from "@noble/curves/ed25519";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

export interface EncryptionKeys {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface EncryptedPayload {
  ciphertext: string; // base64
  nonce: string; // base64
  tag: string; // base64
}

/**
 * Generate a new X25519 keypair for key exchange
 */
export function generateKeyPair(): EncryptionKeys {
  const privateKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

/**
 * Derive a shared secret from our private key and their public key
 */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}

/**
 * Encrypt plaintext using AES-256-GCM with the provided key
 */
export function encrypt(plaintext: string, key: Uint8Array): EncryptedPayload {
  const nonce = randomBytes(12); // 96-bit nonce for GCM
  const cipher = createCipheriv("aes-256-gcm", key.slice(0, 32), nonce);

  let ciphertext = cipher.update(plaintext, "utf8", "base64");
  ciphertext += cipher.final("base64");
  const tag = cipher.getAuthTag();

  return {
    ciphertext,
    nonce: Buffer.from(nonce).toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Decrypt an encrypted payload using AES-256-GCM
 */
export function decrypt(payload: EncryptedPayload, key: Uint8Array): string {
  const nonce = Buffer.from(payload.nonce, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key.slice(0, 32), nonce);
  decipher.setAuthTag(tag);

  let plaintext = decipher.update(payload.ciphertext, "base64", "utf8");
  plaintext += decipher.final("utf8");
  return plaintext;
}

/**
 * Generate a random encryption key (for local-only encryption)
 * Used when there's no key exchange needed (single user, local storage)
 */
export function generateLocalKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Serialize a key to base64 for storage
 */
export function keyToBase64(key: Uint8Array): string {
  return Buffer.from(key).toString("base64");
}

/**
 * Deserialize a key from base64
 */
export function base64ToKey(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}
