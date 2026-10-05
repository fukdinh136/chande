import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { JsonHttpClient } from '../../src/infrastructure/clients/http';
import { withServer } from '../http-server';
test('HTTP client bounds upstream response size before parsing JSON', async () => {
  await withServer(() => ({ body: { data: 'x'.repeat(1048577), meta: { requestId: randomUUID() } } }), async url => {
    await assert.rejects(new JsonHttpClient(url, 'test', 1000).post('/test', {}, randomUUID(), z.string()), { reason: 'RESPONSE_TOO_LARGE', retryable: false });
  });
});
