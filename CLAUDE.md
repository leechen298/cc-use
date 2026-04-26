# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

pnpm is preferred (only `pnpm-lock.yaml` is committed; npm/yarn lockfiles are gitignored to avoid drift). npm and yarn still work.

```bash
pnpm install
pnpm build        # tsc → dist/ (clean rebuild). Required before running ./dist/cli.js.
pnpm test         # tsx --test test/*.test.ts
```

Run a single test file or filter by name:

```bash
pnpm exec tsx --test test/profile.test.ts
pnpm exec tsx --test --test-name-pattern='placeholder' test/profile.test.ts
```

CI runs `pnpm install --frozen-lockfile && pnpm build && pnpm test` on Ubuntu/macOS/Windows × Node 18/20/lts/* (see `.github/workflows/ci.yml`). It uses pnpm to verify the canonical `pnpm-lock.yaml` — keep the code cross-platform (see the `shell:` toggle in `src/exec.ts`).

The published binary is `dist/cli.js` (`bin.cc-use` in package.json). After `pnpm build`, invoke as `node dist/cli.js …` for end-to-end testing.

## Architecture

cc-use is a **launcher**, not a switcher or proxy. Each invocation injects env vars into one `claude` child process and exits. The hard invariant: **never write to `~/.claude/`** — that's the native Claude Code subscription's territory.

### Request flow (one launch)

`src/cli.ts` parses argv → resolves a profile name → `src/profile.ts` loads/validates `~/.cc-use/providers/<name>.json` → `src/exec.ts` spawns `claude` with the profile's env merged into `process.env` plus `CLAUDE_CONFIG_DIR=~/.cc-use/sessions/<name>/`. SIGINT/SIGTERM/SIGHUP are forwarded; exit code is the child's (or `128 + signal-code` on signal exit).

The first positional arg drives dispatch: `init`/`ls`/`doctor`/`default`/`import-history` are subcommands; anything else is a profile name. A leading `-` or `--` means "use default profile, pass everything to claude". `findPlaceholders` (in `profile.ts`) intercepts unfinished profiles at launch time and triggers `runInit({ force: true })`.

### Storage layout (single source of truth: `src/paths.ts`)

```
~/.cc-use/
├── providers/<name>.json    profile configs, mode 0600
├── config.json              { "default": "<profile>" }
└── sessions/<name>/         CLAUDE_CONFIG_DIR for that profile
```

`CC_USE_DIR` env var overrides the root — `test/profile.test.ts` uses this to isolate state in a tmpdir. Always read paths through `paths.ts`, never hard-code `~/.cc-use/`.

### Templates vs. profiles

`templates/*.json` ships read-only seed data inside the package; profiles are user-editable copies in `~/.cc-use/providers/`. `src/templates.ts` resolves `TEMPLATES_DIR` as `<dist>/../templates` — this works because `dist/` and `templates/` sit as siblings inside the published package (both listed in `package.json` `files`). If you reorganize the build output, update that join.

Adding a template requires native Anthropic Messages API support and a passing `cc-use doctor` — see `docs/governance.md`.

### Cross-cutting constraints

- **Reserved names** (`profile.ts:RESERVED_NAMES`): `init`, `ls`, `list`, `doctor`, `default`, `help`, `version`, `import-history`. Profile *and* template names must not collide. The CLI dispatcher and `validateProfileName` both depend on this set.
- **Required env keys** in every profile: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`. `validateEnv` throws otherwise. `looksLikePlaceholder` recognizes `<...>`, empty, and `YOUR_API_KEY` — keep template defaults using `<PLACEHOLDER>` form so the placeholder detection works.
- **Profile files are written with mode `0600`** (in `init.ts`). Don't relax this.
- **Doctor probe**: `POST <base_url>/v1/messages` with `max_tokens=1`, shape-checks `{type:"message", content:[…]}`. Special-cases 401/403/404. Skip with `--no-probe`.
- **Import history is one-way**: copies `~/.claude/projects/<encoded-cwd>/` (path separators → dashes, see `encodeCwdToProjectFolder`) into the profile's session dir. Never reads-then-writes back to `~/.claude/`.

## Conventions

- TypeScript strict mode, `NodeNext` modules, ES2022. Imports use `.js` extensions (NodeNext requirement) even though sources are `.ts`.
- No runtime dependencies — only Node built-ins. New deps need a strong justification given the "small launcher" goal stated in `README.md`.
- Errors surface as `cc-use: <message>` to stderr with non-zero exit; the top-level `main().catch` in `cli.ts` already wraps thrown errors this way.
