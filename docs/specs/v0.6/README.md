# cc-use v0.6 Spec Overview

> This document defines the planned `v0.6` isolate context replication design.
> It is a maintainers' technical design spec, not a release note.
>
> This is a planning document only. It does not describe an already implemented
> or already released package state.

## 1. Positioning

`v0.6` completes the practical isolate-mode story.

`v0.5` made shared native `~/.claude/` the default daily-driver mode. `v0.6`
focuses on users who explicitly choose isolate mode and want each isolated
profile to have a usable Claude Code environment, not only an empty config dir
or imported project history.

The core problem:

- `cc-use isolate <profile>` already creates a separate `CLAUDE_CONFIG_DIR`.
- Current `import-history` mainly copies project transcripts/history.
- A real isolated Claude Code environment may also need user-level context:
  settings, agents/subagents, skills, commands, MCP server config, hooks, and
  plugin-related state or configuration.
- Blindly copying the whole `~/.claude` directory is unsafe. It may copy
  secrets, credentials, caches, machine-specific paths, or executable
  integrations.

Product goal:

```text
Provide an explicit, reviewable, allowlist-based way to copy selected native
Claude Code context into an isolated profile session.
```

## 2. Terminology

### Native Claude context

The user's existing Claude Code state, usually under:

```text
~/.claude/
```

### Isolated profile context

The per-profile Claude Code state used by `cc-use isolate`, usually under:

```text
~/.cc-use/sessions/<profile>/
```

### Context replication

A controlled copy operation from native Claude context to isolated profile
context.

### Safe item

A file or directory category considered safe enough to copy by default, subject
to existence checks and overwrite policy.

### Sensitive / executable item

A file or directory category that may contain credentials, secrets,
machine-specific configuration, or executable behavior. These must require
explicit user opt-in.

## 3. Current state

Current isolate mode:

```bash
cc-use isolate <profile>
cc-use isolate
cc-use isolate auto
```

uses:

```text
CLAUDE_CONFIG_DIR=~/.cc-use/sessions/<profile>
```

Current import behavior:

```bash
cc-use import-history <profile>
```

copies project history from native Claude Code projects into:

```text
~/.cc-use/sessions/<profile>/projects
```

`import-history` is history-focused. It does not yet represent full context
replication and does not intentionally copy settings, agents, skills, commands,
MCP configuration, hooks, plugins, or other user-level Claude Code context.

`v0.6` must not remove `import-history`. It remains a compatibility command.

## 4. Proposed command: `import-context`

New command:

```bash
cc-use import-context <profile>
```

Purpose:

```text
Copy selected native Claude Code context into the isolated session for <profile>.
```

Default behavior should be safe and explicit. Suggested command forms:

```bash
cc-use import-context <profile>
cc-use import-context <profile> --dry-run
cc-use import-context <profile> --force
cc-use import-context <profile> --include projects,settings,agents
cc-use import-context <profile> --include skills,commands
cc-use import-context <profile> --include mcp,hooks,plugins
cc-use import-context <profile> --all --dry-run
```

Default-profile behavior:

```bash
cc-use import-context
```

uses the configured default profile if present. If no default profile is
configured, it should error clearly in non-interactive mode.

## 5. Relationship with `import-history`

Recommended decision:

```text
import-history remains a compatibility command focused only on project
transcript/history import.

import-context becomes the broader context replication command.
```

Possible implementation relationship:

```bash
cc-use import-history <profile>
```

may eventually be treated as equivalent to:

```bash
cc-use import-context <profile> --include projects
```

But `v0.6` does not need to remove or rename `import-history`.

Rules:

- `import-history` should keep existing behavior.
- `import-context` should be the new recommended command for full isolate
  preparation.
- README files can later explain both:
  - daily shared mode needs no import
  - isolate mode can use `import-context` to copy selected native context

## 6. Context item categories

The exact native source paths should be verified during implementation by
inspecting Claude Code's current directory structure. This spec names
conceptual categories and likely path shapes; uncertain paths must not be
hard-coded as facts without implementation-time verification.

