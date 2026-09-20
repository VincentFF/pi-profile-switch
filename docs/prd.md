# pi-profile-switch 产品需求

## 问题

Pi 的资源是全局发现的：装了哪些 skills、extensions、MCP servers 和 tools，一个会话里就全部可用。资源变多之后，三件事同时变糟。

- 上下文被占满。每个 skill 的名称与 description 常驻 system prompt，与当前任务无关的 skill 同样占位。
- 危险能力常驻。文件写入、命令执行、外部系统的写权限一旦装上就一直在工具列表里。
- 边界只能靠提示词。"只读复核"和"全量实现"要切换的是能力集合本身，提示词约束不了工具是否存在。

profile 把资源选择变成显式、可切换的对象，并可选地附带声明 model、thinking level 与额外的 system prompt 指令。它不复制资源：一个 `SKILL.md`、extension 或 MCP server 只有一份实现，多个 profile 引用同一份。

```text
SkillRegistry
  git-commit ──► ~/.pi/agent/skills/git-commit/SKILL.md
       ▲                 ▲
       │                 │
  review profile     implement profile
```

## 使用场景

- **按任务切换**：`review` 只带复核类 skill 与只读工具，`implement` 带完整编辑与测试能力。
- **按项目切换**：在项目目录内使用项目专属 skill 与 MCP server，离开项目后回到全局能力。
- **按权限收窄**：只读问答、受限环境、对外演示时用 profile 收窄能力面。
- **共享实现**：修好一个 skill，所有引用它的 profile 在下一次启动或 reload 得到新内容。

## 目标用户

主要用户是已用 Pi 管理多个项目、装了多个 skills、extensions 与 MCP server 的个人开发者。

次要用户是需要给 agent 划定能力边界的场景，例如只读复核、受限环境。

二者都以熟悉 Pi 的资源发现与 settings 概念为前提。profile 引用的是 Pi 自己的资源名，不清楚 Pi 里有哪些资源就无法定义 profile。

## 设计原则

### Pi 兼容优先

profile 只改变它显式声明控制的东西，其余一切走 Pi 原生机制。

原因是用户对 Pi 的行为预期不应因为装了一个 profile 包而改变，其他 Pi package 也不应被打断。代价是 profile 无法"顺手"修正 Pi 的行为：遇到 Pi 的限制只能报告，不能绕过。

### 与 Pi 一致的极简

配置面尽可能小：优先发现而非注册，优先默认值而非必填字段，优先可行动的错误而非静默失败。

原因是 Pi 本身极简，profile 层不该成为新的学习负担。代价是有些更顺手的方案会被拒绝——凡是需要额外配置文件或注册步骤的，即使更好用也不采用。

## 产品目标

- 用命名 profile 组织 Pi 的工作方式，覆盖按任务、按项目、按权限三种切换动机。
- 在同一个运行中的 Pi 会话内切换 profile，不重启进程。
- 让 profile 引用既有资源而不复制，使资源维护只发生在一处。
- 让项目级定义覆盖全局定义，离开项目后自动回到全局定义。
- 让未被 profile 声明控制的 Pi 行为保持原样。
- 安装后不需要先写配置就能用上 profile 带来的能力隔离。

## 非目标

- **不做 profile 继承与组合。** 没有 `extends`，没有深度合并，没有数组追加；同名 profile 是完整替换。继承一旦被用户依赖就难以回头，而定义自包含才能不解析父链就读懂。
- **不复制资源。** profile 只按名字引用 skill、extension、MCP server 与 tool，从不保存副本。复制会把实现分叉成 N 份，并违背用户直接拥有自己资源的前提。
- **不做 extension 依赖图。** 没有依赖声明、依赖闭包或常驻 extension 概念。Pi 本身没有这些概念，在 profile 层引入会把切换器变成半个包管理器。
- **不做包管理器。** 不安装、不升级、不卸载 extension，只发现已安装的东西并从中筛选。
- **不管理 MCP 连接参数与凭证。** server 地址、启动命令、OAuth 与 token 全部留在 `pi-mcp-adapter` 的配置里；profile 只声明启用哪些 server。
- **不改 Pi 默认行为。** 未被 profile 声明控制的设置、发现与会话行为一律按 Pi 原生规则工作。

## 成功标准

1. 用指定 profile 启动时，第一个 agent turn 只看到该 profile 选中的资源，未被选中的资源不可见。
2. 切换 profile 不重启 Pi 进程，当前 session 的 sessionId 与历史保持不变。
3. 修改一个被多个 profile 引用的 skill 或 extension 后，这些 profile 在下一次启动或 reload 得到新内容，无需改动任何 profile 定义。
4. profile 未声明 model、thinking level 或 instructions 时，激活后 Pi 的模型、thinking level 与 system prompt 与原生启动一致。
5. 未安装 `pi-mcp-adapter` 时，不含 MCP server 声明的 profile 全部功能可用。
6. profile 激活失败时不留下半激活状态，并给出可行动的原因。

## 关联文档

[CONTEXT.md](../CONTEXT.md) · [openspec/specs/](../openspec/specs/) · [架构](architecture/overview.md) · [ADR](adr/) · [手动验收](acceptance.md) · [README](../README.md)
