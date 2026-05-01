# Current Behavior

This document describes the current shipped behavior of `cc-use`.  
Use this file as the source of truth for current CLI semantics. Historical design notes for the original `v0.1` phase live under `docs/specs/v0.1/`.

## Command modes

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
