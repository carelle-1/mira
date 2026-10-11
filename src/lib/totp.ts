import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function createTotpSecret() {
  const bytes = randomBytes(20);
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function decode(secret: string) {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const char of secret.toUpperCase()) { const index = alphabet.indexOf(char); if (index < 0) continue; value = (value << 5) | index; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(bytes);
}
export function totpCode(secret: string, step = Math.floor(Date.now() / 30000)) {
  const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(value).padStart(6, '0');
}
export function verifyTotp(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1,0,1].some(delta => timingSafeEqual(Buffer.from(totpCode(secret, Math.floor(Date.now()/30000)+delta)), Buffer.from(code)));
}
