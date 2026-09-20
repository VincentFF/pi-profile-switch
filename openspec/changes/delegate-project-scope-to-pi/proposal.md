# Proposal

## Why

项目级资源（`.pi/skills`、`.pi/extensions`、ancestor `.agents/skills`、`.pi/prompts`、`.pi/themes`、`.pi/settings.json`）现在由 pi-profile 用 Pi 的 trust 闸门整体压制：生成 settings 置 `defaultProjectTrust: "never"`，命名 profile 的 instance 不链接 `trust.json`。这带来两个问题：

1. 隔离面比定位宽。profile 只声明 skills、extensions、tools、mcps，但闸门是"全部项目级资源"，项目级 prompts/themes/settings 也被一并屏蔽。
2. 会话内切换改不回来。Pi 的信任判定按进程、按 cwd 只做一次，`session.reload()` 保留 `SettingsManager.projectTrusted` 且不重跑判定。因此从命名 profile 切回 `default` 后，`.pi/skills` 里的 skill（例如 openspec 的 skills）仍然不可见，必须重启进程。

项目级资源属于项目，不属于 profile。profile 的收窄作用面应限定在用户级资源；项目级资源由 Pi 自己的 trust 判定决定可见性。这条边界同时消掉上面两个问题：闸门不再由 pi-profile 开关，切换也就没有"要改的 flag"。

## What Changes

- instance 的 `trust.json` 无条件作为指向真实 agentDir 的符号链接存在（目标不存在时同样建立，与 `auth.json` 同类）。命名 profile 不再删除该链接。
- 启动器把记录的一次性信任输入（`--approve` / `--no-approve`）转发给任何 profile 的 Pi 进程；先前只有 `default` 转发，命名 profile 下会出现"启动器判不受信任、Pi 仍按已存储决定放行"的分歧。
- Generated settings 不再表达项目级收窄：不再为项目级 skill 写 `-<路径>` 排除项，也不再把选中的项目级 skill/extension 写成附加路径。项目级资源由 Pi 原生发现。
- Generated settings 不再合并项目 `.pi/settings.json`，随之移除"剥除项目 `packages`"逻辑。该合并与剥除是闸门关闭时期的替代品；闸门打开后它反而会让项目 packages 被装进全局 npm 根（启动副作用），必须去掉。项目 packages 从此走 Pi 原生路径，装在项目 `.pi/npm` 下。
- **BREAKING**（产品承诺）：profile 不能隐藏项目级资源。受信任项目的 `.pi/skills`、`.pi/extensions`、ancestor `.agents/skills` 在任何 profile 下都可见，未选中的项目资源不再被排除。
- 受信任项目的资源仍留在解析词汇表内：profile 引用项目级 skill/extension 时照旧解析成功，不产生"未匹配"失败或零匹配警告；只是这类选择不再写入 Generated settings。
- `mcps` 的收窄面收窄到用户来源：项目 `.mcp.json` / `.pi/mcp.json` 定义的 server 不再被标记禁用。
- 不做改动：tools 的严格白名单（项目级不存在工具发现）、命名 profile 不发起信任询问这一既有行为（没有已存储决定时命名 profile 的 instance 仍是 `defaultProjectTrust: "never"`）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `launcher`: 「项目信任守门」改为只守门 pi-profile 自己的项目文件与项目 MCP 配置读取，并说明项目级资源的可见性归 Pi；「instance 目录契约」要求 `trust.json` 在每种 profile 下都是链接；「子进程启动」的信任 flag 转发覆盖所有 profile；「instance 运行时状态 seed」的文件类 seed 新增 `trust.json`。
- `resource-reference`: 「Skill 引用解析」与「Extension 引用解析」补充项目级资源的参与语义——受信任项目的项目级资源可解析但不可收窄；`mcps` 的收窄不作用于项目来源的 server。
- `in-session-switch`: 「会话内切换」补充一条可验证的契约——切换后的项目级可见性与同 profile 直接启动一致，不需要重启进程。

## Impact

- 代码：`src/settings-generator.ts`（trust 链接、skills/extensions 的项目级处理、项目 settings 合并与 packages 剥除、MCP 禁用标记）、`bin/pi-profile.ts`（信任 flag 转发）、`src/launcher/initial-profile.ts` 与 `src/switching/switch-profile.ts`（不再传递项目 settings）、`src/mcp-config.ts`（区分项目来源 server）。
- 测试：`test/project-scope.integration.test.ts`（受信任项目的可见性断言反转）、`test/settings-generator.test.ts`、`test/settings-generator-selection.test.ts`、`test/launcher-spawn.test.ts`、`test/mcp-config.test.ts`、`test/mcp.integration.test.ts`、`test/switch-profile.test.ts`、`test/initial-profile.test.ts`、`test/cross-cutting.integration.test.ts`、`test/observability.integration.test.ts`。
- 无新增依赖、无新增用户可见配置字段（因此不需要"为何不能由发现机制替代"的论证）。
- 用户可见影响：受信任项目里所有 profile 都会看到项目级资源；项目 `.pi/settings.json` 的行为键（含 model 相关）在运行时覆盖 profile 声明，这是 Pi 的合并顺序，本变更接受并记录。

## Doc Impact

- `docs/prd.md`：在非目标段落补一条边界——profile 的隔离面是用户级资源，项目级资源由 Pi 的 trust 判定决定；链接到架构文档的机制说明，不重抄。
- `docs/architecture/overview.md`：改写「项目级」一行（从"白名单 + trust 守门"改为"由 Pi 原生判定，profile 不参与"）、「packages（项目）」一行（不再剥除）、`trust.json` 一行（每种 profile 都链接）、生成 settings 行（不再并入项目 settings）；改写「已知限制」里的两条（"项目资源的信任判定只由 launcher 执行"、"项目范围的 package skill 不可引用"）。
- `CONTEXT.md`：none：术语集合未变，`Project trust` 的定义仍然成立。
- `docs/adr/`：新增编号文件，记录"项目 scope 归 Pi、profile 只收窄用户级"这一难以撤销的决策与被否掉的替代方案（继续用闸门隔离、给项目级资源补排除项）。
