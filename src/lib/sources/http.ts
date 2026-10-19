/** Accès réseau robuste et sécurisé pour les sources de veille. */

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const lastCallAt = new Map<string, number>();

/** Respecte un délai minimal entre deux appels vers une même destination. */
export async function rateLimit(key: string, minDelayMs: number): Promise<void> {
  const last = lastCallAt.get(key) ?? 0;
  const wait = last + minDelayMs - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastCallAt.set(key, Date.now());
}

/** Bloque les adresses locales et privées (protection SSRF pour les flux RSS). */
export function isPublicHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') return false;
  // Plages privées et de liaison locale.
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(host)) return false;
  // Résolution IPv6 littérale privée.
  if (host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80')) return false;
  return true;
}

export interface PolicyResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** En-têtes de limitation de débit renvoyés par l'API (X-Ratelimit-*). */
  rateLimit?: { remaining?: number; resetSeconds?: number; used?: number };
}

/**
 * GET avec délai maximal, une nouvelle tentative en cas d'échec réseau ou
 * d'erreur 5xx, et réponse limitée en taille. Les en-têtes X-Ratelimit sont
 * exposés pour permettre le respect des quotas.
 */
export async function fetchWithPolicy<T = unknown>(
  url: string,
  options: {
    headers?: Record<string, string>;
    minDelayMs?: number;
    rateLimitKey?: string;
    retries?: number;
    method?: 'GET' | 'POST' | 'DELETE';
    body?: string;
    timeoutMs?: number;
  } = {},
): Promise<PolicyResult<T>> {
  const { headers = {}, minDelayMs = 0, rateLimitKey = new URL(url).host, retries = 1, method = 'GET', body, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  if (minDelayMs > 0) await rateLimit(rateLimitKey, minDelayMs);

  let lastError = '';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'User-Agent': USER_AGENT, ...headers },
        body,
        signal: controller.signal,
        cache: 'no-store',
      });
      const raw = await response.text();
      if (raw.length > MAX_RESPONSE_BYTES) {
        return { ok: false, error: `Réponse trop volumineuse (${Math.round(raw.length / 1024)} Ko).` };
      }
      const rateLimit = readRateLimitHeaders(response.headers);
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (response.status >= 500 && attempt < retries) continue;
        return { ok: false, error: lastError, rateLimit };
      }
      try {
        return { ok: true, data: JSON.parse(raw) as T, rateLimit };
      } catch {
        return { ok: true, data: raw as unknown as T, rateLimit };
      }
    } catch (error) {
      lastError = error instanceof Error
        ? (error.name === 'AbortError' ? `délai dépassé (${timeoutMs / 1000} s)` : error.message)
        : 'erreur réseau inconnue';
      if (attempt >= retries) return { ok: false, error: lastError };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastError || 'échec inconnu' };
}

/** Lit les en-têtes de limitation de débit d'une réponse HTTP. */
function readRateLimitHeaders(headers: Headers) {
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const resetSeconds = Number(headers.get('x-ratelimit-reset'));
  const used = Number(headers.get('x-ratelimit-used'));
  return {
    remaining: Number.isFinite(remaining) ? remaining : undefined,
    resetSeconds: Number.isFinite(resetSeconds) ? resetSeconds : undefined,
    used: Number.isFinite(used) ? used : undefined,
  };
}

/** Variante renvoyant le texte brut (XML, HTML). */
export async function fetchTextWithPolicy(
  url: string,
  options: { headers?: Record<string, string>; minDelayMs?: number; rateLimitKey?: string } = {},
): Promise<PolicyResult<string>> {
  const { headers = {}, minDelayMs = 0, rateLimitKey = new URL(url).host } = options;
  if (minDelayMs > 0) await rateLimit(rateLimitKey, minDelayMs);

  let lastError = '';
  for (let attempt = 0; attempt <= 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...headers },
        signal: controller.signal,
        cache: 'no-store',
      });
      const body = await response.text();
      if (body.length > MAX_RESPONSE_BYTES) {
        return { ok: false, error: `Réponse trop volumineuse (${Math.round(body.length / 1024)} Ko).` };
      }
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        if (response.status >= 500 && attempt < 1) continue;
        return { ok: false, error: lastError };
      }
      return { ok: true, data: body };
    } catch (error) {
      lastError = error instanceof Error
        ? (error.name === 'AbortError' ? `délai dépassé (${REQUEST_TIMEOUT_MS / 1000} s)` : error.message)
        : 'erreur réseau inconnue';
      if (attempt >= 1) return { ok: false, error: lastError };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError || 'échec inconnu' };
}

const USER_AGENT = 'GhostroarReputationBot/1.0 (+veille-e-reputation)';
