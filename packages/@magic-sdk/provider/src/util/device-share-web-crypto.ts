import { getItem, iterate, removeItem } from './storage';
import { isWebCryptoSupported } from './web-crypto';

export const DEVICE_SHARE_KEY = 'ds';
export const ENCRYPTION_KEY_KEY = 'ek';
export const INITIALIZATION_VECTOR_KEY = 'iv';

const ALGO_NAME = 'AES-GCM'; // for encryption
const ALGO_LENGTH = 256;

export async function clearDeviceShares() {
  const keysToRemove: string[] = [];
  // Use await with iterate
  await iterate((value, key, iterationNumber) => {
    if (key.startsWith(`${DEVICE_SHARE_KEY}_`)) {
      keysToRemove.push(key);
    }
  });
  for (const key of keysToRemove) {
    // eslint-disable-next-line no-await-in-loop
    await removeItem(key);
  }
}

export function strToArrayBuffer(str: string) {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function bufferToString(buffer: ArrayBuffer) {
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(buffer);
}

async function getOrCreateInitializationVector() {
  if (!isWebCryptoSupported()) {
    console.info('webcrypto is not supported');
    return undefined;
  }
  const { crypto } = window;
  if (!crypto) return undefined;

  const existingIvString = (await getItem(INITIALIZATION_VECTOR_KEY)) as string;
  if (existingIvString) {
    return new Uint8Array(JSON.parse(existingIvString));
  }

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 12 bytes for AES-GCM
  return iv;
}

async function getOrCreateEncryptionKey() {
  if (!isWebCryptoSupported()) {
    console.info('webcrypto is not supported');
    return undefined;
  }
  const { subtle } = window.crypto;
  if (!subtle) return undefined;

  const existingKey = (await getItem(ENCRYPTION_KEY_KEY)) as CryptoKey;
  if (existingKey) {
    return existingKey;
  }

  const key = subtle.generateKey(
    { name: ALGO_NAME, length: ALGO_LENGTH },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );
  return key;
}

export async function encryptDeviceShare(
  plaintextDeviceShare: string,
): Promise<{ encryptionKey?: CryptoKey; encryptedDeviceShare?: String; iv?: string }> {
  const iv = await getOrCreateInitializationVector();
  const encryptionKey = await getOrCreateEncryptionKey();

  if (!iv || !encryptionKey || !plaintextDeviceShare) {
    return { iv: undefined, encryptionKey: undefined, encryptedDeviceShare: undefined };
  }

  const { subtle } = window.crypto;

  const encryptedData = await subtle.encrypt(
    {
      name: ALGO_NAME,
      iv,
    },
    encryptionKey,
    strToArrayBuffer(plaintextDeviceShare),
  );

  const encryptedDeviceShare = arrayBufferToBase64(encryptedData);

  return { encryptionKey, encryptedDeviceShare, iv: JSON.stringify(Array.from(iv)) };
}

export async function getAndDecryptDeviceShare(networkHash: string): Promise<string | undefined> {
  const encryptedDeviceShare = await getItem<string>(`${DEVICE_SHARE_KEY}_${networkHash}`);
  const ivString = (await getItem(INITIALIZATION_VECTOR_KEY)) as string; // use existing encryption key and initialization vector
  const encryptionKey = (await getItem(ENCRYPTION_KEY_KEY)) as CryptoKey;
  const iv = new Uint8Array(JSON.parse(ivString));

  if (!iv || !encryptedDeviceShare || !encryptionKey || !isWebCryptoSupported()) return undefined;

  const { subtle } = window.crypto;
  const ab = await subtle.decrypt({ name: ALGO_NAME, iv }, encryptionKey, base64ToArrayBuffer(encryptedDeviceShare));

  return bufferToString(ab);
}
