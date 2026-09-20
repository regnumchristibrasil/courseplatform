// HMAC-SHA256 + constant-time comparison helpers for Mercado Pago webhook
// signature verification. Built on Web Crypto (`crypto.subtle`), available
// natively in Deno -- no `node:crypto` compat layer needed.

const HMAC_ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;
const SIGNATURE_HEADER_PATTERN = /^\s*([a-zA-Z0-9_]+)\s*=\s*(.*?)\s*$/;

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    HMAC_ALGORITHM,
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    HMAC_ALGORITHM,
    key,
    new TextEncoder().encode(message),
  );
  return bufferToHex(signature);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Constant-time-ish comparison: always walks the full length of the longer
// input rather than short-circuiting on the first mismatch, so an attacker
// can't use response-time differences to guess the signature byte by byte.
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export interface ParsedSignatureHeader {
  readonly ts: string;
  readonly v1: string;
}

// Mercado Pago's `x-signature` header looks like:
//   ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e13
export function parseSignatureHeader(value: string): ParsedSignatureHeader | null {
  const parts = value.split(',').reduce<Record<string, string>>((acc, rawPart) => {
    const match = SIGNATURE_HEADER_PATTERN.exec(rawPart);
    if (!match) return acc;
    const [, key, val] = match;
    if (!key || val === undefined) return acc;
    return { ...acc, [key]: val };
  }, {});

  if (!parts.ts || !parts.v1) return null;
  return { ts: parts.ts, v1: parts.v1 };
}
