# Current Behavior

This document describes the current shipped behavior of `cc-use`.  
Use this file as the source of truth for current CLI semantics. Historical design notes for the original `v0.1` phase live under `docs/specs/v0.1/`.

## Command modes

### `cc-use auto [claude args...]`

Automatic isolated launch.

- Selects the first usable configured profile before launching Claude Code
- Uses the configured default profile first, then deduped `auto.fallbackOrder`
- Reuses fresh successful usability cache entries within TTL
- Rechecks stale, missing, unknown, or unusable entries before skipping
- Uses `~/.cc-use/sessions/<selected-profile>/` as `CLAUDE_CONFIG_DIR`

Typical use:

```bash
cc-use auto
cc-use auto -p "review this diff"
```

### `cc-use with auto [claude args...]`

Automatic shared-context launch.

- Uses the same auto profile selection path as `cc-use auto`
- Reuses native `~/.claude/` as `CLAUDE_CONFIG_DIR`
- Keeps `with` mode explicit; auto routing does not change default launch semantics

Typical use:

```bash
cc-use with auto
```

### `cc-use with <profile> [claude args...]`

Recommended daily-use mode.

- Reuses native `~/.claude/` as `CLAUDE_CONFIG_DIR`
- Keeps existing Claude Code history, skills, projects, and other local context
- Swaps the backend provider for the current launch through the selected profile env

Typical use:

```bash
cc-use with deepseek
cc-use with mimo
```

### `cc-use isolate <profile> [claude args...]`

Explicit isolated mode.

- Uses `~/.cc-use/sessions/<profile>/` as `CLAUDE_CONFIG_DIR`
- Keeps the provider session separate from native Claude Code
- Useful for experiments, comparisons, and compatibility debugging

Typical use:

```bash
cc-use isolate deepseek
cc-use isolate mimo
```

### `cc-use <profile> [claude args...]`

Compatible shorthand for isolated mode.

- Current behavior is equivalent to `cc-use isolate <profile>`
- Uses `~/.cc-use/sessions/<profile>/`
- Kept for backward compatibility and simple profile-centric workflows

Typical use:

```bash
cc-use deepseek
cc-use mimo
```

### `cc-use`

Launches with the default profile.

- If no default profile is configured and stdin is a TTY, enters the init flow
- If a default profile is configured, the current behavior is isolated mode
- Equivalent runtime behavior to `cc-use <default-profile>`

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

Isolated session data lives under:

```text
~/.cc-use/sessions/<name>/
```

Native shared-context mode uses:

```text
~/.claude/
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
- change `cc-use <profile>` into shared mode

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

Use `with` when:

- You already use Claude Code daily
- You want to preserve native history, skills, and projects
- You want to swap providers without rebuilding your local setup

Use `isolate` when:

- You want a clean provider-specific workspace
- You want to compare providers without mixing history
- You are debugging compatibility or import behavior

Use bare `cc-use <profile>` when:

- You want the legacy isolated behavior
- You prefer the shortest command and understand it is isolated mode
