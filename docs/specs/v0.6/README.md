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
Make isolate mode automatically carry over the user's safe native Claude Code
working context by default, while keeping the copy operation allowlist-based,
reviewable, and controllable.
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
context. In `v0.6`, context replication is normally triggered automatically
before an isolated launch, and can also be run manually through
`import-context`.

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

## 4. Proposed behavior: isolate auto context replication

Primary `v0.6` behavior:

```bash
cc-use isolate <profile>
cc-use isolate
cc-use isolate auto
```

should automatically prepare the selected isolated profile context before
launching Claude Code.

Default isolate launch should replicate all safe recognized context categories:

```text
projects
settings-safe
agents
skills
commands
```

In this spec, "default all sync" means all safe recognized non-risky categories.
It does not mean copying the whole native `~/.claude` directory, and it does not
include risky categories.

The launch-time sync must remain fail-closed for risky categories:

```text
settings-raw
mcp
hooks
plugins
unknown
auth/cache/runtime files
```

are not copied by default during `cc-use isolate`.

Recommended launch-time sync behavior:

- run automatically before the isolated Claude Code child process starts
- use the same category discovery and copy plan as `import-context`
- copy default safe categories without requiring a separate manual command
- copy project history in raw form by default
- keep the operation one-way: native Claude context -> isolated profile context
- never write back to native `~/.claude`
- avoid prompts during launch
- report a short summary when anything was copied, skipped, or conflicted

Automatic launch-time sync is still not background synchronization. It runs only
when `cc-use isolate ...` is invoked.

## 5. Supporting command: `import-context`

New command:

```bash
cc-use import-context <profile>
```

Purpose:

```text
Copy selected native Claude Code context into the isolated session for <profile>.
```

`import-context` remains useful even though isolate launches sync by default.
It is the explicit control surface for previewing, re-running, forcing, or
requesting risky categories outside the launch path.

Default `import-context` behavior should match the automatic safe isolate sync.
Suggested command forms:

```bash
cc-use import-context <profile>
cc-use import-context <profile> --dry-run
cc-use import-context <profile> --force
cc-use import-context <profile> --include projects,settings-safe,agents
cc-use import-context <profile> --include skills,commands
cc-use import-context <profile> --include-risky mcp,hooks,plugins
cc-use import-context <profile> --all --dry-run
```

Default-profile behavior:

```bash
cc-use import-context
```

uses the configured default profile if present. If no default profile is
configured, it should error clearly in non-interactive mode.

## 6. Relationship with `import-history`

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
- `cc-use isolate ...` should be the default path for automatic safe context
  preparation and launch.
- `import-context` should be the recommended manual command for previewing,
  refreshing, forcing, or selecting categories.
- README files can later explain both:
  - daily shared mode needs no import
  - isolate mode automatically syncs safe native context before launch
  - `import-context` can manually re-run or customize the same replication plan

## 7. Context item categories

The exact native source paths should be verified during implementation by
inspecting Claude Code's current directory structure. This spec names
conceptual categories and likely path shapes; uncertain paths must not be
hard-coded as facts without implementation-time verification.

