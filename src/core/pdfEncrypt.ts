import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFWriter,
} from 'pdf-lib';

export interface PdfEncryptionOptions {
  openPassword?: string;
  ownerPassword?: string;
  allowPrinting?: boolean;
  allowCopying?: boolean;
  allowModifying?: boolean;
}

// ISO 32000-1 §7.6.3.3 padding string (32 bytes)
const PDF_PASSWORD_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

function md5(input: Uint8Array): Uint8Array {
  const bitLen = input.length * 8;
  const paddedLen = (((input.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(input);
  padded[input.length] = 0x80;

  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLen >>> 0, true);
  dv.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = dv.getUint32(offset + j * 4, true);
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      const sum = (A + F + MD5_K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const shift = MD5_S[i];
      const rot = ((sum << shift) | (sum >>> (32 - shift))) >>> 0;
      B = (B + rot) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, a0, true);
  outDv.setUint32(4, b0, true);
  outDv.setUint32(8, c0, true);
  outDv.setUint32(12, d0, true);
  return out;
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
  }

  const out = new Uint8Array(data.length);
  let x = 0;
  let y = 0;
  for (let idx = 0; idx < data.length; idx++) {
    x = (x + 1) & 0xff;
    y = (y + s[x]) & 0xff;
    const tmp = s[x];
    s[x] = s[y];
    s[y] = tmp;
    out[idx] = data[idx] ^ s[(s[x] + s[y]) & 0xff];
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0').toUpperCase();
  }
  return hex;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function padPassword(password: string): Uint8Array {
  const out = new Uint8Array(32);
  let written = 0;
  for (let i = 0; i < password.length && written < 32; i++) {
    out[written++] = password.charCodeAt(i) & 0xff;
  }
  if (written < 32) {
    out.set(PDF_PASSWORD_PADDING.subarray(0, 32 - written), written);
  }
  return out;
}

function computePermissionsFlag(opts: PdfEncryptionOptions): number {
  // Base R=3 reserved bits: bits 7-8 = 1 (0xC0), bits 13-32 = 1 (0xFFFFF000) -> 0xFFFFF0C0
  let flags = 0xfffff0c0 | 0;
  if (opts.allowPrinting !== false) {
    // Bit 3 (print) + bit 12 (high quality print)
    flags |= 0x0004 | 0x0800;
  }
  if (opts.allowCopying) {
    // Bit 5 (copy) + bit 10 (accessibility extract)
    flags |= 0x0010 | 0x0200;
  }
  if (opts.allowModifying) {
    // Bit 4 (modify) + bit 6 (annotations) + bit 9 (fill forms) + bit 11 (assemble)
    flags |= 0x0008 | 0x0020 | 0x0100 | 0x0400;
  }
  return flags | 0;
}

function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

function computeOwnerValue(ownerPw: string, userPw: string): Uint8Array {
  const paddedOwner = padPassword(ownerPw || userPw);
  let hash = md5(paddedOwner);
  for (let i = 0; i < 50; i++) {
    hash = md5(hash);
  }
  const key = hash.subarray(0, 16);
  let enc = rc4(key, padPassword(userPw));
  const iterKey = new Uint8Array(16);
  for (let i = 1; i <= 19; i++) {
    for (let k = 0; k < 16; k++) iterKey[k] = key[k] ^ i;
    enc = rc4(iterKey, enc);
  }
  return enc;
}

function computeFileEncryptionKey(
  userPw: string,
  ownerBytes: Uint8Array,
  permissionsInt: number,
  docId: Uint8Array
): Uint8Array {
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, permissionsInt, true);

  let hash = md5(concatBytes(padPassword(userPw), ownerBytes, pBytes, docId));
  for (let i = 0; i < 50; i++) {
    hash = md5(hash.subarray(0, 16));
  }
  return hash.subarray(0, 16);
}

function computeUserValue(fileKey: Uint8Array, docId: Uint8Array): Uint8Array {
  const digest = md5(concatBytes(PDF_PASSWORD_PADDING, docId));
  let enc = rc4(fileKey, digest);
  const iterKey = new Uint8Array(16);
  for (let i = 1; i <= 19; i++) {
    for (let k = 0; k < 16; k++) iterKey[k] = fileKey[k] ^ i;
    enc = rc4(iterKey, enc);
  }
  const suffix = generateRandomBytes(16);
  return concatBytes(enc, suffix);
}

function deriveObjectKey(fileKey: Uint8Array, ref: PDFRef): Uint8Array {
  const input = new Uint8Array(fileKey.length + 5);
  input.set(fileKey, 0);
  const n = ref.objectNumber;
  const g = ref.generationNumber;
  input[fileKey.length] = n & 0xff;
  input[fileKey.length + 1] = (n >> 8) & 0xff;
  input[fileKey.length + 2] = (n >> 16) & 0xff;
  input[fileKey.length + 3] = g & 0xff;
  input[fileKey.length + 4] = (g >> 8) & 0xff;
  return md5(input).subarray(0, 16);
}

function encryptPdfObject(obj: PDFObject, objKey: Uint8Array): PDFObject {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    const encryptedBytes = rc4(objKey, obj.asBytes());
    return PDFHexString.of(bytesToHex(encryptedBytes));
  }
  if (obj instanceof PDFArray) {
    const len = obj.size();
    for (let i = 0; i < len; i++) {
      const child = obj.get(i);
      const updated = encryptPdfObject(child, objKey);
      if (updated !== child) {
        obj.set(i, updated);
      }
    }
    return obj;
  }
  if (obj instanceof PDFDict) {
    for (const [key, val] of obj.entries()) {
      const updated = encryptPdfObject(val, objKey);
      if (updated !== val) {
        obj.set(key, updated);
      }
    }
    return obj;
  }
  return obj;
}

