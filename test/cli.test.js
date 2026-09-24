import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { parseArgs, keyFor } from '../src/cli.js';
import { PRESETS, resolveProfile } from '../src/store.js';
import { TOOLS } from '../src/tools.js';

describe('parseArgs', () => {
  test('reads --flag value and --flag=value', () => {
    const { flags, positionals } = parseArgs(['use', 'apimaster', '--tools', 'claude-code,codex']);
    assert.deepEqual(positionals, ['use', 'apimaster']);
    assert.equal(flags.tools, 'claude-code,codex');
    assert.equal(parseArgs(['add', 'x', '--base-url=https://a/v1']).flags['base-url'], 'https://a/v1');
  });
});

describe('presets', () => {
  test('the Anthropic-compatible base of APIMaster has no /v1', () => {
    assert.equal(PRESETS.apimaster.anthropicBaseUrl, 'https://apimaster.ai');
    assert.match(PRESETS.apimaster.baseUrl, /\/v1$/);
  });

  test('providers without an Anthropic endpoint are marked as such', () => {
    assert.equal(PRESETS.openai.anthropicBaseUrl, null);
    assert.equal(TOOLS['claude-code'].supports(PRESETS.openai), false);
    assert.equal(TOOLS['claude-code'].supports(PRESETS.apimaster), true);
  });

  test('a preset resolves even with no saved profiles', () => {
    const profile = resolveProfile({ profiles: {} }, 'apimaster');
    assert.equal(profile.preset, true);
    assert.equal(profile.name, 'apimaster');
  });

  test('a user profile shadows a preset of the same name', () => {
    const state = { profiles: { apimaster: { baseUrl: 'https://mirror/v1', keyEnv: 'X' } } };
    assert.equal(resolveProfile(state, 'apimaster').baseUrl, 'https://mirror/v1');
  });
});

describe('keyFor', () => {
  test('reports a missing environment variable instead of writing an empty key', () => {
    delete process.env.TEST_SWITCH_KEY;
    const result = keyFor({ keyEnv: 'TEST_SWITCH_KEY' });
    assert.equal(result.key, null);
    assert.match(result.error, /TEST_SWITCH_KEY/);
  });

  test('trims quotes and whitespace, and says so', () => {
    process.env.TEST_SWITCH_KEY = '"sk-abc123"  ';
    const result = keyFor({ keyEnv: 'TEST_SWITCH_KEY' });
    assert.equal(result.key, 'sk-abc123');
    assert.match(result.warning, /trimmed/);
    delete process.env.TEST_SWITCH_KEY;
  });
});

describe('tool status parsing', () => {
  test('every tool exposes file/supports/apply/status', () => {
    for (const [id, tool] of Object.entries(TOOLS)) {
      assert.equal(typeof tool.supports, 'function', `${id}.supports`);
      assert.equal(typeof tool.apply, 'function', `${id}.apply`);
      assert.equal(typeof tool.status, 'function', `${id}.status`);
    }
  });
});