| Category | Example native source | Isolated target | Default? | Risk level | Notes |
| --- | --- | --- | --- | --- | --- |
| `projects` | Native Claude Code project history directory, likely `~/.claude/projects` | `projects/` | Yes | Medium | May contain transcripts and local project paths. Existing sanitize behavior may apply. |
| `settings-safe` | User settings file(s), for example a recognized settings JSON file, filtered to safe keys | Corresponding isolated settings file(s) | Yes | Medium | Copies only known non-executable and non-secret settings. Must not copy `env`, `apiKeyHelper`, `hooks`, or integration/runtime fields by default. |
| `settings-raw` | Raw user settings file(s), for example `settings.json` when verified | Corresponding isolated settings file(s) | No | High | Raw settings may contain environment variables, auth helpers, hooks, local paths, MCP/plugin/integration config, or executable behavior. Requires `--include-risky settings-raw`. |
| `agents` | User agents / subagents directory, if present | Corresponding isolated agents directory | Yes | Low to medium | Mostly user-authored agent definitions, but may reference tools or paths. |
| `skills` | User skills directory, if present and path is known | Corresponding isolated skills directory | Yes, if path is known and exists | Medium | Skills may include scripts, instructions, or assets. |
| `commands` | Custom slash commands directory, if present and path is known | Corresponding isolated commands directory | Yes, if path is known and exists | Medium | May contain workflow instructions and command definitions. |
| `mcp` | MCP configuration | Corresponding isolated MCP configuration | No | High | May reference local executables, network services, environment variables, secrets, or credentials. |
| `hooks` | Hook configuration | Corresponding isolated hook configuration | No | High | Hooks can execute commands and should require explicit opt-in. |
| `plugins` | Plugin-related config/state, if present | Corresponding isolated plugin config/state | No | High | High-risk composite integration category. Plugin systems may install or reference commands, agents, hooks, skills, MCP servers, or executable behavior. |
| `unknown` | Any unrecognized top-level native file or directory | None by default | No | Unknown | Do not copy unknown top-level files or directories by default. |

## 8. Safety model

`v0.6` must not blindly copy the entire native `~/.claude` directory.

Required safety rules:

- Use an allowlist of known categories.
- Default copy set should avoid high-risk executable/integration categories.
- Raw settings, MCP, hooks, plugins, and unknown files are not part of the safe
  default set.
- Risky categories require explicit `--include-risky`.
- Support `--dry-run` to show planned copy operations without writing.
- Avoid copying raw credentials, tokens, auth files, caches, lock files, logs,
  or machine-specific runtime state.
- Default settings replication must be field-filtered. It must not raw-copy
  settings fields that can carry credentials, environment injection, executable
  hooks, MCP/plugin integration, or machine-specific runtime behavior.
- Do not follow symlinks by default.
- Detect and report symlinks.
- Do not overwrite existing isolated files unless `--force` is provided.
- When not using `--force`, detect conflicts and report them.
- Keep permissions conservative when writing copied files.
- Prefer deterministic copy behavior and clear summaries.

Copied context may still contain user-authored sensitive information. The
`--dry-run` flow and explicit category selection are part of the user-facing
safety contract, not implementation conveniences.

## 9. Default sync policy

Recommended default:

```bash
cc-use isolate <profile>
cc-use isolate
cc-use isolate auto
```

automatically runs the safe context replication plan before launch.

Manual:

```bash
cc-use import-context <profile>
```

uses the same default safe category set and can be used to preview or re-run
the plan.

Default sync copies only safer recognized categories:

```text
projects
settings-safe
agents
skills
commands
```

if they exist and their native paths are found.

It does not copy by default:

```text
settings-raw
mcp
hooks
plugins
unknown
auth/cache/runtime files
```

`skills` and `commands` are part of the `v0.6` default safe sync set. Their
native paths must be verified during implementation. If a path is not found,
report that category as missing rather than silently dropping it from the
design.

Project history is copied raw by default. If a provider cannot resume imported
Claude history cleanly, users should switch to the compatibility path described
in the sanitization section.

## 10. Overwrite and merge behavior

### Launch-time automatic sync

Launch-time sync should be non-destructive by default:

- create missing target files/directories for default safe categories
- copy missing native context into the isolated profile context
- skip existing targets instead of overwriting them
- report conflicts/skips in a short launch summary
- do not block the Claude Code launch solely because a non-critical context item
  already exists
- never delete unrelated isolated profile data

This keeps automatic isolate startup predictable and allows a user to repair a
category manually, for example by re-importing sanitized history, without the
next launch immediately replacing it with raw history.

### Without `--force`

For manual `import-context`:

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

When `settings-safe` is selected, filtering is a category-specific transform,
not a semantic merge. The implementation should write a deterministic filtered
settings file or skip with a clear reason if the safe field set is not known.

```text
v0.6 should prefer predictable file-level copy semantics over clever merges.
```

