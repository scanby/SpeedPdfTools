const MAGIC_BYTES = new TextEncoder().encode('SPDFV1');
const PBKDF2_ITERATIONS = 120000;

export interface VaultMetadata {
  originalName: string;
  mimeType: string;
  createdAt: string;
}

async function deriveAesKey(password: string, salt: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

/**
 * Encrypts any local Blob using AES-256-GCM entirely inside the user's device.
 * Binary format:
 * [6B "SPDFV1"][16B salt][12B iv][4B uint32BE metadataLen][metadata JSON][AES-GCM ciphertext]
 */
export async function encryptBlobLocal(
  sourceBlob: Blob,
  password: string,
  originalName: string
): Promise<Blob> {
  if (!password || password.length < 4) {
    throw new Error('La contraseña local debe tener al menos 4 caracteres.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, ['encrypt']);

  const metadata: VaultMetadata = {
    originalName,
    mimeType: sourceBlob.type || 'application/octet-stream',
    createdAt: new Date().toISOString(),
  };
  const metaBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const metaLenBuf = new ArrayBuffer(4);
  new DataView(metaLenBuf).setUint32(0, metaBytes.length, false);

  const plainBuffer = await sourceBlob.arrayBuffer();
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: metaBytes,
    },
    key,
    plainBuffer
  );

  return new Blob(
    [MAGIC_BYTES, salt, iv, new Uint8Array(metaLenBuf), metaBytes, new Uint8Array(cipherBuffer)],
    { type: 'application/octet-stream' }
  );
}

export async function decryptVaultLocal(
  vaultFile: File,
  password: string
): Promise<{ blob: Blob; metadata: VaultMetadata }> {
  const raw = new Uint8Array(await vaultFile.arrayBuffer());
  const headerMin = 6 + 16 + 12 + 4;
  if (raw.byteLength < headerMin) {
    throw new Error('El archivo cifrado no tiene una estructura SPEED.PDF válida.');
  }

  const magic = new TextDecoder().decode(raw.slice(0, 6));
  if (magic !== 'SPDFV1') {
    throw new Error('Formato de bóveda incompatible (cabecera SPDFV1 ausente).');
  }

  const salt = raw.slice(6, 22);
  const iv = raw.slice(22, 34);
  const metaLen = new DataView(raw.buffer, raw.byteOffset + 34, 4).getUint32(0, false);

  const metaStart = 38;
  const metaEnd = metaStart + metaLen;
  if (metaEnd > raw.byteLength) {
    throw new Error('Cabecera de metadatos dañada.');
  }

  const metaBytes = raw.slice(metaStart, metaEnd);
  const metadata = JSON.parse(new TextDecoder().decode(metaBytes)) as VaultMetadata;
  const ciphertext = raw.slice(metaEnd);

  const key = await deriveAesKey(password, salt, ['decrypt']);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: metaBytes,
      },
      key,
      ciphertext
    );

    return {
      blob: new Blob([plainBuffer], { type: metadata.mimeType }),
      metadata,
    };
  } catch {
    throw new Error('Contraseña incorrecta o archivo modificado.');
  }
}
