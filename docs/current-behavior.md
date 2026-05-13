# Current Behavior

This document describes the current shipped behavior of `cc-use`.
Use this file as the source of truth for current CLI semantics. Historical design notes live under `docs/specs/`.

## Command modes

### `cc-use [claude args...]`

Default-profile shared launch.

- Resolves the configured default profile
- Uses native `~/.claude/` as `CLAUDE_CONFIG_DIR`
- Preserves Claude Code history, skills, projects, and settings
- A first argument starting with `-` is passed through to `claude`
- `--` explicitly separates cc-use parsing from Claude args

Typical use:

```bash
cc-use
cc-use -p "review this diff"
cc-use -- -p "review this diff"
```

### `cc-use <profile> [claude args...]`

Named-profile shared launch.

- Reuses native `~/.claude/` as `CLAUDE_CONFIG_DIR`
- Swaps the backend provider for the current launch through the selected profile env
- Extra args after the profile name pass through to `claude`

Typical use:

```bash
cc-use deepseek
cc-use deepseek -p "review this diff"
```

### `cc-use auto [claude args...]`

Automatic shared launch.

- Selects the first usable configured profile before launching Claude Code
- Uses the configured default profile first, then deduped `auto.fallbackOrder`
- Reuses fresh successful usability cache entries within TTL
- Rechecks stale, missing, unknown, or unusable entries before skipping
- Uses native `~/.claude/` as `CLAUDE_CONFIG_DIR`
- Supports `--` as an explicit pass-through separator

Typical use:

```bash
cc-use auto
cc-use auto -p "review this diff"
cc-use auto -- -p "review this diff"
```

### `cc-use with [profile] [claude args...]`

Explicit shared-context launch.

- With a profile, launches that named profile in shared mode
- Without a profile, resolves the configured default profile
- Reuses native `~/.claude/` as `CLAUDE_CONFIG_DIR`
- `cc-use with auto` remains a compatibility alias for shared auto routing
- Supports `--` as an explicit pass-through separator

Typical use:

```bash
cc-use with
cc-use with deepseek
cc-use with auto
cc-use with -- -p "review this diff"
cc-use with auto -- -p "review this diff"
```

### `cc-use isolate [profile] [claude args...]`

Explicit isolated mode.

- With a profile, launches that named profile in isolated mode
- Without a profile, resolves the configured default profile
- Uses `~/.cc-use/sessions/<profile>/` as `CLAUDE_CONFIG_DIR`
- Keeps the provider session separate from native Claude Code
- `cc-use isolate auto` runs auto routing and launches the selected profile isolated
- Supports `--` as an explicit pass-through separator

Typical use:

```bash
cc-use isolate
cc-use isolate deepseek
cc-use isolate auto
cc-use isolate -- -p "review this diff"
cc-use isolate auto -- -p "review this diff"
```

### `cc-use status`

Shows the last known auto-routing usability status.

- Reads the status cache from `~/.cc-use/status.json`
- Shows auto-participating profiles configured under `auto.profiles`
- Marks cached entries as stale when they exceed `auto.cacheTtlSeconds`
- Does not mutate routing config

## Profile and session layout

Provider configs live under:

```text
~/.cc-use/providers/<name>.json
```

Default-profile config lives under:

```text
~/.cc-use/config.json
```

Native shared-context mode uses:

```text
~/.claude/
```

Explicit isolated session data lives under:

```text
~/.cc-use/sessions/<name>/
```

Auto-routing metadata lives in:

```text
~/.cc-use/config.json
```

with an `auto` block:

```json
{
  "auto": {
    "cacheTtlSeconds": 60,
    "fallbackOrder": ["deepseek", "mimo-plan"],
    "profiles": {
      "deepseek": {
        "mode": "payg",
        "check": { "kind": "probe" }
      },
      "mimo-plan": {
        "mode": "token_plan",
        "check": { "kind": "manual_availability", "available": true }
      }
    }
  }
}
```

The status cache lives under:

```text
~/.cc-use/status.json
```

`status.json` is a sanitized cache, not a source of truth. It stores `UsabilityResult` entries and must not contain API keys, raw provider responses, or full account payloads.

## Auto routing

Auto routing is preflight-only.

Supported check kinds:

- `probe`: a minimal Anthropic-compatible Messages API request
- `manual_availability`: a configured boolean
- `api`: reserved for explicit balance adapters

The current implementation has no bundled real balance adapter. Unsupported `api` adapters fail closed as `check_failed`.

`recordUsage` is parsed for forward compatibility only. The current implementation does not write a usage ledger and does not persist before/after balance deltas.

Auto routing does not:

- switch providers mid-run
- score provider or model quality
- infer token-plan quota
- choose by task difficulty
- execute external worker mode

The checker can explain usability in detail. The router selects only the first profile where `usable === true`.

## History import

`cc-use import-history [profile]` copies native Claude Code project history into the profile session directory.

- Copy direction is one-way
- Original `~/.claude/` history is not modified
- Imported history lands under the isolated session copy

For providers that cannot resume old Claude thinking / tool-call state cleanly, `--sanitize` cleans imported history before writing it into the isolated profile copy.

Typical use:

```bash
cc-use import-history deepseek --sanitize
cc-use import-history deepseek --all --sanitize
```

## Built-in provider groups

Current built-in templates include:

- `deepseek`
- `kimi`, `kimi-plan`
- `glm`, `glm-intl`
- `qwen`, `qwen-plan`, `qwen-intl`
- `minimax`, `minimax-intl`
- `volcengine-plan`, `byteplus-plan`
- `mimo`, `mimo-plan`
- `openrouter`
- `custom`

## Recommended usage

Use the shared default mode when:

- You already use Claude Code daily
- You want to preserve native history, skills, and projects
- You want to swap providers without rebuilding your local setup

Prefer:

```bash
cc-use deepseek
cc-use auto
```

Use explicit `with` spelling when:

- You want to make shared-context intent visible in scripts or docs
- You want the compatibility spelling for `cc-use with auto`

Use `isolate` when:

- You want a clean provider-specific workspace
- You want to compare providers without mixing history
- You are debugging compatibility or import behavior
- You want the old per-profile `CLAUDE_CONFIG_DIR` behavior
