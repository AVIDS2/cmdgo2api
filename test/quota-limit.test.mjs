import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUpstreamQuotaLimit } from '../web/admin.mjs';

test('detects a structured quota window and reset time', () => {
  const result = parseUpstreamQuotaLimit({
    message: 'quota reached',
    rateLimit: { window: 'five_hour', reset: 1_800_000_000 },
  });

  assert.deepEqual(result, {
    window: 'fiveHour',
    model: null,
    resetAtMs: 1_800_000_000_000,
  });
});

test('detects the Command Code plan-limit message', () => {
  const result = parseUpstreamQuotaLimit({
    message: "You've reached your 5-hour usage limit for your plan. Please wait.",
  });

  assert.equal(result?.window, 'fiveHour');
});

test('does not switch on a generic temporary rate limit', () => {
  assert.equal(
    parseUpstreamQuotaLimit({ message: 'Too many requests, try again later' }),
    null,
  );
});
