# 项目级资源归 Pi，profile 只收窄用户级资源

补充 ADR-0005 的背景：它列出的"项目级自动发现可被 `defaultProjectTrust: "never"` 完全抑制"仍是事实，但抑制不再作为过滤手段使用。

## 背景

隔离面是四类资源（skills、extensions、MCP servers、tools），而 Pi 的项目级开关是全或全无的，并且只在启动时被读取一次：

- `SettingsManager.projectTrusted` 按进程、按 cwd 判定一次；`session.reload()` 不重算，Pi 自己的文档也说信任变更需重启进程。
- 排除项（`-<路径>`）的作用域是各自 scope 的 settings；instance 的 `settings.json` 是 global scope，过滤不到项目 scope 的发现结果，也管不了项目 `.pi/settings.json` 声明的资源数组。
- 会话内没有移除已发现资源的 API：extension 只能用 `resources_discover` 追加 skill、prompt、theme 路径。

因此"按 profile 收窄项目级资源"只有一条实现路径：用 trust 闸门整块压制项目级发现。它带来三个代价：隔离面比定位宽（项目级 prompts、themes、settings 被一并屏蔽）；会话内切换回到 `default` 后项目级资源仍不可见（treat 判定已冻结，切回后必须重启）；闸门开着时（`default` 启动后切到命名 profile）项目级资源会泄漏，而排除项对项目 scope 无效。

## 决策

项目级资源的可见性由 Pi 的项目信任判定单独决定：

- instance 的 `trust.json` 是指向真实 trust store 的符号链接，每种 profile 都建立（目标不存在时同样建立）。
- 一次性信任输入（`--approve` / `--no-approve`）转发给任何 profile 的 Pi 进程，使判定两侧一致。
- Generated settings 不编码项目级资源：既不加白名单也不加排除项，也不合并项目 `.pi/settings.json`；项目 packages 因此走 Pi 原生安装路径，不会成为全局 npm 根的安装副作用。
- profile 的收窄面是用户级资源：真实 agentDir 与 `~/.agents/skills`。

命名 profile 的生成 settings 保留 `defaultProjectTrust: "never"`，其作用收窄为"不发起信任询问"。

## 被否方案

**给项目级资源补排除项**（保留闸门，用排除项同时收窄两侧）：排除项只作用于各自 scope 的 settings，无法过滤项目 scope 的发现结果，也无法阻止项目 `.pi/settings.json` 声明的资源数组。该方案在 Pi 侧不可能实现。

**在每次 session start 重新施加 profile 的属性**（把项目 settings 的影响再压回去）：等价于与 Pi 的合并顺序对抗，且要逐键维护，无法覆盖任意键。

**把 Pi 的交互式信任询问引入命名 profile**（运行时补做信任决定）：启动器在 spawn 前已按"未受信任"完成 catalog 与 MCP 校验，运行时改判会出现"项目 catalog 不含项目定义、项目资源却放行"的同会话分歧。

## 代价

- profile 失去对项目级资源的控制力：已受信任项目的 skill、extension 与 MCP server 在任何 profile 下都可用，只读风格的 profile 也不能隐藏它们；项目信任是唯一闸门。
- 项目 `.pi/settings.json` 的行为键（`defaultProvider`、`defaultModel`、`defaultThinkingLevel`）按 Pi 的合并顺序覆盖 profile 声明；tools 不受影响（extension 在 session start 重新收紧工具）。
- 命名 profile 在项目未受信任且无已存储决定时不发起询问，项目级资源此时不可见。
- 与 Pi 的耦合点从"用 `never` 抑制项目发现"转为 trust store 的位置与合并顺序；集成测试用真实 Pi 子进程守卫。

## 相关

行为契约见 `openspec/specs/launcher/spec.md`、`openspec/specs/resource-reference/spec.md`、`openspec/specs/in-session-switch/spec.md`；机制归属见 `docs/architecture/overview.md` 的过滤模型。
