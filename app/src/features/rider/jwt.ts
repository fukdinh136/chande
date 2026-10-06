// Đọc claim của access token chỉ để hiển thị/so khớp phía app (sub, exp); chữ ký do gateway và service kiểm.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlDecode(input: string): string {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/, '')) {
    const index = ALPHABET.indexOf(char === '+' ? '-' : char === '/' ? '_' : char);
    if (index < 0) throw new Error('INVALID_JWT');
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  // Giải UTF-8 thủ công: Hermes không bảo đảm có TextDecoder.
  let output = '';
  for (let i = 0; i < bytes.length;) {
    const byte = bytes[i++];
    if (byte < 0x80) output += String.fromCharCode(byte);
    else if (byte < 0xe0) output += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (byte < 0xf0) output += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const code = (((byte & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)) - 0x10000;
      output += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    }
  }
  return output;
}

export interface JwtClaims { sub: string | null; exp: number | null; role: string | null }

export function readClaims(token: string): JwtClaims {
  try {
    const payload = JSON.parse(base64UrlDecode(token.split('.')[1] ?? '')) as Record<string, unknown>;
    return {
      sub: typeof payload.sub === 'string' ? payload.sub.toLowerCase() : null,
      exp: typeof payload.exp === 'number' ? payload.exp : null,
      role: typeof payload.role === 'string' ? payload.role : null,
    };
  } catch {
    return { sub: null, exp: null, role: null };
  }
}
