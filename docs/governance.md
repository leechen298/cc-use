# Template Governance

> **Audience: contributors who want to add a new built-in provider template (`templates/<name>.json`).** End users do not need to read this — they just run `cc-use init` and pick from the existing templates.

`templates/` ships built-in provider configurations. Adding a new template requires:

## Acceptance criteria for a new `templates/<name>.json`

1. **Official documentation link** in the PR body proving the provider exposes a **native Anthropic Messages API endpoint** (not OpenAI-compatible). Link to vendor docs, not blog posts.
2. **Endpoint URL** uses HTTPS.
3. **No real API keys** — token field must be a `<PLACEHOLDER>` like `<DEEPSEEK_API_KEY>`.
4. **Schema**:
   ```json
   {
     "description": "<one-line description>",
     "defaults": {
       "ANTHROPIC_BASE_URL": "https://...",
       "ANTHROPIC_AUTH_TOKEN": "<...>",
       "ANTHROPIC_MODEL": "<vendor-model-id>"
     }
   }
   ```
5. **Tested locally** by submitter — paste output of `cc-use doctor <name>` showing OK in the PR.

## Naming

- Lowercase letters, digits, dash. No leading dash.
- No collisions with reserved subcommand names (`init`, `ls`, `doctor`, `default`, `help`, `version`, `import-history`, `remove`).

## Maintenance

When a vendor changes endpoint URL or default model, file an issue with the new official link. Templates are versioned through git history; major changes go in `CHANGELOG.md`.
