export function extractErrorText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const errObj = err as {
    message?: string;
    code?: string;
    status?: number | string;
    cause?: { code?: string; message?: string };
  };
  return `${errObj.status || ''} ${errObj.message || ''} ${errObj.code || ''} ${errObj.cause?.code || ''} ${errObj.cause?.message || ''}`;
}

export function isQuotaRateLimitError(err: unknown): boolean {
  const text = extractErrorText(err).toLowerCase();
  return (
    text.includes('429') ||
    text.includes('resource_exhausted') ||
    text.includes('quota exceeded') ||
    text.includes('rate-limits') ||
    text.includes('rate limit')
  );
}

export function isModelNotFoundError(err: unknown): boolean {
  const text = extractErrorText(err).toLowerCase();
  return (
    text.includes('404') ||
    text.includes('not_found') ||
    text.includes('not found') ||
    text.includes('not supported')
  );
}

export function extractRetryAfterSeconds(err: unknown): number | null {
  const text = extractErrorText(err);

  // Prefer explicit JSON retryDelay (e.g. "retryDelay":"51162s")
  const retryDelayMatch = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (retryDelayMatch) {
    const val = Math.ceil(Number(retryDelayMatch[1]));
    if (Number.isFinite(val) && val > 0) return val;
  }

  // Handle "Please retry in 14h12m42.02s"
  const hmsMatch = text.match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s/i);
  if (hmsMatch) {
    const h = Number(hmsMatch[1] || 0);
    const m = Number(hmsMatch[2] || 0);
    const s = Number(hmsMatch[3] || 0);
    const total = Math.ceil(h * 3600 + m * 60 + s);
    if (Number.isFinite(total) && total > 0) return total;
  }

  return null;
}

export function isTransientNetworkError(err: unknown): boolean {
  if (!err || isQuotaRateLimitError(err)) return false;
  const text = extractErrorText(err).toLowerCase();

  return (
    text.includes('fetch failed') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('epipe') ||
    text.includes('eai_again') ||
    text.includes('enotfound') ||
    text.includes('socket hang up') ||
    text.includes('und_err_socket') ||
    text.includes('502') ||
    text.includes('503') ||
    text.includes('504') ||
    text.includes('unavailable')
  );
}

export class ModelCooldownTracker {
  private readonly blockedUntil = new Map<string, number>();

  markCoolingDown(modelKey: string, durationSeconds: number, nowMs = Date.now()): void {
    const safeSec = Math.max(5, Math.min(24 * 3600, Math.ceil(durationSeconds)));
    const nextUntil = nowMs + safeSec * 1000;
    const prev = this.blockedUntil.get(modelKey) ?? 0;
    if (nextUntil > prev) {
      this.blockedUntil.set(modelKey, nextUntil);
    }
  }

  isCoolingDown(modelKey: string, nowMs = Date.now()): boolean {
    const until = this.blockedUntil.get(modelKey);
    if (!until) return false;
    if (nowMs >= until) {
      this.blockedUntil.delete(modelKey);
      return false;
    }
    return true;
  }

  getRemainingSeconds(modelKey: string, nowMs = Date.now()): number {
    const until = this.blockedUntil.get(modelKey);
    if (!until || nowMs >= until) return 0;
    return Math.ceil((until - nowMs) / 1000);
  }

  filterAvailable<T>(candidates: T[], keyOf: (item: T) => string, nowMs = Date.now()): T[] {
    return candidates.filter((c) => !this.isCoolingDown(keyOf(c), nowMs));
  }

  getShortestRemainingSeconds(keys: string[], nowMs = Date.now()): number | null {
    let shortest: number | null = null;
    for (const k of keys) {
      const rem = this.getRemainingSeconds(k, nowMs);
      if (rem > 0 && (shortest === null || rem < shortest)) {
        shortest = rem;
      }
    }
    return shortest;
  }
}

export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 450
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransientNetworkError(err)) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
