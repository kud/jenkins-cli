import fs from 'fs';
import path from 'path';
import os from 'os';

// Config path: XDG (~/.config/jenkins-cli/config.json) or $XDG_CONFIG_HOME
const XDG_BASE = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const DIR = path.join(XDG_BASE, 'jenkins-cli');
const FILE = path.join(DIR, 'config.json');



export const CONFIG_FILE = FILE;

interface ServerEntry { url?: string; user?: string; token?: string; }
export interface StoredConfig { url?: string; user?: string; token?: string; current?: string; servers?: Record<string,ServerEntry>; __replaceServers?: boolean; } // persisted shape

interface ResolveOverrides { url?: string; user?: string; token?: string; server?: string; timeout?: number; retries?: number; }

export const loadConfig = (): StoredConfig => {
  try {
    if (!fs.existsSync(FILE)) return {};
    let raw = fs.readFileSync(FILE, 'utf8');
    // Salvage common corruption: trailing garbage after JSON
    const endIdx = raw.lastIndexOf('}');
    if (endIdx !== -1) raw = raw.slice(0, endIdx + 1);
    let parsed = JSON.parse(raw);
    // Salvage markdown style [url](url) values
    const fixLink = (v: any) => typeof v === 'string' && /^\[[^\]]+\]\([^\)]+\)$/.test(v) ? v.replace(/^\[[^\]]+\]\(([^\)]+)\)$/, '$1') : v;
    if (parsed && typeof parsed === 'object') {
      if (parsed.url) parsed.url = fixLink(parsed.url);
      if (parsed.servers) {
        for (const k of Object.keys(parsed.servers)) {
          const srv = parsed.servers[k];
            if (srv && srv.url) srv.url = fixLink(srv.url);
        }
      }
    }
    return parsed;
  } catch (e) {
    return {};
  }
};

export const saveConfig = (cfg: Partial<StoredConfig> & { __replaceServers?: boolean }) => {
  fs.mkdirSync(DIR, { recursive: true });
  let merged;
  const existing = loadConfig();
  if (cfg.__replaceServers) {
    merged = { ...existing, servers: cfg.servers || {}, current: cfg.current };
  } else if (cfg.servers) {
    merged = { ...existing, servers: { ...(existing.servers || {}), ...cfg.servers } };
    if (cfg.current) merged.current = cfg.current;
  } else if (cfg.url || cfg.user || cfg.token) {
    merged = { ...existing, ...cfg };
  } else {
    merged = { ...existing, ...cfg };
  }

  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2));
};

const pickServer = (file, serverName) => {
  if (!file.servers) return null;
  const name = serverName || file.current || Object.keys(file.servers)[0];
  if (!name) return null;
  const srv = file.servers[name];
  if (!srv) return null;
  return { name, ...srv };
};

export const resolveConfig = (overrides: ResolveOverrides = {}): StoredConfig => {
  const rawEnv = {
    url: process.env.JENKINS_URL,
    user: process.env.JENKINS_USER,
    token: process.env.JENKINS_TOKEN,
    server: process.env.JENKINS_SERVER,
    timeout: process.env.JENKINS_TIMEOUT ? parseInt(process.env.JENKINS_TIMEOUT, 10) : undefined,
    retries: process.env.JENKINS_RETRIES ? parseInt(process.env.JENKINS_RETRIES, 10) : undefined
  };
  // Only include env vars that are non-empty (avoid overriding file values with empty strings)
  const env = Object.fromEntries(Object.entries(rawEnv).filter(([_, v]) => v !== undefined && v !== ''));
  const file = loadConfig();
  let base = {};
  if (file.servers) {
    const srv = pickServer(file, (overrides as any).server || (env as any).server);
    if (srv) base = { ...srv };
  } else {
    base = { url: file.url, user: file.user, token: file.token };
  }
  const cleanOverrides = Object.fromEntries(Object.entries(overrides).filter(([_, v]) => v !== undefined));
  return { ...base, ...env, ...cleanOverrides };
};

export const addServer = (name, { url, user, token }) => {
  const file = loadConfig();
  const servers = { ...(file.servers || {}) };
  servers[name] = { url, user, token };
  const current = file.current || name;
  saveConfig({ ...file, servers, current });
};

export const useServer = (name) => {
  const file = loadConfig();
  if (!file.servers || !file.servers[name]) throw new Error(`Server '${name}' not found`);
  saveConfig({ ...file, current: name });
};

export const removeServer = (name) => {
  const file = loadConfig();
  if (!file.servers || !file.servers[name]) throw new Error(`Server '${name}' not found`);
  const servers = { ...file.servers };
  delete servers[name];
  let current = file.current;
  if (current === name) current = Object.keys(servers)[0];
  saveConfig({ ...file, servers, current, __replaceServers: true });
};

export const listServers = () => {
  const file = loadConfig();
  const list = Object.entries(file.servers || {}).map(([name, v]) => ({ name, ...v, current: file.current === name }));
  return list;
};
