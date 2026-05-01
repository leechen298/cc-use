# 01_requirement.md — cc-use v0.1 MVP

> **Stage**: v2.1 锁定中（v2 已 sign-off，追加 default profile 特性）
> **Owner**: leechen298
> **Status**: v2.1 Locked-Pending-Signoff
> **History**: v1 → v2 锁定改名 cc-use + TS + Win + 隔离三件套（已 sign-off）→ v2.1 追加 default profile（`cc-use` 直接启动默认 provider）
> **包名 / 命令名 / 仓库名**: `cc-use`（npm 上验证未被占）

---

## Background

本地已有 zsh 脚本 `~/.claude-provider/claude-provider`（120 行 zsh + 30 行嵌入 Python），按 profile 注入第三方 Anthropic 兼容 provider 的环境变量后启动 `claude` CLI，用于"主用官方订阅、按需借用第三方做代码审查或对比"等场景。

现要把这个工具打包为 npm 全局包 **`cc-use`** 开源发布，让其他 Claude Code 用户能 `npm i -g cc-use` 后跨 mac/linux/win 直接接入第三方 provider（DeepSeek、Kimi、GLM、Qwen、火山方舟、OpenRouter 等）。

## 定位（重要 —— 区分于 cc-switch 等竞品）

cc-use 是 **Launcher（启动器）**，不是 **Switcher（切换器）**：

- **Switcher**（如 farion1231/cc-switch、SaladDay/cc-switch-cli）：改写 `~/.claude/settings.json`，全局持久切换，所有终端同步生效
- **Launcher**（cc-use）：单次启动注入 env，默认隔离会话；`cc-use with <p>` 显式复用原生 `~/.claude/`（共享上下文），`cc-use isolate <p>` 用独立会话目录；不同终端窗口可并行不同 provider

对照类比：cc-switch 之于 nvm，cc-use 之于 npx。

目标用户：**主用官方订阅 + 偶尔借用第三方 + 需要并行多 provider + 远程 SSH/CI/Docker 等无 GUI 场景**。

## Goals

- **G1** `npm i -g cc-use` 一行安装，跨 macOS / Linux / **Windows** 工作
- **G2** 命令行行为对齐现有本地 zsh 脚本（profile 路径、字段校验、退出码、stdio 透传）
- **G3** 内置 6 个开箱即用的 provider 模板 + 1 个 custom 空白模板，社区 PR 驱动后续扩展
- **G4** 首次安装 / 首次使用时自动弹交互向导（输入 API Key → 自动配置 → 自动探活）
- **G5** **保护原生 Claude Code**：不写 shell rc；默认隔离会话（`isolate` / 裸 profile）；`with` 模式显式共享 `~/.claude/`
- **G6** 双语文档（README.md + README.zh-CN.md）

## In Scope

- **CLI 子命令**：`cc-use <profile> [claude args...]`、`cc-use [claude args...]`（用默认）、`ls`、`init [template]`、`doctor [profile]`、**`default [profile]`**（设置/查看默认 profile）、`with <profile>`、`isolate <profile>`
- **Profile 路径解析**：`$CC_USE_DIR > ~/.cc-use/providers/<name>.json`
- **会话目录**：`cc-use isolate <p>` / `cc-use <p>` 设 `CLAUDE_CONFIG_DIR=.../sessions/<profile>` 完全隔离；`cc-use with <p>` 设 `CLAUDE_CONFIG_DIR=~/.claude/` 共享原生上下文
- **内置模板**：deepseek、volcengine、kimi、glm、qwen、openrouter、custom（共 7）
- **交互向导**：首次执行 `cc-use`（无参 + profile 目录空）→ 自动进 setup；`cc-use init <template>` 直接进 setup
- **doctor 探活**：默认发一次 `POST <base_url>/v1/messages`（max_tokens=1，body "ping"）验证端点活性 + Anthropic 协议合规；`--no-probe` 关闭
- **文档**：README.md / README.zh-CN.md / docs/provider-spec.md（profile JSON schema 契约）/ docs/governance.md（模板进入仓库标准）/ docs/security.md（key 管理约定）
- **测试**：`node --test`（编译后），覆盖 profile 加载/校验/隔离逻辑全分支
- **CI**：GitHub Actions on macOS + Ubuntu + **Windows** × Node 18 / 20 / LTS

## Out of Scope（延期到 0.2+）

- 系统密钥库集成（macOS Keychain / Windows Credential Manager / libsecret）
- 第三方模板插件机制（从 npm 拉远程模板）
- qwen-intl / bailian-coding / poe / ollama / siliconflow / minimax / yi 等模板（0.2 批量补，社区 PR 驱动）
- claude-code-router 那种"OpenAI 协议转换代理"——不在 cc-use 范围
- 自动更新 / telemetry
- GUI

