import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelCooldownTracker,
  extractRetryAfterSeconds,
  isModelNotFoundError,
  isQuotaRateLimitError,
  isTransientNetworkError,
  withTransientRetry,
} from './retry';

test('isTransientNetworkError detects ECONNRESET/fetch failed and excludes 429 quota limits', () => {
  const fetchErr = new TypeError('fetch failed', {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  });
  assert.equal(isTransientNetworkError(fetchErr), true);

  const notFoundErr = new Error('404 NOT_FOUND');
  assert.equal(isTransientNetworkError(notFoundErr), false);
  assert.equal(isModelNotFoundError(notFoundErr), true);

  const quotaErr = new Error(
    'ApiError: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Please retry in 30.37s.","retryDelay":"30s"}}'
  );
  assert.equal(isQuotaRateLimitError(quotaErr), true);
  assert.equal(isTransientNetworkError(quotaErr), false);
  assert.equal(extractRetryAfterSeconds(quotaErr), 30);

  const dailyQuotaErr = new Error(
    'Please retry in 14h12m42.02s. "retryDelay":"51162s"'
  );
  assert.equal(extractRetryAfterSeconds(dailyQuotaErr), 51162);

  const hmsOnlyErr = new Error('Please retry in 1h2m3.2s.');
  assert.equal(extractRetryAfterSeconds(hmsOnlyErr), 3724);
});

test('ModelCooldownTracker skips rate-limited models until their retry window expires', () => {
  const tracker = new ModelCooldownTracker();
  const baseNow = 1_700_000_000_000;
  tracker.markCoolingDown('gemini-4-hydrogen', 51162, baseNow);

  assert.equal(tracker.isCoolingDown('gemini-4-hydrogen', baseNow + 10_000), true);
  assert.equal(tracker.isCoolingDown('gemini-3.1-flash-lite', baseNow + 10_000), false);

  const available = tracker.filterAvailable(
    ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
    (m) => m,
    baseNow + 10_000
  );
  assert.deepEqual(available, ['gemini-3.1-flash-lite']);

  assert.equal(
    tracker.isCoolingDown('gemini-4-hydrogen', baseNow + 51163 * 1000),
    false
  );
});

test('withTransientRetry recovers after transient ECONNRESET and does not retry 429 quota or 400 errors', async () => {
  let attempts = 0;
  const result = await withTransientRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      });
    }
    return 'ok';
  }, 3, 5);

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);

  let nonRetryAttempts = 0;
  await assert.rejects(
    () =>
      withTransientRetry(async () => {
        nonRetryAttempts += 1;
        throw new Error('429 RESOURCE_EXHAUSTED');
      }, 3, 5),
    /429 RESOURCE_EXHAUSTED/
  );
  assert.equal(nonRetryAttempts, 1);
});
