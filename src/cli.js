import fs from 'node:fs';
import { PRESETS, allProfiles, backup, listBackups, load, resolveProfile, save, STORE_FILE } from './store.js';
import { TOOLS, restore, toolIds } from './tools.js';

const color =
  process.env.NO_COLOR === undefined && (process.stdout.isTTY || process.env.FORCE_COLOR)
    ? (code) => (s) => `[${code}m${s}[0m`
    : () => (s) => String(s);
const bold = color(1);
const dim = color(2);
const green = color(32);
const yellow = color(33);
const red = color(31);
const cyan = color(36);

const out = (line = '') => process.stdout.write(`${line}\n`);

const USAGE = `
${bold('ai-switch')} — one command to point Claude Code, Codex, OpenCode and Continue at a
different LLM provider, and one command to see where they are pointed now.

${bold('Commands')}
  ls                          List profiles (built-in presets and your own)
  status                      Show what each tool currently points at
  use <profile> [--tools a,b] Apply a profile (all supported tools by default)
  env <profile>               Print export lines:  eval "$(ai-switch env apimaster)"
  add <name> --base-url <url> [--anthropic-base-url <url>] [--key-env VAR] [--model id]
  rm <name>
  backups                     List config backups
  restore [n]                 Restore the most recent backup (or the nth from the list)

${bold('Examples')}
  ai-switch use apimaster
  ai-switch use anthropic --tools claude-code
  ai-switch status
  ai-switch add work --base-url https://gateway.internal/v1 --key-env WORK_KEY

Keys are never written into this tool's own config: a profile stores the *name* of an
environment variable, and the key is read from your environment when a tool is configured.
`;

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[arg.slice(2)] = next;
          i += 1;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