## 11. Sanitization

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
- Default isolate sync and default `import-context` copy project history raw.
- Sanitization applies only to project transcript/history files.
- Sanitization must not rewrite settings, agents, skills, commands, MCP config,
  hooks, or plugins.
- Keep existing transcript sanitization logic reusable.

Compatibility path when raw imported history is not accepted by a provider:

```bash
cc-use import-context <profile> --include projects --sanitize-history --force
```

The existing compatibility command remains valid:

```bash
cc-use import-history <profile> --sanitize
```

Because launch-time automatic sync is non-overwriting by default, a manually
sanitized history import should not be immediately replaced by raw history on
the next `cc-use isolate <profile>` launch.

## 12. Dry-run output

Expected manual dry-run behavior:

```text
$ cc-use import-context deepseek --dry-run

Source: ~/.claude
Target: ~/.cc-use/sessions/deepseek

Will copy:
  projects     ~/.claude/projects -> ~/.cc-use/sessions/deepseek/projects
  settings-safe ~/.claude/settings.json -> ~/.cc-use/sessions/deepseek/settings.json
  agents       ~/.claude/agents -> ~/.cc-use/sessions/deepseek/agents
  skills       ~/.claude/skills -> ~/.cc-use/sessions/deepseek/skills
  commands     ~/.claude/commands -> ~/.cc-use/sessions/deepseek/commands

Skipped:
  settings-raw not included by default
  mcp          not included by default
  hooks        not included by default
  plugins      not included by default

Conflicts:
  settings-safe target exists, use --force to overwrite
```

Dry-run should:

- not create directories
- not write files
- report missing categories
- report conflicts
- report skipped high-risk categories
- make it obvious what will be copied
- show the same safe plan that `cc-use isolate <profile>` would run
  automatically before launch

## 13. CLI semantics

Isolate launch behavior:

```text
cc-use isolate [profile] [claude args...]
cc-use isolate auto [claude args...]
```

Rules:

- Resolve the target profile using existing isolate/default/auto semantics.
- Before spawning Claude Code, run the default safe context replication plan for
  the selected profile.
- Do not prompt during automatic launch-time sync.
- Do not import risky categories during launch-time sync.
- Continue launching Claude Code when only non-critical context conflicts are
  reported.
- Keep pass-through Claude args behavior unchanged.

Manual context command:

Suggested options:

