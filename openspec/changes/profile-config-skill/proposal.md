# Proposal

## Why

创建、修改 profile 目前只有两条路：手写 JSON，或会话内的 `/profile create` 表单向导。用户更自然的表达是模糊需求（「帮我配个做 code review 的 profile」），这需要一条对话式的配置路径：agent 按需求澄清、发现可引用资源、落出正确的 profile 文件。随包分发一个 `profile-config` skill 即可提供这条路径，无需新增任何运行时代码。

依赖 `per-profile-config-files`：skill 指导 agent 直接读写 `profiles/<name>.json` 单文件，正是该 change 引入的目录格式使「skill 直接写文件」成为可能。

## What Changes

- 包内新增 `skills/profile-config/SKILL.md`：指导 agent 根据用户的模糊或明确需求创建、修改、删除 profile。内容覆盖：名字字符集约束、裸定义格式与字段语义、全局（`~/.pi-profile-switch/profiles/`）vs 项目（`<projectDir>/.pi/profiles/`）落点、可引用资源的发现位置（`~/.pi/agent/settings.json`、`~/.agents/skills/`、已安装 packages、`mcp.json`）。
- 安装分发：`postinstall` 把该 skill 写入用户 agentDir 的 `skills/profile-config/`。升级时 SHALL 始终覆写（内容为 package 所有，跟随版本演进）；卸载后可能残留，接受不清理。
- skill 是普通用户级资源，无运行时特判：default profile 与原生 pi 直接可用；命名 profile 需在 `skills` 中声明它才可用。
- 创作时默认注入：skill 指导 agent 生成新 profile 时，若该 profile 声明了 `skills` 数组，则默认包含 `"profile-config"`，除非用户明确要求不包含；profile 未声明 `skills` 时不动作（未声明即不收窄）。
- skill 内容需处理两个边界：无 `write` 工具的窄 profile 中退化为输出 JSON 建议手动保存；项目未受信任的会话中写入项目 scope 前提示 `/trust` + 重启。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `profile-catalog`：新增 requirement「安装分发 profile-config skill」，与「安装播种 starter profile」并列描述安装期的分发行为。

## Impact

- 代码：`bin/postinstall.js`（分发逻辑）、`skills/profile-config/SKILL.md`（新）、`package.json`（`files` 加 `skills`）。
- 测试：postinstall 分发与覆写用例。
- 文档：README 提及该 skill。

## Doc Impact

- `docs/prd.md`：none——skill 是配置路径的补充，不改变产品定位。
- `docs/architecture/overview.md`：none——无新机制，分发复用 postinstall 既有模式。
- `CONTEXT.md`：none——无新术语。
- `docs/adr/`：none——分发复用 postinstall 既有模式，过滤模型无新规则。已否方案记录于此：经 Pi package 发现机制暴露 skill（违反「无运行时特判」，且与 ADR-0008 的委托方向相悖）；生成 settings 时注入 skill（同上，且声明即控制的过滤模型被破坏）。均不构成难以撤销的决策。
