# ai-provider-switcher

Point Claude Code, Codex CLI, OpenCode and Continue at a different LLM provider with one
command — and find out where they currently point with another.

```bash
npx @apimaster/ai-provider-switcher status
npx @apimaster/ai-provider-switcher use apimaster
```

Zero dependencies, Node 18.17+.

## The problem

If you use more than one coding agent, your provider config is spread across four files
in four formats:

```
~/.claude/settings.json          env.ANTHROPIC_BASE_URL   (no /v1 — this one trips everybody up)
~/.codex/config.toml             [model_providers.x] base_url
~/.config/opencode/opencode.json provider.x.options.baseURL
~/.continue/config.yaml          models[].apiBase
```

Switching between a work gateway, a personal key and a local model means editing all
four by hand, and when something breaks you cannot tell which tool is talking to which
endpoint.

## Commands

### `status` — where is everything pointed

```
  TOOL            POINTS AT
  claude-code     ✔ https://apimaster.ai
                  ~/.claude/settings.json
  codex           ✔ https://apimaster.ai/v1
                  ~/.codex/config.toml
  opencode        ! http://localhost:11434    base_url has no /v1
                  ~/.config/opencode/opencode.json
  continue        not configured
```

### `use <profile>` — switch everything at once

```bash
ai-switch use apimaster                    # every supported tool
ai-switch use anthropic --tools claude-code
ai-switch use ollama --tools codex,continue
```

Existing config files are copied into `~/.ai-switch/backups/` before anything is
written, and `ai-switch restore` puts the last one back.

Tools that cannot serve a profile are skipped with a reason rather than half-configured:
Claude Code speaks the Anthropic protocol, so a provider with no Anthropic-compatible
endpoint is reported as skipped, not silently broken.

### `env <profile>` — for a shell session only

```bash
eval "$(ai-switch env apimaster)"
```

### `add` — your own gateway

```bash
ai-switch add work \
  --base-url https://gateway.internal/v1 \
  --anthropic-base-url https://gateway.internal \
  --key-env WORK_LLM_KEY \
  --model gpt-4o
```

## Built-in profiles

| Profile | Base URL | Key from |
| --- | --- | --- |
| `openai` | `https://api.openai.com/v1` | `$OPENAI_API_KEY` |
| `anthropic` | `https://api.anthropic.com/v1` | `$ANTHROPIC_API_KEY` |
| `apimaster` | `https://apimaster.ai/v1` | `$APIMASTER_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/v1` | `$OPENROUTER_API_KEY` |
| `deepseek` | `https://api.deepseek.com/v1` | `$DEEPSEEK_API_KEY` |
| `ollama` | `http://localhost:11434/v1` | `$OLLAMA_API_KEY` |

Add your own with `add`; a profile you define shadows a built-in one with the same name.

## Keys are never stored here

A profile records the **name of an environment variable**, not a key. When you run `use`,
the key is read from your environment at that moment and written only into the tool's own
config file, which is where the tool expects it. `~/.ai-switch/profiles.json` stays free
of secrets, so you can commit it to a dotfiles repo.

Keys that arrive wrapped in quotes or with a trailing newline — the single most common
cause of a mysterious 401 — are trimmed, and the tool tells you it did.

## Why `~/.claude/settings.json` is different

Claude Code speaks Anthropic's Messages protocol, and its base URL is the **site root**:

```json
{ "env": { "ANTHROPIC_BASE_URL": "https://apimaster.ai" } }
```

Adding `/v1` there produces a 404 that looks like an auth problem. `status` flags it
when it sees it.

## Development

```bash
npm test
node bin/ai-switch.js status
```

## License

MIT
