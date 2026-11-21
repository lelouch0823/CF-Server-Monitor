/**
 * 公共工具函数模块
 * 统一存放各处重复定义的函数
 */

/**
 * 验证 Turnstile token
 * @param {string} token - Turnstile token
 * @param {string} secretKey - Turnstile secret key
 * @returns {Promise<boolean>} 验证结果
 */
const TURNSTILE_VERIFY_TIMEOUT_MS = 5000;

export async function verifyTurnstileToken(token, secretKey) {
  if (!token || !secretKey) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_VERIFY_TIMEOUT_MS);
  
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret: secretKey,
        response: token
      }),
      signal: controller.signal
    });
    
    const data = await response.json();
    return data.success === true;
  } catch (e) {
    console.error('Turnstile verification error:', e);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 管理后台密码哈希参数
 */
export const PASSWORD_HASH_ALGORITHM = 'pbkdf2_sha256';
export const PASSWORD_HASH_ITERATIONS = 50000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  if (!hex || hex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

const TIMING_SAFE_BLOCK_BYTES = 64;
const SHARED_TEXT_ENCODER = new TextEncoder();

function padBytesToBlock(bytes, targetLength) {
  const padded = new Uint8Array(targetLength);
  padded.set(bytes, 0);
  return padded;
}

function timingSafeEqualBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) {
    return false;
  }

  const maxLength = Math.max(left.length, right.length, TIMING_SAFE_BLOCK_BYTES);
  const blockLength = Math.ceil(maxLength / TIMING_SAFE_BLOCK_BYTES) * TIMING_SAFE_BLOCK_BYTES;
  const paddedLeft = padBytesToBlock(left, blockLength);
  const paddedRight = padBytesToBlock(right, blockLength);

  let diff = left.length ^ right.length;
  if (crypto.subtle && typeof crypto.subtle.timingSafeEqual === 'function') {
    const samePadded = crypto.subtle.timingSafeEqual(paddedLeft, paddedRight);
    diff |= samePadded ? 0 : 1;
  } else {
    for (let i = 0; i < blockLength; i++) {
      diff |= paddedLeft[i] ^ paddedRight[i];
    }
  }
  return diff === 0;
}

/**
 * 恒定时间字符串比较，用于共享密钥/用户名等敏感凭据比较，
 * 避免原生字符串比较的首字节提前返回或长度不等分支造成时序侧信道
 */
export function timingSafeEqualString(left, right) {
  const validTypes = typeof left === 'string' && typeof right === 'string';
  const leftBytes = SHARED_TEXT_ENCODER.encode(typeof left === 'string' ? left : '');
  const rightBytes = SHARED_TEXT_ENCODER.encode(typeof right === 'string' ? right : '');
  const equal = timingSafeEqualBytes(leftBytes, rightBytes);
  return validTypes && equal;
}

async function derivePbkdf2Hash(password, salt, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations
    },
    keyMaterial,
    PASSWORD_HASH_BYTES * 8
  );

  return new Uint8Array(bits);
}

function parsePbkdf2Hash(storedHash) {
  if (typeof storedHash !== 'string') {
    return null;
  }

  const parts = storedHash.trim().split('$');
  if (parts.length !== 4 || parts[0] !== PASSWORD_HASH_ALGORITHM) {
    return null;
  }

  const iterations = Number(parts[1]);
  const salt = hexToBytes(parts[2]);
  const hash = hexToBytes(parts[3]);

  if (
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    !salt ||
    salt.length !== PASSWORD_SALT_BYTES ||
    !hash ||
    hash.length !== PASSWORD_HASH_BYTES
  ) {
    return null;
  }

  return { iterations, salt, hash };
}

export function isLegacyMd5Hash(storedHash) {
  return typeof storedHash === 'string' && /^[a-f0-9]{32}$/i.test(storedHash.trim());
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePbkdf2Hash(password, salt, PASSWORD_HASH_ITERATIONS);
  return `${PASSWORD_HASH_ALGORITHM}$${PASSWORD_HASH_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export async function verifyPasswordHash(password, storedHash) {
  const parsed = parsePbkdf2Hash(storedHash);
  if (parsed) {
    const hash = await derivePbkdf2Hash(password, parsed.salt, parsed.iterations);
    return {
      valid: timingSafeEqualBytes(hash, parsed.hash),
      needsRehash: false,
      algorithm: PASSWORD_HASH_ALGORITHM
    };
  }

  if (isLegacyMd5Hash(storedHash)) {
    const hashedPassword = await md5Hash(password);
    const actual = hexToBytes(hashedPassword);
    const expected = hexToBytes(storedHash.trim().toLowerCase());
    const valid = timingSafeEqualBytes(actual, expected);
    return {
      valid,
      needsRehash: valid,
      algorithm: 'md5'
    };
  }

  return {
    valid: false,
    needsRehash: false,
    algorithm: 'unknown'
  };
}

/**
 * 计算 MD5 哈希值，仅用于兼容旧版密码
 * @param {string} input - 输入字符串
 * @returns {Promise<string>} MD5 哈希值
 */
const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];
const MD5_CONSTANTS = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
);

export async function md5Hash(input) {
  const bytes = Array.from(new TextEncoder().encode(input));
  const originalBitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);

  const lowBits = originalBitLength >>> 0;
  const highBits = Math.floor(originalBitLength / 0x100000000) >>> 0;
  for (let i = 0; i < 4; i++) bytes.push((lowBits >>> (i * 8)) & 0xff);
  for (let i = 0; i < 4; i++) bytes.push((highBits >>> (i * 8)) & 0xff);

  const rotateLeft = (value, amount) => ((value << amount) | (value >>> (32 - amount))) >>> 0;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array(16);
    for (let i = 0; i < 16; i++) {
      const base = offset + i * 4;
      words[i] = (
        bytes[base] |
        (bytes[base + 1] << 8) |
        (bytes[base + 2] << 16) |
        (bytes[base + 3] << 24)
      ) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const previousD = d;
      d = c;
      c = b;
      const sum = (a + (f >>> 0) + MD5_CONSTANTS[i] + words[g]) >>> 0;
      b = (b + rotateLeft(sum, MD5_SHIFTS[i])) >>> 0;
      a = previousD;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(word => {
    let hex = '';
    for (let i = 0; i < 4; i++) hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    return hex;
  }).join('');
}
