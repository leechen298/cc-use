# cc-use

[![npm version](https://img.shields.io/npm/v/cc-use.svg)](https://www.npmjs.com/package/cc-use)

用第三方 Anthropic 兼容的 provider 启动 Claude Code，不动你的 `~/.claude/`。

## 安装

```bash
npm install -g cc-use
```

要求 Node ≥ 18，且已装 Claude Code（`npm install -g @anthropic-ai/claude-code`）。

## 使用

```bash
cc-use init                # 交互式：选模板、输入 API Key
cc-use deepseek            # 用 DeepSeek 启动 Claude Code
cc-use kimi -p "审查 X"    # 用 Kimi 跑一次性查询

cc-use ls                  # 列已配置的 profile
cc-use doctor              # 校验默认 profile
cc-use --help              # 所有命令
```

profile 配置存在 `~/.cc-use/providers/<name>.json`（chmod 600）。每个 profile 用独立的 `CLAUDE_CONFIG_DIR=~/.cc-use/sessions/<name>/`，原生 `~/.claude/` 永远不读不写。

## 内置 provider

| 模板          | 提供商                  | 端点                                          |
|---------------|-------------------------|-----------------------------------------------|
| `deepseek`    | DeepSeek V4             | `api.deepseek.com/anthropic`                  |
| `volcengine`  | 火山方舟（豆包代码模型） | `ark.cn-beijing.volces.com/api/coding`        |
| `kimi`        | Moonshot Kimi K2        | `api.moonshot.ai/anthropic`                   |
| `glm`         | 智谱 GLM 4.6+           | `open.bigmodel.cn/api/anthropic`              |
| `qwen`        | 阿里百炼（DashScope）   | `dashscope.aliyuncs.com/apps/anthropic`       |
| `openrouter`  | OpenRouter              | `openrouter.ai/api`                           |
| `custom`      | 自定义（你来填）        | （手动）                                      |

模板里都不带 API Key，运行 `cc-use init` 时再输入。

## 开发

```bash
git clone https://github.com/leechen298/cc-use.git
cd cc-use
pnpm install        # npm/yarn 也能用；仓库只提交 pnpm-lock.yaml
pnpm build
pnpm test
```

## License

MIT © leechen298