```text
cc-use import-context [profile]
  --include <comma-separated categories>
  --include-risky <comma-separated risky categories>
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
- Unknown risky categories should error clearly.
- Risky categories passed through plain `--include` should error clearly and
  suggest `--include-risky`.
- `--all` means all safe recognized non-risky categories.
- `--all` never includes `settings-raw`, `mcp`, `hooks`, `plugins`, or
  `unknown`.
- Risky categories must be requested through `--include-risky`.
- In non-interactive mode, avoid prompts and fail closed.

Risky category examples:

```bash
cc-use import-context <profile> --include-risky mcp,hooks,plugins
cc-use import-context <profile> --include-risky settings-raw
```

Plain `--include` is for safe categories. It must not import risky categories
silently, even when running in an interactive TTY. Avoid prompt-dependent risk
acceptance so scripts, CI, and agent-driven usage remain deterministic.

### Plugin migration boundary

`plugins` should be treated as a high-risk composite integration category, not
as an ordinary directory copy. Plugins can include or reference commands,
agents, hooks, skills, MCP servers, and executable behavior. `v0.6` should not
promise partial semantic plugin migration unless Claude Code's plugin storage
format is verified and test coverage is added for that format.

## 14. Implementation guidance

This section is guidance for later code work only.

Suggested module:

```text
src/importContext.ts
```

Responsibilities:

- parse `import-context` options
- resolve profile/default profile
- discover known native context categories
- classify safe categories separately from risky categories
- filter `settings-safe` to a known non-executable/non-secret field allowlist
- build copy plan
- expose a default safe copy plan reusable by isolate launch
- render dry-run
- execute copy plan
- handle conflicts and force mode
- reuse transcript sanitization where appropriate

`src/cli.ts` isolate launch handling should call the default safe context
replication path after resolving the profile and before spawning Claude Code.
This call should use the non-destructive launch-time sync policy, not the manual
`--force` policy.

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

## 15. Test plan

Future implementation should cover:

- `cc-use isolate <profile>` runs default safe context sync before launch.
- `cc-use isolate` without profile uses the default profile, then syncs that
  profile's isolated context.
- `cc-use isolate auto` syncs the selected profile, not every candidate.
- Launch-time sync copies projects/settings-safe/agents/skills/commands when
  present and recognized.
- Missing skills/commands paths are reported as missing categories rather than
  being removed from the default design.
- Launch-time sync does not copy settings-raw, MCP, hooks, plugins, unknown,
  auth/cache/runtime files.
- Launch-time sync copies project history raw by default.
- Launch-time sync skips existing targets without overwriting and still
  launches.
- A sanitized manual project import is not overwritten by the next launch-time
  automatic sync.
- `import-context <profile> --dry-run` prints planned safe categories and writes
  nothing.
- `import-context` without profile uses default profile.
- Missing default profile errors clearly.
- Missing profile errors clearly.
- Default import copies projects/settings-safe/agents/skills/commands if
  present and recognized.
- `settings-safe` filters raw settings and excludes `env`, `apiKeyHelper`,
  `hooks`, and integration/runtime fields.
- Missing optional categories are reported but not fatal.
- Missing default categories whose native paths are not found are reported as
  missing, including skills and commands.
- Target conflict without `--force` is reported.
- Target conflict with `--force` overwrites selected files.
- `--include projects` copies only projects.
- `--all` includes safe recognized categories only.
- Plain `--include mcp` errors clearly because `mcp` is risky.
- `--include-risky mcp` is accepted and is not included by default.
- `--include-risky settings-raw` is accepted and is not included by default.
- Unknown category errors clearly.
- Symlinks are not followed by default.
- `--sanitize-history` only affects project transcript files.
- Existing `import-history` behavior remains compatible.
- `remove --delete-session` still removes isolated session directories.
- Shared default mode remains unaffected by `import-context`.

## 16. Documentation updates for later implementation

After implementation, update:

- `README.md`
- `README.zh-CN.md`
- `src/help.ts`
- `docs/releases/0.6.0.md` or the final `v0.6` release notes path

README files should explain:

- default shared mode usually does not need import
- isolate mode uses a separate Claude Code context and automatically syncs safe
  native context before launch
- `import-context` can preview, re-run, force, or customize selected native
  context replication into isolate
- raw imported history is the default, and `--sanitize-history` /
  `import-history --sanitize` are compatibility paths for providers that cannot
  resume raw Claude history
- high-risk categories such as settings-raw/MCP/hooks/plugins are opt-in

## 17. Non-goals

`v0.6` does not introduce:

- changing default mode away from with-first
- automatic background synchronization between native and isolated contexts
- bidirectional sync
- live watching of `~/.claude`
- automatic risky-category import during isolate launch
- semantic merging of settings or plugin configs
- automatic secret detection with perfect guarantees
- cloud storage
- worker mode
- external agent orchestration
- mid-run provider switching
- automatic model selection
- removing `import-history`

## 18. Acceptance checklist

- [ ] `docs/specs/v0.6/README.md` exists.
- [ ] `cc-use isolate` automatic safe context sync is defined.
- [ ] `import-context` command design is defined.
- [ ] Safe default categories are defined.
- [ ] Risky categories are opt-in.
- [ ] `settings-safe` is field-filtered and `settings-raw` is risky.
- [ ] `--all` excludes risky categories.
- [ ] Project history defaults to raw copy.
- [ ] Provider compatibility sanitization path is preserved.
- [ ] Dry-run behavior is specified.
- [ ] Overwrite/conflict behavior is specified.
- [ ] `import-history` compatibility is preserved.
- [ ] Tests cover default profile resolution.
- [ ] Tests cover dry-run/no-write behavior.
- [ ] Tests cover conflict and force behavior.
- [ ] Tests cover risky category opt-in.
- [ ] README update scope is identified.