## 实现技术栈（v2 锁定）

- **语言**：**TypeScript**（源码 `src/*.ts`），编译产物 `dist/*.js + *.d.ts` 发布到 npm
- **运行时**：Node ≥ 18（内置 fetch / readline / spawn / JSON / `node:test`）
- **运行时依赖**：**0 个**（`dependencies: {}`）
- **devDependencies**：`typescript`、`@types/node`（仅打包时用）
- **模块系统**：纯 ESM（`"type": "module"`）
- **构建**：`tsc` 单步，无 bundler
- **License**：MIT
- **平台**：macOS / Linux / Windows 原生（不依赖 zsh、不依赖 python）

## Acceptance Criteria

| ID | 条件 | 期望 |
|----|------|------|
| **AC1** | `npm i -g cc-use` 后执行 `cc-use --version` | 输出 package.json 中的版本号 |
| **AC2** | `cc-use deepseek -p "hi"` 行为对齐原 zsh 脚本 | env 注入正确、claude 子进程继承 stdio/TTY、退出码透传 |
| **AC3** | `cc-use deepseek` 运行期间按 Ctrl-C | 子进程收到 SIGINT 并干净退出；父进程不悬挂 |
| **AC4** | profile 缺 `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_BASE_URL` | 非 0 退出 + stderr 明确指出缺哪个字段 |
| **AC5** | profile 含非法 key（违反 `^[A-Za-z_][A-Za-z0-9_]*$`） | 非 0 退出 + stderr 给出违例 key 名 |
| **AC6** | profile 中 token 形如 `<XXX>` 占位符 | `cc-use doctor <profile>` 给出 "looks like placeholder" 警告 |
| **AC7** | `cc-use ls` | 列出 profile 目录所有 `.json`，排除 `*.example.json` 与 `*.json.example` |
| **AC9** | `cc-use init deepseek` | profile 目录创建 `deepseek.json`；若已存在则报错不覆盖（除非 `--force`） |
| **AC10** | `package.json` | `dependencies: {}` —— 零运行时依赖 |
| **AC11** | CI | macOS + Ubuntu + **Windows** × Node 18 / 20 / LTS 全绿 |
| **AC12** | profile JSON 中 value 为 `bool` | `true → "1"`、`false → "0"`（与原脚本一致） |
| **AC13** | `cc-use init <template>` 默认进交互模式 | 显示模板说明 → **隐藏回显**输入 API Key → 列默认模型让用户回车采纳或改 → 写入 JSON → 自动跑 doctor 反馈 |
| **AC14** | `cc-use init --non-interactive --token <key>` | 无 TTY 也能跑，CI 友好 |
| **AC15** | 首次执行 `cc-use`（profile 目录为空） | 打印欢迎语 + 列出内置模板 + 自动进入交互向导 |
| **AC16** | `cc-use doctor <profile>` | 默认联网发最小 messages 请求（消耗 ≤1 token），告知用户即将探活，反馈：✅ 200 + Anthropic shape / ⚠ 401 但 shape 对 / ❌ 端点错；`--no-probe` 跳过 |
| **AC17** | `cc-use isolate <p>` / `cc-use <p>` 不读写 `~/.claude/` | 官方订阅登录态完整保留；`cc-use with <p>` 显式共享 `~/.claude/` |
| **AC18** | `cc-use isolate <p>` / `cc-use <p>` 使用独立 `CLAUDE_CONFIG_DIR`（`~/.cc-use/sessions/<profile>`） | 不同 profile 的会话历史不混；`cc-use with <p>` 复用 `~/.claude/` |
| **AC19** | cc-use 永远不写用户 shell rc 文件（`.zshrc` / `.bashrc` / PowerShell profile）；不导出全局环境变量 | env 仅作用于当前 spawn 的 claude 子进程 |
| **AC20** | Windows 上 `cc-use deepseek` | 与 mac/linux 行为等价（spawn claude.cmd 或 claude.exe，env 注入有效） |
| **AC21** | `cc-use default <profile>` 设置默认；`cc-use default` 查看当前默认 | 写入 `<config-dir>/config.json` 的 `default` 字段；查看时打印当前值或 "no default" |
| **AC22** | 已设默认后执行 `cc-use`（无任何参数） | 等价于 `cc-use <default-profile>`，直接启动 Claude Code |
| **AC23** | 已设默认后执行 `cc-use [claude args...]`（首参以 `-` 开头） | 用默认 profile + 全部 argv 透传给 claude（如 `cc-use -p "hi"` 走默认 + 透传 `-p "hi"`） |
| **AC24** | 未设默认且 `cc-use` 无参数运行 | 进入交互向导（同 AC15） |
| **AC25** | `cc-use init <template>` 完成后，若用户当前**没有**默认 profile | 自动询问"是否设为默认？"（Y/n） |
| **AC26** | profile 名禁止与保留子命令冲突（init/ls/doctor/default/help/version/import-history/with/isolate） | init / 重命名时校验，违例报错 |
| **AC27** | 配置/会话根目录统一为 `~/.cc-use/`（Win: `%USERPROFILE%\.cc-use\`） | 结构: `providers/<name>.json` + `sessions/<name>/`（CLAUDE_CONFIG_DIR 目标）+ `config.json`（默认 profile） |
| **AC28** | `cc-use import-history [profile] [--all]` | 单向只读拷贝 `~/.claude/projects/<cwd>/` 到当前 profile 的 sessions 目录；不修改原 `~/.claude/`；`--all` 拷所有项目 |

## Constraints

- 0 运行时依赖（不引 commander / yargs / inquirer）
- 纯 ESM、Node ≥ 18
- TypeScript 源码 + 编译后 JS 发布（`files: ["dist/", "templates/", "README*.md", "LICENSE"]`）
- License: MIT
- 名字 `cc-use` —— npm 已核未占（2026-04-26）；GitHub 同名小项目存在但定位不同（配置模板 vs CLI 启动器）
- 不内嵌任何真实 API key

## Risks & Rollout

| ID | 风险 | 缓解 |
|----|------|------|
| **R1** | 原脚本 `exec env ... claude`（进程替换）→ Node 必须 spawn 子进程，多一层进程 | 信号转发（SIGINT/TERM/HUP）+ stdio inherit + 退出码透传；README 写明 |
| **R2** | npm 名 `cc-use` 被抢注的小概率 | 发布前再 `npm view cc-use` 复核；若被占退到 `@leechen298/cc-use` |
| **R3** | DeepSeek V4 / Kimi / GLM 端点或模型名变化 | docs/governance.md 注明模板维护责任；CHANGELOG.md 记录每次模板变更 |
| **R4** | Windows 上 `claude` 二进制是 `.cmd` 包装，spawn 行为与 Unix 不同 | spawn 时根据平台选 `claude.cmd` / `claude`；Win CI 全程跑通验证 |
| **R5** | 51k★ cc-switch 已占 GUI 切换器位 | cc-use 主打 launcher 差异化（临时调用 / 不污染 / 多 profile 并行 / 无 GUI 场景），README 直接对比说明 |

**发布节奏**：

- **0.1.0** — 核心 CLI + 7 模板 + 交互向导 + doctor 探活 + 三平台 CI + 双语 README
- **0.2** — 0.1 用户反馈驱动；社区 PR 进新模板（qwen-intl / bailian-coding / poe / ollama 等）
- **0.3** — 评估第三方模板插件机制

---

## Q1–Q11 决策快照

| Q | 决策 |
|---|---|
| Q1 DoD 完整性 | AC1–AC20，Owner 负责完整 |
| Q2 Windows | ✅ 原生支持，纳入 In Scope + CI |
| Q3 首发模板 | deepseek / volcengine / kimi / glm / qwen / openrouter / custom（共 7） |
| Q4 名字 | **cc-use**；仓库重命名 cc-provider → cc-use |
| Q5 仓库可见性 | 公开 MIT 不变 |
| Q6 进程模型 | spawn 不 exec，README 写明差异；不复用原 zsh 代码（Win 不支持）；TS 重写 |
| Q7 Key 输入 | 隐藏回显（TTY 检测；CI 自动 fallback 明文 + 警告） |
| Q8 init 模型选择 | 列默认值，回车采纳，可手动改 |
| Q9 doctor 探活 | 默认联网，告知用户，反馈结果；`--no-probe` 关闭 |
| Q10 OpenRouter 默认模型 | `anthropic/claude-sonnet-4.6`（OpenRouter 主打"买 Claude 官方模型"，模板说明写明） |
| Q11 首次安装 | 弹交互向导 |

---

## Sign-off

- [ ] 用户在本会话回复"v2 sign-off"或同等确认
- [ ] AC1–AC20 锁定
- [ ] 进入 Stage 2: Innovate（产出 02_design.md，3 个关键设计点各 ≥2 套备选 + Pros/Cons）

签字后此文件冻结，后续变动追加到 `CHANGELOG-spec.md` 而非直接改本文件。
