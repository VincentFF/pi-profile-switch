# Proposal

## Why

命名 profile 下，launcher 在 spawn 前完成项目信任判定，且 `ask` 无已存储决定时静默判为不信任（ADR-0011 的既定取舍）。但判定的结果完全不可见：用户打开一个未受信任的目录，项目 catalog 不读、项目级资源不可见，界面上没有任何线索，用户只能猜测原因。静默失败违反项目「错误必须可行动」的原则。

## What Changes

- 启动时，若项目判定为未受信任，且项目目录中存在因不信任而被跳过的内容——pi-profile 自己的项目文件（`.pi/profiles/`、`.pi/pi-profile-state.json`、项目 MCP 配置）或任何需要信任的 Pi 项目资源（`.pi/settings.json`、`.pi/extensions` 等）——launcher SHALL 在 stderr 输出一条诊断。
- 诊断 SHALL 说明：项目未受信任、哪些内容因此不可见、以及如何授权（`/trust` 持久保存决定，下次启动生效；`-- --approve` 本次一次性信任）。启动照常继续，退出码不变。
- 判定逻辑本身不变：不改变信任判定顺序，不引入交互弹窗，不影响 Pi 原生 ask 行为。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `launcher`：「启动诊断输出」requirement 扩展一类新诊断（未受信任项目）。

## Impact

- 代码：`src/launcher/`（判定后输出诊断），信任判定与 spawn 流程不变。
- 测试：诊断触发/不触发的用例。
- 无依赖变化。

## Doc Impact

- `docs/prd.md`：none——不改变产品定位与非目标。
- `docs/architecture/overview.md`：none——过滤模型与信任守门机制不变，仅多一条诊断输出。
- `CONTEXT.md`：none——无新术语。
- `docs/adr/`：none——不推翻 ADR-0011 的判定取舍，只补足其结果的可观测性。
