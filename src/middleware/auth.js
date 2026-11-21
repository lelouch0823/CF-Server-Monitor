const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' };
import { verifyPasswordHash, timingSafeEqualString } from '../utils/common.js';
import { parseAllowedOrigins } from '../utils/cors.js';
import { isValidJwtSecret } from '../utils/settings.js';

export const AUTH_COOKIE_NAME = 'cfsm_auth';
const TOKEN_QUERY_KEYS = ['token', 'auth_token', 'ws_token'];
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SHARED_ENCODER = new TextEncoder();
const SHARED_DECODER = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeJsonBase64Url(value) {
  return bytesToBase64Url(SHARED_ENCODER.encode(JSON.stringify(value)));
}

function decodeBase64OrUrlToBytes(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    return null;
  }
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    return null;
  }
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function generateKeyFromSecret(secret) {
  const keyData = SHARED_ENCODER.encode(secret);
  return await crypto.subtle.importKey('raw', keyData, ALGORITHM, false, ['sign', 'verify']);
}

async function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = encodeJsonBase64Url(header);
  const encodedPayload = encodeJsonBase64Url(payload);

  const data = `${encodedHeader}.${encodedPayload}`;
  const key = await generateKeyFromSecret(secret);

  const dataBytes = SHARED_ENCODER.encode(data);
  const signature = await crypto.subtle.sign(ALGORITHM, key, dataBytes);
  const encodedSignature = bytesToBase64Url(new Uint8Array(signature));

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function verifyJwt(token, secret) {
  try {
    if (typeof token !== 'string') {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const headerBytes = decodeBase64OrUrlToBytes(encodedHeader);
    const payloadBytes = decodeBase64OrUrlToBytes(encodedPayload);
    const signatureBytes = decodeBase64OrUrlToBytes(encodedSignature);
    if (!headerBytes || !payloadBytes || !signatureBytes) {
      return null;
    }

    const header = JSON.parse(SHARED_DECODER.decode(headerBytes));
    if (!header || header.alg !== 'HS256') {
      return null;
    }

    const key = await generateKeyFromSecret(secret);
    const data = `${encodedHeader}.${encodedPayload}`;
    const dataBytes = SHARED_ENCODER.encode(data);

    const isValid = await crypto.subtle.verify(ALGORITHM, key, signatureBytes, dataBytes);
    if (!isValid) {
      return null;
    }

    const payload = JSON.parse(SHARED_DECODER.decode(payloadBytes));
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      Date.now() > payload.exp * 1000
    ) {
      return null;
    }

    return payload;
  } catch (e) {
    console.error('JWT verification error:', e);
    return null;
  }
}

function getJwtSecret(env, sys) {
  if (sys?._degradedColdFailure === true) {
    throw new Error('Site settings degraded cold failure: refusing JWT secret fallback');
  }

  if (isValidJwtSecret(sys?.jwt_secret)) {
    return sys.jwt_secret;
  }

  // 仅回退到部署侧提供的 API_SECRET，绝不使用源码中公开的硬编码常量：
  // 两者都缺失时失败关闭（调用方 catch 后拒绝），避免可预测的签名密钥
  const fallback = typeof env?.API_SECRET === 'string' ? env.API_SECRET : '';
  if (!fallback) {
    throw new Error('JWT secret is not configured');
  }
  return fallback.padEnd(32, 'x').substring(0, 64);
}

function getCookieValue(request, name) {
  const cookie = request?.headers?.get('Cookie') || '';
  const prefix = `${name}=`;
  for (const part of cookie.split(';')) {
    const item = part.trim();
    if (!item.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(item.slice(prefix.length));
    } catch (_) {
      return item.slice(prefix.length);
    }
  }
  return '';
}

function extractBearerToken(request) {
  const authHeader = request?.headers?.get('Authorization') || '';
  const parts = authHeader.trim().split(/\s+/);
  return parts[0] === 'Bearer' && parts[1] ? parts[1] : '';
}

function getExpectedRequestOrigins(request) {
  const origins = new Set();
  let reqUrl = null;
  if (typeof request?.url === 'string' && request.url.length > 0) {
    try {
      reqUrl = new URL(request.url);
      if (reqUrl.origin && reqUrl.origin !== 'null') {
        origins.add(reqUrl.origin);
      }
    } catch (_) {}
  }

  const realOrigin = (request?.headers?.get('X-Real-Origin') || '').trim();
  if (realOrigin) {
    try {
      const parsedReal = new URL(realOrigin);
      if (parsedReal.origin && parsedReal.origin !== 'null') {
        origins.add(parsedReal.origin);
      }
    } catch (_) {}
  }

  const forwardedHostRaw = (request?.headers?.get('X-Forwarded-Host') || '').split(',')[0].trim();
  if (forwardedHostRaw && !/[\s/\\@]/.test(forwardedHostRaw)) {
    const forwardedProtoRaw = (request?.headers?.get('X-Forwarded-Proto') || '').split(',')[0].trim().toLowerCase();
    const protocol = (forwardedProtoRaw === 'http' || forwardedProtoRaw === 'https')
      ? `${forwardedProtoRaw}:`
      : (reqUrl?.protocol || 'https:');
    try {
      const forwardedUrl = new URL(`${protocol}//${forwardedHostRaw}`);
      if (forwardedUrl.origin && forwardedUrl.origin !== 'null') {
        origins.add(forwardedUrl.origin);
      }
    } catch (_) {}
  }

  return origins;
}

