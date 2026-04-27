import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessagesUrl } from '../src/doctor.js';

test('buildMessagesUrl appends /v1/messages to a bare base', () => {
  assert.equal(
    buildMessagesUrl('https://api.deepseek.com/anthropic'),
    'https://api.deepseek.com/anthropic/v1/messages',
  );
});

test('buildMessagesUrl strips trailing slashes', () => {
  assert.equal(
    buildMessagesUrl('https://api.deepseek.com/anthropic/'),
    'https://api.deepseek.com/anthropic/v1/messages',
  );
  assert.equal(
    buildMessagesUrl('https://api.deepseek.com/anthropic///'),
    'https://api.deepseek.com/anthropic/v1/messages',
  );
});

test('buildMessagesUrl appends /messages when base already ends with /v1', () => {
  assert.equal(
    buildMessagesUrl('https://api.anthropic.com/v1'),
    'https://api.anthropic.com/v1/messages',
  );
  assert.equal(
    buildMessagesUrl('https://api.anthropic.com/v1/'),
    'https://api.anthropic.com/v1/messages',
  );
});

test('buildMessagesUrl is idempotent if base already ends with /v1/messages', () => {
  assert.equal(
    buildMessagesUrl('https://api.anthropic.com/v1/messages'),
    'https://api.anthropic.com/v1/messages',
  );
  assert.equal(
    buildMessagesUrl('https://api.anthropic.com/v1/messages/'),
    'https://api.anthropic.com/v1/messages',
  );
});
