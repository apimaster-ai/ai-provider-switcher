import fs from 'node:fs';
import path from 'node:path';
import { HOME, backup } from './store.js';

const j = (...parts) => path.join(HOME, ...parts);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function deepMerge(base, patch) {
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k] ?? {}, v) : v;
  }
  return out;
}

function writeJsonMerged(file, patch) {
  backup(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const merged = deepMerge(readJson(file) ?? {}, patch);
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
  return file;
}

function writeText(file, content) {
  backup(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

/**
 * Each tool knows three things: where its config lives, how to point it at a profile,
 * and how to read back what it is currently pointed at.
 */
export const TOOLS = {
  'claude-code': {
    label: 'Claude Code',
    file: () => j('.claude', 'settings.json'),
    supports: (profile) => Boolean(profile.anthropicBaseUrl),
    why: 'needs an Anthropic-compatible endpoint',
    apply(profile, { key }) {
      return writeJsonMerged(this.file(), {
        env: {
          ANTHROPIC_BASE_URL: profile.anthropicBaseUrl,
          ANTHROPIC_AUTH_TOKEN: key,
        },
      });
    },
    status() {
      const data = readJson(this.file());
      const url = data?.env?.ANTHROPIC_BASE_URL ?? null;
      return {
        configured: Boolean(url),
        endpoint: url,
        warning: url && /\/v1\/?$/.test(url) ? 'base URL ends with /v1 — Claude Code needs the site root' : null,
      };
    },
  },

  codex: {
    label: 'Codex CLI',
    file: () => j('.codex', 'config.toml'),
    supports: () => true,
    apply(profile) {
      const id = profile.name.replace(/[^a-z0-9_]/gi, '_');
      return writeText(
        this.file(),
        `# written by ai-switch
model_provider = "${id}"
model = "${profile.models?.chat ?? 'gpt-4o'}"

[model_providers.${id}]
name = "${profile.label ?? profile.name}"
base_url = "${profile.baseUrl}"
env_key = "${profile.keyEnv}"
wire_api = "chat"
`
      );
    },
    status() {
      let text = '';
      try {
        text = fs.readFileSync(this.file(), 'utf8');
      } catch {
        return { configured: false, endpoint: null };
      }
      const url = text.match(/base_url\s*=\s*"([^"]+)"/)?.[1] ?? null;
      return {
        configured: Boolean(url),
        endpoint: url,
        warning: url && !/\/v1\/?$/.test(url) && !url.includes('localhost') ? 'base_url has no /v1' : null,
      };
    },
  },

  opencode: {
    label: 'OpenCode',
    file: () => j('.config', 'opencode', 'opencode.json'),
    supports: () => true,
    apply(profile) {
      const id = profile.name.replace(/[^a-z0-9-]/gi, '-');
      return writeJsonMerged(this.file(), {
        $schema: 'https://opencode.ai/config.json',
        provider: {
          [id]: {
            npm: '@ai-sdk/openai-compatible',
            name: profile.label ?? profile.name,
            options: { baseURL: profile.baseUrl, apiKey: `{env:${profile.keyEnv}}` },
            models: Object.fromEntries(
              Object.values(profile.models ?? { chat: 'gpt-4o' }).map((m) => [m, { name: m }])
            ),
          },
        },
      });
    },
    status() {
      const data = readJson(this.file());
      const providers = Object.entries(data?.provider ?? {});
      const first = providers[0];
      return {
        configured: providers.length > 0,
        endpoint: first?.[1]?.options?.baseURL ?? null,
        detail: providers.length ? `${providers.length} provider(s): ${providers.map(([k]) => k).join(', ')}` : null,
      };
    },
  },

  continue: {
    label: 'Continue.dev',
    file: () => j('.continue', 'config.yaml'),
    supports: () => true,
    apply(profile) {
      const model = profile.models?.chat ?? 'gpt-4o';
      return writeText(
        this.file(),
        `# written by ai-switch
name: ${profile.name}
version: 0.0.1
schema: v1
models:
  - name: ${model} (${profile.label ?? profile.name})
    provider: openai
    model: ${model}
    apiBase: ${profile.baseUrl}
    apiKey: \${{ secrets.${profile.keyEnv} }}
    roles: [chat, edit, apply]
`
      );
    },
    status() {
      let text = '';
      try {
        text = fs.readFileSync(this.file(), 'utf8');
      } catch {
        return { configured: false, endpoint: null };
      }
      const url = text.match(/apiBase:\s*(\S+)/)?.[1] ?? null;
      return { configured: Boolean(url), endpoint: url };
    },
  },

  env: {
    label: 'Shell environment',
    file: () => null,
    supports: () => true,
    apply() {
      // Nothing is written; `ai-switch env <profile>` prints export lines to eval.
      return null;
    },
    status() {
      const url = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || null;
      return { configured: Boolean(url), endpoint: url };
    },
  },
};

export function toolIds() {
  return Object.keys(TOOLS);
}

export function restore(entry) {
  if (!fs.existsSync(entry.backup)) throw new Error(`backup missing: ${entry.backup}`);
  fs.mkdirSync(path.dirname(entry.original), { recursive: true });
  fs.copyFileSync(entry.backup, entry.original);
  return entry.original;
}