| Category | Example native source | Isolated target | Default? | Risk level | Notes |
| --- | --- | --- | --- | --- | --- |
| `projects` | Native Claude Code project history directory, likely `~/.claude/projects` | `projects/` | Yes, or configurable | Medium | May contain transcripts and local project paths. Existing sanitize behavior may apply. |
| `settings` | User settings file(s), for example a recognized settings JSON file | Corresponding isolated settings file(s) | Yes | Medium | May contain preferences and possibly paths. Avoid copying secrets if discovered. |
| `agents` | User agents / subagents directory, if present | Corresponding isolated agents directory | Yes | Low to medium | Mostly user-authored agent definitions, but may reference tools or paths. |
| `skills` | User skills directory, if present and path is known | Corresponding isolated skills directory | Yes, if path is known and exists | Medium | Skills may include scripts, instructions, or assets. |
| `commands` | Custom slash commands directory, if present and path is known | Corresponding isolated commands directory | Yes, if path is known and exists | Medium | May contain workflow instructions and command definitions. |
| `mcp` | MCP configuration | Corresponding isolated MCP configuration | No | High | May reference local executables, network services, environment variables, secrets, or credentials. |
| `hooks` | Hook configuration | Corresponding isolated hook configuration | No | High | Hooks can execute commands and should require explicit opt-in. |
| `plugins` | Plugin-related config/state, if present | Corresponding isolated plugin config/state | No | High | Plugin systems may install commands, agents, hooks, skills, MCP servers, or executable behavior. |
| `unknown` | Any unrecognized top-level native file or directory | None by default | No | Unknown | Do not copy unknown top-level files or directories by default. |

## 7. Safety model

`v0.6` must not blindly copy the entire native `~/.claude` directory.

Required safety rules:

- Use an allowlist of known categories.
- Default copy set should avoid high-risk executable/integration categories.
- MCP, hooks, plugins, and unknown files require explicit `--include`.
- Support `--dry-run` to show planned copy operations without writing.
- Avoid copying raw credentials, tokens, auth files, caches, lock files, logs,
  or machine-specific runtime state.
- Do not follow symlinks by default.
- Detect and report symlinks.
- Do not overwrite existing isolated files unless `--force` is provided.
- When not using `--force`, detect conflicts and report them.
- Keep permissions conservative when writing copied files.
- Prefer deterministic copy behavior and clear summaries.

Copied context may still contain user-authored sensitive information. The
`--dry-run` flow and explicit category selection are part of the user-facing
safety contract, not implementation conveniences.

## 8. Default copy policy

Recommended default:

```bash
cc-use import-context <profile>
```

copies only safer recognized categories:

```text
projects
settings
agents
skills
commands
```

if they exist and are recognized.

It does not copy by default:

```text
mcp
hooks
plugins
unknown
auth/cache/runtime files
```

If implementation uncertainty around `skills` and `commands` paths is high,
`v0.6` may start with:

```text
projects
settings
agents
```

and add `skills` / `commands` once paths are verified. The intended target is
still to make isolate mode capable of carrying over Claude Code's user-level
working context, not only history.

## 9. Overwrite and merge behavior

### Without `--force`

- Create missing files/directories.
- Skip existing targets.
- Report conflicts.
- Exit non-zero if conflicts prevent a complete import.

### With `--force`

- Overwrite target files for selected categories.
- Replace copied directories category-by-category, or copy recursively with
  overwrite.
- Do not delete unrelated target categories unless explicitly selected.

### Merge vs replace

For `v0.6`, prefer simple copy/overwrite semantics over complex semantic
merging.

Do not attempt to merge JSON settings deeply unless there is a clear schema and
test coverage.

```text
v0.6 should prefer predictable file-level copy semantics over clever merges.
```

## 10. Sanitization

Existing `import-history` supports transcript sanitization for provider
compatibility.

Supported design options:

```bash
cc-use import-context <profile> --sanitize-history
```

or:

```bash
cc-use import-context <profile> --include projects --sanitize
```

Recommended decision:

- Prefer `--sanitize-history` for `import-context`, because the option name
  makes the scope explicit.
- Sanitization applies only to project transcript/history files.
- Sanitization must not rewrite settings, agents, skills, commands, MCP config,
  hooks, or plugins.
- Keep existing transcript sanitization logic reusable.

## 11. Dry-run output

Expected dry-run behavior:

```text
$ cc-use import-context deepseek --dry-run

Source: ~/.claude
Target: ~/.cc-use/sessions/deepseek

Will copy:
  projects     ~/.claude/projects -> ~/.cc-use/sessions/deepseek/projects
  settings     ~/.claude/settings.json -> ~/.cc-use/sessions/deepseek/settings.json
  agents       ~/.claude/agents -> ~/.cc-use/sessions/deepseek/agents

Skipped:
  mcp          not included by default
  hooks        not included by default
  plugins      not included by default

Conflicts:
  settings     target exists, use --force to overwrite
```

