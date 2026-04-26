# Changelog

All notable changes to **cc-use** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-04-26

First public release. cc-use is a launcher for Claude Code: it spawns one `claude` child process per invocation with provider env vars injected, never touching `~/.claude/`.

### Added

- **CLI launcher** — `cc-use <profile>` spawns `claude` with `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` and a profile-specific `CLAUDE_CONFIG_DIR=~/.cc-use/sessions/<profile>/`. Native `~/.claude/` is never modified.
- **Subcommands** — `init`, `ls`, `doctor`, `default`, `import-history`, plus `--version` / `--help`.
- **Auto-fallback to setup** — `cc-use <name>` walks the user through `init` if the profile doesn't exist (and the name matches a built-in template) or has unfilled placeholder values; then launches Claude Code on success.
- **Built-in templates (7)** — `deepseek`, `volcengine`, `kimi`, `glm`, `qwen`, `openrouter`, `custom`. All ship without API keys.
- **Interactive setup wizard** — pure `node:readline`; hidden API key input; optional default-profile prompt; optional doctor probe at the end.
- **`doctor` probe** — issues a single `POST /v1/messages` (`max_tokens=1`, body `"ping"`) to verify the endpoint speaks the Anthropic Messages protocol; `--no-probe` skips it; `--all` runs the same checks against every configured profile and prints a summary.
- **Per-profile session isolation** — every profile gets its own `~/.cc-use/sessions/<name>/`, so histories and settings stay separate across providers and never leak into `~/.claude/`.
- **`import-history`** — one-way read-only copy from `~/.claude/projects/<encoded-cwd>/` into a profile's session dir (`--all` to copy every project).
- **Default profile** — `cc-use default <name>` sets it; bare `cc-use` and `cc-use [-flag args...]` use the default.
- **Cross-platform** — macOS, Linux, Windows. CI matrix covers Ubuntu / macOS / Windows × Node 18 / 20 / LTS.
- **Zero runtime dependencies** — pure Node built-ins; no `commander` / `yargs` / `inquirer`.
- **Profile file hardening** — provider JSONs are written with mode `0600`.
- **Bilingual docs** — `README.md` (English) + `README.zh-CN.md` (中文).

### Security

- API keys live only on the user's disk under `~/.cc-use/providers/<name>.json` (mode `0600`). cc-use does not phone home, log, or transmit keys anywhere except the configured `ANTHROPIC_BASE_URL`.
- The `doctor` probe sends one minimal request explicitly authored as `"ping"`; pass `--no-probe` to skip.

[0.1.0]: https://github.com/leechen298/cc-use/releases/tag/v0.1.0
