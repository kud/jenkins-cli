import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, ensureScheme, parseBuildSpecifier } from '../src/url-utils.js';

test('normalizeUrl adds missing //', () => {
  assert.equal(normalizeUrl('https:ci.example.com'), 'https://ci.example.com');
});

test('ensureScheme adds https when missing', () => {
  assert.equal(ensureScheme('ci.example.com'), 'https://ci.example.com');
});

test('parseBuildSpecifier job name', () => {
  const s = parseBuildSpecifier('my-job');
  assert.equal(s.type, 'job');
  assert.equal(s.job, 'my-job');
});

test('parseBuildSpecifier build url', () => {
  const s = parseBuildSpecifier('https://ci.example.com/job/my-job/123/');
  assert.equal(s.type, 'build-url');
  assert.equal(s.job, 'my-job');
  assert.equal(s.buildNumber, '123');
});

test('parseBuildSpecifier job url', () => {
  const s = parseBuildSpecifier('https://ci.example.com/job/my-job/');
  assert.equal(s.type, 'job-url');
  assert.equal(s.job, 'my-job');
});