function keyFor(profile) {
  const key = process.env[profile.keyEnv];
  if (!key) return { key: null, error: `${profile.keyEnv} is not set in this shell` };
  if (/\s|^['"]|['"]$/.test(key)) {
    return { key: key.trim().replace(/^['"]|['"]$/g, ''), warning: `${profile.keyEnv} had quotes or whitespace — trimmed` };
  }
  return { key };
}

function cmdList(state) {
  const profiles = allProfiles(state);
  out('');
  for (const [name, profile] of Object.entries(profiles)) {
    const active = state.active === name ? green(' ● active') : '';
    out(`  ${cyan(name.padEnd(14))} ${(profile.label ?? '').padEnd(16)} ${dim(profile.baseUrl)}${active}`);
    out(`  ${' '.repeat(14)} ${dim(`key from $${profile.keyEnv}`)}${profile.preset ? dim('  (built-in)') : ''}`);
  }
  out('');
  out(dim(`  profiles file: ${STORE_FILE}`));
}

function cmdStatus(state) {
  out('');
  out(`  ${bold('TOOL'.padEnd(16))}${bold('POINTS AT')}`);
  for (const [id, tool] of Object.entries(TOOLS)) {
    const info = tool.status();
    const file = tool.file?.();
    const label = id.padEnd(16);
    if (!info.configured) {
      out(`  ${label}${dim('not configured')}`);
    } else {
      const mark = info.warning ? yellow('!') : green('✔');
      out(`  ${label}${mark} ${info.endpoint ?? ''} ${info.detail ? dim(info.detail) : ''}`);
      if (info.warning) out(`  ${' '.repeat(16)}${yellow(info.warning)}`);
    }
    if (file) out(`  ${' '.repeat(16)}${dim(file)}`);
  }
  out('');
  if (state.active) out(`  last applied profile: ${cyan(state.active)}`);
}

function cmdUse(state, name, flags) {
  const profile = resolveProfile(state, name);
  if (!profile) {
    out(red(`Unknown profile "${name}". Run \`ai-switch ls\`.`));
    return 1;
  }
  const requested = flags.tools ? String(flags.tools).split(',').map((s) => s.trim()) : toolIds().filter((t) => t !== 'env');
  const { key, error, warning } = keyFor(profile);
  if (error) {
    out(red(error));
    out(dim(`  export ${profile.keyEnv}=... and run this again`));
    return 2;
  }
  if (warning) out(yellow(warning));

  out('');
  for (const id of requested) {
    const tool = TOOLS[id];
    if (!tool) {
      out(`  ${yellow('skipped')} ${id} ${dim('(unknown tool)')}`);
      continue;
    }
    if (!tool.supports(profile)) {
      out(`  ${yellow('skipped')} ${id.padEnd(14)} ${dim(`${profile.name} ${tool.why ?? 'is not supported'}`)}`);
      continue;
    }
    try {
      const file = tool.apply(profile, { key });
      out(`  ${green('✔')} ${id.padEnd(14)} ${dim(file ?? '')}`);
    } catch (err) {
      out(`  ${red('✘')} ${id.padEnd(14)} ${red(err.message)}`);
    }
  }
  state.active = name;
  save(state);
  out('');
  out(`  now using ${cyan(profile.label ?? name)} ${dim(profile.baseUrl)}`);
  out(dim('  previous configs were backed up — `ai-switch restore` undoes this'));
  return 0;
}

function cmdEnv(state, name) {
  const profile = resolveProfile(state, name);
  if (!profile) {
    out(red(`Unknown profile "${name}"`));
    return 1;
  }
  const { key } = keyFor(profile);
  const lines = [
    `export OPENAI_BASE_URL="${profile.baseUrl}"`,
    `export OPENAI_API_BASE="${profile.baseUrl}"`,
    key ? `export OPENAI_API_KEY="${key}"` : `# ${profile.keyEnv} is not set`,
  ];
  if (profile.anthropicBaseUrl) {
    lines.push(`export ANTHROPIC_BASE_URL="${profile.anthropicBaseUrl}"`);
    if (key) lines.push(`export ANTHROPIC_AUTH_TOKEN="${key}"`);
  }
  lines.forEach((l) => out(l));
  return 0;
}

function cmdAdd(state, name, flags) {
  if (!name || !flags['base-url']) {
    out(red('Usage: ai-switch add <name> --base-url <url> [--anthropic-base-url <url>] [--key-env VAR] [--model id]'));
    return 1;
  }
  state.profiles[name] = {
    label: flags.label ?? name,
    baseUrl: String(flags['base-url']).replace(/\/+$/, ''),
    anthropicBaseUrl: flags['anthropic-base-url'] ? String(flags['anthropic-base-url']).replace(/\/+$/, '') : null,
    keyEnv: flags['key-env'] ?? `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`,
    models: { chat: flags.model ?? 'gpt-4o' },
  };
  save(state);
  out(`${green('Added')} ${name} → ${state.profiles[name].baseUrl}`);
  out(dim(`  key will be read from $${state.profiles[name].keyEnv}`));
  return 0;
}

function cmdBackups() {
  const entries = listBackups();
  if (!entries.length) {
    out(dim('no backups yet'));
    return 0;
  }
  entries.slice(-20).forEach((entry, i) => {
    out(`  ${String(entries.length - Math.min(20, entries.length) + i + 1).padStart(3)}  ${entry.at}  ${entry.original}`);
  });
  return 0;
}

function cmdRestore(which) {
  const entries = listBackups();
  if (!entries.length) {
    out(red('nothing to restore'));
    return 1;
  }
  const entry = which ? entries[Number(which) - 1] : entries[entries.length - 1];
  if (!entry) {
    out(red(`no backup #${which}`));
    return 1;
  }
  const target = restore(entry);
  out(`${green('restored')} ${target} ${dim(`from ${entry.at}`)}`);
  return 0;
}

export async function main(argv) {
  const { flags, positionals } = parseArgs(argv);
  const state = load();
  const command = positionals[0];

  if (!command || flags.help || command === 'help') {
    out(USAGE);
    return;
  }

  switch (command) {
    case 'ls':
    case 'list':
      cmdList(state);
      return;
    case 'status':
      cmdStatus(state);
      return;
    case 'use':
      process.exitCode = cmdUse(state, positionals[1], flags);
      return;
    case 'env':
      process.exitCode = cmdEnv(state, positionals[1]);
      return;
    case 'add':
      process.exitCode = cmdAdd(state, positionals[1], flags);
      return;
    case 'rm':
    case 'remove': {
      if (!state.profiles[positionals[1]]) {
        out(red(`No custom profile named "${positionals[1]}" (built-in presets cannot be removed)`));
        process.exitCode = 1;
        return;
      }
      delete state.profiles[positionals[1]];
      save(state);
      out(`${green('Removed')} ${positionals[1]}`);
      return;
    }
    case 'backups':
      process.exitCode = cmdBackups();
      return;
    case 'restore':
      process.exitCode = cmdRestore(positionals[1]);
      return;
    default:
      out(red(`Unknown command "${command}"`));
      out(USAGE);
      process.exitCode = 1;
  }
}

export { PRESETS, parseArgs, keyFor };
