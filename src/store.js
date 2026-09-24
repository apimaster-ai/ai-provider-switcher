import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const STORE_DIR = path.join(HOME, '.ai-switch');
export const STORE_FILE = path.join(STORE_DIR, 'profiles.json');
export const BACKUP_DIR = path.join(STORE_DIR, 'backups');

/**
 * Built-in presets. Keys are never stored here — a profile points at an environment
 * variable name, so switching providers does not copy secrets between config files.
 */
export const PRESETS = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    anthropicBaseUrl: null,
    keyEnv: 'OPENAI_API_KEY',
    models: { chat: 'gpt-5.5' },
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    anthropicBaseUrl: 'https://api.anthropic.com',
    keyEnv: 'ANTHROPIC_API_KEY',
    models: { chat: 'claude-sonnet-4-6' },
  },
  apimaster: {
    label: 'APIMaster',
    baseUrl: 'https://apimaster.ai/v1',
    // Anthropic-compatible base is the site root: no /v1.
    anthropicBaseUrl: 'https://apimaster.ai',
    keyEnv: 'APIMASTER_API_KEY',
    models: { chat: 'gpt-5.5', claude: 'claude-sonnet-4-6' },
    docs: 'https://apimaster.ai/docs',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    anthropicBaseUrl: null,
    keyEnv: 'OPENROUTER_API_KEY',
    models: { chat: 'openai/gpt-4o' },
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    anthropicBaseUrl: 'https://api.deepseek.com/anthropic',
    keyEnv: 'DEEPSEEK_API_KEY',
    // DeepSeek's own API (not a gateway), whose documented chat id is deepseek-chat.
    models: { chat: 'deepseek-chat' },
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    anthropicBaseUrl: null,
    keyEnv: 'OLLAMA_API_KEY',
    models: { chat: 'llama3.1' },
  },
};

export function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return { profiles: {}, active: null };
  }
}

export function save(state) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  return STORE_FILE;
}

export function resolveProfile(state, name) {
  if (state.profiles[name]) return { name, ...state.profiles[name] };
  if (PRESETS[name]) return { name, ...PRESETS[name], preset: true };
  return null;
}

export function allProfiles(state) {
  const merged = {};
  for (const [name, preset] of Object.entries(PRESETS)) merged[name] = { ...preset, preset: true };
  for (const [name, profile] of Object.entries(state.profiles)) merged[name] = { ...profile, preset: false };
  return merged;
}

/** Copy a file into the backup directory before we touch it. Restorable, never lossy. */
export function backup(file) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${path.basename(file)}.${stamp}`;
  const target = path.join(BACKUP_DIR, name);
  fs.copyFileSync(file, target);
  const index = path.join(BACKUP_DIR, 'index.json');
  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(index, 'utf8'));
  } catch {
    /* first backup */
  }
  entries.push({ original: file, backup: target, at: new Date().toISOString() });
  fs.writeFileSync(index, JSON.stringify(entries, null, 2) + '\n');
  return target;
}

export function listBackups() {
  try {
    return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'index.json'), 'utf8'));
  } catch {
    return [];
  }
}
