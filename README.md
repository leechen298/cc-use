# cc-use

[![npm version](https://img.shields.io/npm/v/cc-use.svg)](https://www.npmjs.com/package/cc-use)

Launch Claude Code with DeepSeek, Kimi, Qwen, GLM, MiniMax, Volcengine ARK, BytePlus ModelArk, OpenRouter — Chinese providers and their international endpoints both included. `cc-use with` shares your native `~/.claude/` context; `cc-use isolate` for explicit isolated sessions.

![cc-use demo](docs/assets/demo.gif)

## Install

```bash
npm install -g cc-use
```

Requires Node ≥ 18 and Claude Code (`npm install -g @anthropic-ai/claude-code`). Tested on macOS and Linux; Windows is best-effort (CI builds + tests on Windows, but interactive flows aren't manually verified there yet).

## Usage

```bash
cc-use init                       # interactive setup: pick template, paste API key
cc-use with deepseek              # launch via DeepSeek, reuse native ~/.claude (recommended daily use)
cc-use deepseek -p "review X"     # one-shot query (extra args pass through to claude)
cc-use isolate deepseek           # launch via DeepSeek with explicit isolated session
cc-use deepseek                   # launch via DeepSeek (isolated session, compatible shorthand)
cc-use                            # launch with the default profile (isolated session)

cc-use ls                         # list configured profiles
cc-use default [profile]          # show or set the default profile
cc-use doctor [profile]           # validate profile (--all checks all)
cc-use import-history [profile]   # copy current project's ~/.claude/ history into profile
cc-use --help                     # full command reference
```

`[profile]` is optional — omit to use the default profile.

`import-history` copies the original transcript by default. For DeepSeek or other providers that cannot resume Claude thinking/tool-call history, add `--sanitize`; this keeps readable transcript text, removes Claude thinking blocks, and converts historical tool/media/result blocks into plain text markers before copying into `~/.cc-use/sessions/<profile>/`.

Profile configs live in `~/.cc-use/providers/<name>.json` (chmod 600). `cc-use with <profile>` is the recommended daily driver — it shares your native `~/.claude/` context (history, skills, projects). Use `cc-use isolate <profile>` (or the shorthand `cc-use <profile>`) for an isolated `CLAUDE_CONFIG_DIR=~/.cc-use/sessions/<name>/`.

## Built-in providers

| Template      | Provider                          | Endpoint                                      |
|---------------|-----------------------------------|-----------------------------------------------|
| `deepseek`    | DeepSeek V4 (direct)              | `api.deepseek.com/anthropic`                  |
| `kimi`        | Moonshot Kimi K2.6 (direct, CN)   | `api.moonshot.cn/anthropic`                   |
| `kimi-plan`   | Moonshot Kimi Coding Plan         | `api.kimi.com/coding/`                        |
| `glm`         | Zhipu GLM 5.1 (CN)                | `open.bigmodel.cn/api/anthropic`              |
| `glm-intl`    | Zhipu GLM 5.1 (international)     | `api.z.ai/api/anthropic`                      |
| `qwen`        | Aliyun DashScope Qwen (direct, CN)| `dashscope.aliyuncs.com/apps/anthropic`       |
| `qwen-plan`   | Aliyun Bailian Token Plan (CN)    | `token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic` |
| `qwen-intl`   | Aliyun Model Studio (international)| `dashscope-intl.aliyuncs.com/apps/anthropic`  |
| `minimax`     | MiniMax M2.7 (CN)                 | `api.minimaxi.com/anthropic`                  |
| `minimax-intl`| MiniMax M2.7 (international)      | `api.minimax.io/anthropic`                    |
| `volcengine-plan` | Volcengine ARK Coding Plan (CN) | `ark.cn-beijing.volces.com/api/coding`     |
| `byteplus-plan` | BytePlus ModelArk Coding Plan (international, same product as Volcengine ARK under ByteDance's overseas brand) | `ark.ap-southeast.bytepluses.com/api/coding` |
| `mimo`        | Xiaomi MiMo V2.5 Pro (direct)     | `api.xiaomimimo.com/anthropic`                |
| `mimo-plan`   | Xiaomi MiMo Token Plan (CN)       | `token-plan-cn.xiaomimimo.com/anthropic`      |
| `openrouter`  | OpenRouter                        | `openrouter.ai/api`                           |
| `custom`      | Bring your own                    | (you fill in)                                 |

The `-plan` variants point at the provider's subscription endpoint (Coding Plan / Token Plan) — usually the Anthropic-compatible path the provider explicitly documents for Claude Code, with subscription-flat billing instead of per-token.

### MiMo: CN vs international

- **`mimo`** — uses the public pay-as-you-go Anthropic endpoint (`api.xiaomimimo.com/anthropic`). The public docs currently expose this single endpoint; billing differs by account region, not by template.
- **`mimo-plan`** — uses the CN Token Plan endpoint (`token-plan-cn.xiaomimimo.com/anthropic`). For international Token Plan users (Singapore / Europe), the endpoint is not a public constant — check your subscription console for the exact Anthropic URL, then `cc-use init mimo-plan` and manually edit the generated profile's `ANTHROPIC_BASE_URL`.

Templates ship without API keys — set yours via `cc-use init`.

## Development

```bash
git clone https://github.com/leechen298/cc-use.git
cd cc-use
pnpm install        # npm/yarn also work; only pnpm-lock.yaml is committed
pnpm build
pnpm test
```

## License

MIT © leechen298
