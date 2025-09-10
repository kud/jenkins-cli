import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';

// Use isolated home directory before importing config module
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jenkins-cli-home-'));
process.env.HOME = tempHome; // posix
process.env.USERPROFILE = tempHome; // windows fallback

const cfgMod = await import('../src/config.js');
const { addServer, listServers, useServer, removeServer, loadConfig } = cfgMod;

test('multi-server add/use/remove lifecycle', async () => {
  addServer('one', { url: 'http://one', user: 'u1', token: 't1' });
  addServer('two', { url: 'http://two', user: 'u2', token: 't2' });
  let servers = listServers();
  assert.equal(servers.length, 2);
  const current = servers.find(s => s.current);
  assert.equal(current.name, 'one');

  useServer('two');
  servers = listServers();
  assert.equal(servers.find(s => s.current).name, 'two');

  removeServer('two');
  servers = listServers();
  // If removal failed, show debug info
  if (servers.length !== 1) {
    console.error('DEBUG servers after removal', servers, loadConfig());
  }
  assert.equal(servers.length, 1);
  assert.equal(servers[0].name, 'one');
  assert.equal(servers[0].current, true);

  // Ensure config file structure persisted as expected
  const raw = loadConfig();
  assert.ok(raw.servers.one);
});
