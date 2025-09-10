import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs';
import path from 'path';

// Create isolated HOME before importing module
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jenkins-cli-home-salvage-'));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const cfgMod = await import('../src/config.js');
const { CONFIG_FILE, loadConfig, saveConfig, resolveConfig } = cfgMod;

// Corrupted file with markdown link and trailing garbage
const dir = path.dirname(CONFIG_FILE);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(CONFIG_FILE, '{ "url": "[https://ci.example.com](https://ci.example.com)", "user": "alice", "token": "t123" }%%%TRAIL');

const loaded = loadConfig();

test('salvages corrupted markdown + trailing garbage', () => {
  assert.equal(loaded.url, 'https://ci.example.com');
  assert.equal(loaded.user, 'alice');
  assert.equal(loaded.token, 't123');
});

test('undefined overrides do not wipe values', () => {
  const resolved = resolveConfig({});
  assert.equal(resolved.url, 'https://ci.example.com');
});