/**
 * Cifra un PDFDocument existente con el estándar PDF RC4-128 (V=2, R=3),
 * preservando intacto el contenido vectorial, fuentes, formularios y marcadores.
 */
export async function encryptPdfDocument(
  sourceDoc: PDFDocument,
  options: PdfEncryptionOptions
): Promise<Uint8Array> {
  const openPassword = options.openPassword ?? '';
  const fallbackOwner = bytesToHex(generateRandomBytes(12));
  const ownerPassword =
    options.ownerPassword && options.ownerPassword.trim().length > 0
      ? options.ownerPassword
      : openPassword || fallbackOwner;

  // Serializamos sin ObjStm ni XRef streams para que cada objeto sea un PDFRawStream o valor estándar
  const plainBytes = await sourceDoc.save({
    useObjectStreams: false,
    updateFieldAppearances: false,
  });

  const workDoc = await PDFDocument.load(plainBytes, { updateMetadata: false });
  const docId = generateRandomBytes(16);
  const docIdHex = bytesToHex(docId);

  const permissionsInt = computePermissionsFlag(options);
  const oBytes = computeOwnerValue(ownerPassword, openPassword);
  const fileKey = computeFileEncryptionKey(openPassword, oBytes, permissionsInt, docId);
  const uBytes = computeUserValue(fileKey, docId);

  const encryptDict = workDoc.context.obj({
    Filter: 'Standard',
    V: 2,
    R: 3,
    Length: 128,
    P: permissionsInt,
    O: PDFHexString.of(bytesToHex(oBytes)),
    U: PDFHexString.of(bytesToHex(uBytes)),
  });
  const encryptRef = workDoc.context.register(encryptDict);

  workDoc.context.trailerInfo.Encrypt = encryptRef;
  workDoc.context.trailerInfo.ID = workDoc.context.obj([
    PDFHexString.of(docIdHex),
    PDFHexString.of(docIdHex),
  ]);

  const indirectObjects = workDoc.context.enumerateIndirectObjects();
  for (const [ref, object] of indirectObjects) {
    if (ref === encryptRef) continue;
    const objKey = deriveObjectKey(fileKey, ref);

    if (object instanceof PDFRawStream) {
      const typeName = object.dict.get(PDFName.of('Type'));
      if (typeName === PDFName.of('XRef')) continue;

      encryptPdfObject(object.dict, objKey);
      const encryptedStream = PDFRawStream.of(object.dict, rc4(objKey, object.contents));
      workDoc.context.assign(ref, encryptedStream);
      continue;
    }

    const updated = encryptPdfObject(object, objKey);
    if (updated !== object) {
      workDoc.context.assign(ref, updated);
    }
  }

  return PDFWriter.forContext(workDoc.context, 60).serializeToBuffer();
}
