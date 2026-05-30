import { isIP } from 'net';

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd/i,
  /^metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/,
];

export const isPrivateUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && PRIVATE_HOST_PATTERNS.some((p) => p.test(host))) return true;
    if (!isIP(host) && PRIVATE_HOST_PATTERNS.some((p) => p.test(host))) return true;
    return false;
  } catch {
    return true;
  }
};
