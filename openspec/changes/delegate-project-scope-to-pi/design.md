# Design

## Context

见 `proposal.md` 的 Why。设计约束来自 Pi 的三条既有事实（机制细节见 `docs/architecture/overview.md`，不在此复述）：

- 项目级自动发现（`.pi/skills`、`.pi/extensions`、`.pi/prompts`、`.pi/themes`、项目 `settings.json`）由 Pi 的 `SettingsManager.projectTrusted` 一次决定，`session.reload()` 不重算。
- 排除项（`-<路径>`）的作用域是各自 scope 的 settings：instance 的 settings 是 global scope，它的排除项只过滤 user scope 的发现结果，管不到项目 scope。
- 会话内 extension 只能追加资源路径，没有移除已发现资源的 API。

结论：项目级 narrowing 只有"整块关闭"一条路，而"整块关闭"正是本变更要放弃的东西。

## Goals / Non-Goals

**Goals:**

- 项目级资源的可见性只由 Pi 的项目信任判定决定；profile 的收窄面限定为用户级资源。
- 会话内切换与直接启动在项目级可见性上等价，不需要重启进程。
- 受信任项目下 `default` profile 与原生 Pi 的项目级行为一致；本地行为键仍由 Pi 原生合并顺序决定。

**Non-Goals:**

- 不引入交互式信任询问到命名 profile：命名 profile 的 Generated settings 保留 `defaultProjectTrust: "never"`，即"没有已存储决定时不询问、项目级资源不可见"。要看到项目级资源，先用原生 Pi 信任一次或带 `--approve`。理由：启动器在 spawn 前已按同一判定完成 catalog 与 MCP 校验，运行时再让用户改判会产生"catalog 不含项目定义、资源却按项目放行"的同会话分歧。
- 不让 profile 声明覆盖项目 `.pi/settings.json` 的行为键（见 Risks）。
- 不改 tools 的白名单语义（项目级不存在工具发现）。

## Decisions

### 1. `trust.json` 成为每种 profile 都建立的链接

instance 建立指向真实 agentDir 的 `trust.json` 链接；路径已被占用时不覆盖（Pi 在本会话内写入过真实文件时保留它，且不再出现）。

- 理由：Pi 的项目信任判定从该路径读取；链接让"已存储决定"在命名 profile 下也生效，并让 Pi 通过链接写入的信任决定落在真实 agentDir（与 `auth.json` 同类，见 `docs/adr/0010-per-launch-instance-lifecycle.md`）。
- 被否掉的替代：给项目级资源补排除项。排除项作用域不覆盖项目 scope（见 Context），该方案在 Pi 侧不可能实现。
- 被否掉的替代：切换时不改链接、只改 Generated settings。仍然解决不了 Pi 只判定一次这件事。
- ADR required: project-scope-belongs-to-pi

### 2. Generated settings 不再表达项目级收窄，也不再合并项目 settings

项目级 skill/extension 既不写排除项也不写附加路径；项目 `.pi/settings.json` 不再并入 Generated settings，随之删除"剥除项目 `packages`"的逻辑。

- 理由其一（正确性）：项目级条目在 runtime 由 Pi 原生发现，附加路径只会产生重复资源与 scope 归属混乱。
- 理由其二（必须）：并合项目 settings 会把项目 `packages` 变成 instance 的 *global* packages，于是 Pi 会把它们装进全局 npm 根——这正是先前剥除该键的原因。闸门打开后项目 packages 由 Pi 原生处理（装在项目 `.pi/npm`），pi-profile 既不能再剥除，也就不该再合并。
- 被否掉的替代：保留合并但继续剥离 `packages`。它会让 Generated settings 与 Pi 实际读到的项目 settings 不一致，且需要逐键维护"哪些键不能并"，不可持续。

### 3. 项目级资源留在解析词汇表内

受信任项目的项目级 skill/extension 仍可被 profile 引用（字面量、glob 都能解析成功），只是选择结果不写入 Generated settings。

- 理由：把项目级资源移出词汇表会让"引用项目内 skill"从解析成功变成激活失败，是比原问题更糟的行为回归；`/profile status` 也仍应报告它们。

### 4. `mcps` 的收窄不作用于项目来源 server

项目 `.mcp.json`、项目 `.pi/mcp.json` 定义的 server 保持启用；仍被禁用的是用户级共享位置里未被允许的 server。

- 理由：与 skills/extensions 同一条边界——项目级资源不由 profile 收窄。用户级共享位置必须显式标记禁用是 adapter 直接读取这些位置造成的，与项目无关。
- 被否掉的替代：保持现状（项目 server 可被 profile 禁用）。它与本变更的边界声明自相矛盾。

### 5. 一次性信任输入转发给所有 profile

`--approve` / `--no-approve` 不再只对 `default` 转发。

- 理由：不转发时，命名 profile 下启动器按 `--no-approve` 判定不受信任（不读项目 catalog），而 Pi 仍按已存储决定放行项目级资源——同一次启动里两个判定分歧。

## Risks / Trade-offs

- [profile 失去对项目级资源的任何控制力] → 已受信任项目的 skill/extension 在任何 profile 下都会进入会话，包括只读风格的 profile。缓解：信任判定本身是唯一闸门，这与原生 Pi 一致；在 `docs/architecture/overview.md` 与 PRD 的边界段落写明，不靠隐含假设。
- [项目 `.pi/settings.json` 的行为键覆盖 profile 声明] → 按 Pi 的合并顺序（项目覆盖 global），项目的 `defaultProvider`/`defaultModel`/`defaultThinkingLevel` 会压过 profile 的声明；`defaultTools` 只影响启动基线，extension 在 session start 会按 profile 的 tool 引用重新收紧。缓解：记录为已知边界；如需 profile 的 model 优先，另开变更在 session start 重新施加（本变更不做）。
- [项目 packages 首次启动会安装，可能联网并变慢] → 这是 Pi 在受信任项目下的原生行为；未受信任项目与 `--no-approve` 不触发。
- [集成测试期望反转] → `test/project-scope.integration.test.ts` 现有断言（受信任项目里未选中的项目资源不可见、项目 settings 并入）与本变更冲突，需要按新语义重写并补信任链接与 MCP 的用例。

## Migration Plan

无持久化格式变更，无需迁移。回滚即回退了本变更的提交：instance 目录每次启动重建，不携带旧状态。