function isCookieRequestCsrfSafe(request, env) {
  const method = typeof request?.method === 'string' ? request.method.toUpperCase() : 'GET';
  if (CSRF_SAFE_METHODS.has(method)) {
    return true;
  }

  const secFetchSite = (request?.headers?.get('Sec-Fetch-Site') || '').trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const originHeader = request?.headers?.get('Origin');
  if (originHeader !== null && originHeader !== undefined && String(originHeader).trim() !== '') {
    const origin = String(originHeader).trim();
    const expectedOrigins = getExpectedRequestOrigins(request);
    if (expectedOrigins.has(origin)) {
      return true;
    }
    const allowedOrigins = parseAllowedOrigins(env?.CORS_ALLOWED_ORIGINS);
    return allowedOrigins.includes(origin);
  }

  return true;
}

async function verifyToken(token, env, sys) {
  if (!token) return false;

  let secret;
  try {
    secret = getJwtSecret(env, sys);
  } catch (e) {
    console.error('Auth check error:', e);
    return false;
  }

  try {
    const payload = await verifyJwt(token, secret);
    return payload !== null;
  } catch (e) {
    console.error('Auth check error:', e);
    return false;
  }
}

export async function generateToken(env, sys) {
  const payload = {
    sub: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 604800
  };

  const secret = getJwtSecret(env, sys);
  return signJwt(payload, secret);
}

export async function getVerifiedAuthToken(request, env, sys) {
  const bearerToken = extractBearerToken(request);
  if (bearerToken && await verifyToken(bearerToken, env, sys)) {
    return bearerToken;
  }

  const cookieToken = getCookieValue(request, AUTH_COOKIE_NAME);
  if (!cookieToken || !isCookieRequestCsrfSafe(request, env)) {
    return '';
  }
  if (await verifyToken(cookieToken, env, sys)) {
    return cookieToken;
  }
  return '';
}

export async function checkAuth(request, env, sys) {
  const verifiedToken = await getVerifiedAuthToken(request, env, sys);
  return verifiedToken.length > 0;
}

export async function checkWebSocketAuth(request, env, sys) {
  if (await checkAuth(request, env, sys)) {
    return true;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return false;
  }

  for (const key of TOKEN_QUERY_KEYS) {
    if (await verifyToken(url.searchParams.get(key), env, sys)) {
      return true;
    }
  }
  return false;
}

export function buildAuthCookie(request, token, maxAge = 604800) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token || '')}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function buildClearAuthCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${AUTH_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export async function validateCredentials(username, password, env, sys) {
  try {
    if (sys?._degradedColdFailure === true) {
      return { valid: false, needsPasswordUpgrade: false };
    }

    const inputUsername = typeof username === 'string' ? username : '';
    const inputPassword = typeof password === 'string' ? password : '';

    const validUsername = (sys && sys.username && sys.username.length > 0)
      ? sys.username
      : (typeof env?.API_USER_NAME === 'string' && env.API_USER_NAME.length > 0)
        ? env.API_USER_NAME
        : 'admin';

    const usernameMatched = timingSafeEqualString(inputUsername, validUsername);

    if (sys && sys.password && sys.password.length > 0) {
      const result = await verifyPasswordHash(inputPassword, sys.password);
      if (!usernameMatched || !result.valid) {
        return { valid: false, needsPasswordUpgrade: false };
      }
      return {
        valid: true,
        needsPasswordUpgrade: result.needsRehash === true
      };
    }

    const hasApiSecret = typeof env?.API_SECRET === 'string' && env.API_SECRET.length > 0;
    const passwordMatched = timingSafeEqualString(inputPassword, hasApiSecret ? env.API_SECRET : '');
    return {
      valid: hasApiSecret && usernameMatched && passwordMatched,
      needsPasswordUpgrade: false
    };
  } catch (e) {
    console.error('Credential validation error:', e);
    return { valid: false, needsPasswordUpgrade: false };
  }
}

export function simpleAuthResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized', code: 401 }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}
