import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/bootstrap/config';
import { credential } from '../src/api/auth';
test('credentials reject missing/wrong and use constant time comparison', () => { assert.throws(() => credential(undefined, 'secret')); assert.throws(() => credential('wrong', 'secret')); credential('secret', 'secret'); });
test('config fails closed without credentials', () => { assert.throws(() => loadConfig({}), /Configure|required/); });
