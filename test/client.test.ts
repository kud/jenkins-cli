import test from 'node:test';
import assert from 'node:assert/strict';
import { JenkinsClient } from '../src/jenkins-client.js';

// Mock fetch
const calls = [];
const makeResponse = (status: number, body: any, headers: Record<string,string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'X',
  headers: { get: (k: string) => headers[k.toLowerCase()] },
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  arrayBuffer: async () => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
  clone: () => makeResponse(status, body, headers)
}) as unknown as Response;

global.fetch = (async (url: any, opts: any) => {
  calls.push({ url, opts });
  if (url.includes('/api/json?depth=1')) {
    return makeResponse(200, { lastBuild: { number: 42 }, builds: [{ number: 42 }, { number: 41 }] , artifacts: [] }, { 'content-type': 'application/json' });
  }
  if (url.endsWith('/42/api/json')) {
    return makeResponse(200, { number: 42, building: false, result: 'SUCCESS', artifacts: [] }, { 'content-type': 'application/json' });
  }
  if (url.endsWith('/42/consoleText')) {
    return makeResponse(200, 'Console output');
  }
  return makeResponse(404, 'Not Found');
}) as any;

test('getBuild resolves last build when unspecified', async () => {
  const client = new JenkinsClient('http://jenkins', 'u', 't');
  const build = await client.getBuild('job-name');
  assert.equal(build.number, 42);
});

test('getConsoleText returns text', async () => {
  const client = new JenkinsClient('http://jenkins', 'u', 't');
  const text = await client.getConsoleText('job-name', 42);
  assert.equal(text, 'Console output');
});
