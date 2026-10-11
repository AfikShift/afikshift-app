// Encrypted on-device storage for shift records (XChaCha20-Poly1305).
// The 256-bit key lives in the Keychain / Android Keystore via secure storage;
// the encrypted blob lives in app-private storage and survives restarts.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils.js";
import * as Crypto from "expo-crypto";

import { storage } from "@/src/utils/storage";

const KEY_NAME = "dc_local_key_v1";
export const shiftsKey = (userId: string) => `dc_shifts_v1_${userId}`;

let cachedKey: Uint8Array | null = null;

async function getKey(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;
  const hex = await storage.secureGet(KEY_NAME, null as string | null);
  if (hex) {
    cachedKey = hexToBytes(hex);
    return cachedKey;
  }
  const k = Crypto.getRandomBytes(32);
  await storage.secureSet(KEY_NAME, bytesToHex(k));
  cachedKey = k;
  return k;
}

export async function saveEncrypted(name: string, value: unknown): Promise<boolean> {
  const key = await getKey();
  const nonce = Crypto.getRandomBytes(24);
  const ct = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(JSON.stringify(value)));
  return storage.setItem(name, `${bytesToHex(nonce)}:${bytesToHex(ct)}`);
}

export async function loadEncrypted<T>(name: string): Promise<T | null> {
  const raw = await storage.getItem(name, null as string | null);
  if (!raw) return null;
  try {
    const [n, c] = raw.split(":");
    const key = await getKey();
    const pt = xchacha20poly1305(key, hexToBytes(n)).decrypt(hexToBytes(c));
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null;
  }
}

export async function removeEncrypted(name: string) {
  await storage.removeItem(name);
}