Dry-run should:

- not create directories
- not write files
- report missing categories
- report conflicts
- report skipped high-risk categories
- make it obvious what will be copied

## 12. CLI semantics

Suggested options:

```text
cc-use import-context [profile]
  --include <comma-separated categories>
  --exclude <comma-separated categories>
  --all
  --dry-run
  --force
  --sanitize-history
```

Rules:

- If `profile` is omitted, use the configured default profile.
- If no default exists, fail clearly in non-interactive mode.
- Validate profile existence before copying.
- Unknown include/exclude categories should error clearly.
- `--all` means all known categories, but still should not include unknown
  files.
- `--all` should include high-risk categories only after explicit acceptance in
  TTY mode, or require a stronger non-interactive flag.
- In non-interactive mode, avoid prompts and fail closed.

Optional stricter flag:

```bash
cc-use import-context <profile> --include-risky mcp,hooks,plugins
```

For the MVP, `--include mcp,hooks,plugins` is acceptable if the implementation
also makes the risk obvious in dry-run and avoids prompts in non-interactive
mode. If `--all` is used non-interactively, it should not silently import risky
categories unless the final implementation defines an explicit acceptance
mechanism.

## 13. Implementation guidance

This section is guidance for later code work only.

Suggested module:

```text
src/importContext.ts
```

Responsibilities:

- parse `import-context` options
- resolve profile/default profile
- discover known native context categories
- build copy plan
- render dry-run
- execute copy plan
- handle conflicts and force mode
- reuse transcript sanitization where appropriate

Potential refactor:

```text
src/importHistory.ts
```

may expose reusable helpers for:

- project history path resolution
- transcript sanitization
- recursive copy with sanitize support

Potential shared utilities:

```text
src/contextPlan.ts
src/copy.ts
```

Only introduce shared utilities if they keep the implementation simpler. Do not
over-engineer the file split before the copy rules stabilize.

## 14. Test plan

Future implementation should cover:

- `import-context <profile> --dry-run` prints planned safe categories and writes
  nothing.
- `import-context` without profile uses default profile.
- Missing default profile errors clearly.
- Missing profile errors clearly.
- Default import copies projects/settings/agents if present.
- Missing optional categories are reported but not fatal.
- Target conflict without `--force` is reported.
- Target conflict with `--force` overwrites selected files.
- `--include projects` copies only projects.
- `--include mcp` requires explicit opt-in and is not included by default.
- Unknown category errors clearly.
- Symlinks are not followed by default.
- `--sanitize-history` only affects project transcript files.
- Existing `import-history` behavior remains compatible.
- `remove --delete-session` still removes isolated session directories.
- Shared default mode remains unaffected by `import-context`.

## 15. Documentation updates for later implementation

After implementation, update:

- `README.md`
- `README.zh-CN.md`
- `src/help.ts`
- `docs/releases/0.6.0.md` or the final `v0.6` release notes path

README files should explain:

- default shared mode usually does not need import
- isolate mode uses a separate Claude Code context
- `import-context` can copy selected native context into isolate
- high-risk categories such as MCP/hooks/plugins are opt-in

## 16. Non-goals

`v0.6` does not introduce:

- changing default mode away from with-first
- automatic background synchronization between native and isolated contexts
- bidirectional sync
- live watching of `~/.claude`
- semantic merging of settings or plugin configs
- automatic secret detection with perfect guarantees
- cloud storage
- worker mode
- external agent orchestration
- mid-run provider switching
- automatic model selection
- removing `import-history`

## 17. Acceptance checklist

- [ ] `docs/specs/v0.6/README.md` exists.
- [ ] `import-context` command design is defined.
- [ ] Safe default categories are defined.
- [ ] Risky categories are opt-in.
- [ ] Dry-run behavior is specified.
- [ ] Overwrite/conflict behavior is specified.
- [ ] `import-history` compatibility is preserved.
- [ ] Tests cover default profile resolution.
- [ ] Tests cover dry-run/no-write behavior.
- [ ] Tests cover conflict and force behavior.
- [ ] Tests cover risky category opt-in.
- [ ] README update scope is identified.
