# Proposal

## Why

启动路径是 profile 生效的唯一入口：它决定用哪个 profile、项目资源是否可信、以及任何失败是否必须在 Pi 启动前终止。这三件事目前只散落在代码注释里。同一条失败语义（unknown profile 是硬失败、从保存状态恢复的失效名字是软回退）没有任何可评审的规范来源。

## What Changes

- 新增 `launcher` 能力域的基线规范，覆盖 CLI 参数解析与透传、初始 profile 选择、启动前失败与退出码、项目信任守门、诊断输出、instance 生成与子进程启动。
- 不改动代码。规范逐条取自 `bin/pi-profile.ts`、`src/launcher/args.ts`、`src/launcher/initial-profile.ts`、`src/launcher/discovery.ts`、`src/launcher/model-check.ts`、`src/launcher/spawn.ts`、`src/project-trust.ts`、`src/settings-generator.ts`。
- 不写设计文档。宿主架构与生成式 settings 的机制由 `docs/architecture/overview.md` 与 ADR-0005 承载。

## Capabilities

### New Capabilities

- `launcher`: `pi-profile` 启动器的可观察行为——参数边界、初始 profile 选择与回退、失败时机与退出码、信任判定、诊断输出、instance 目录契约与子进程启动。

### Modified Capabilities

（无）

## Impact

- 新增 `openspec/specs/launcher/spec.md`，归档时落地。
- 代码零改动，不触碰 `src/`、`extensions/`、`bin/`、`test/`。
- 规范**不**描述陈旧 instance 目录的清理。现存清扫实现扫的是 `<agentDir>/pi-profile/runtime/launch-*`，而 instance 写在 `<PI_PROFILE_SWITCH_DIR>/instances/<profile>/agent`，两个目录树不同，清扫在生产环境恒为空操作。把这条写成契约等于固化缺陷，因此规范只描述 instance 路径契约；该缺陷另行处理。
- 后续变更为 `in-session-switch` 能力域建立基线。overlay 的语义（含 `default` profile 被 overlay 收窄时的规则）归属该能力域，不在本规范内。

## Doc Impact

- `docs/architecture/overview.md`: **需要修正一处错误断言**。「运行目录」段写了"启动时会清扫 `pid` 已失效的陈旧目录"，实际清扫目标路径与 instance 路径不同，该清理不生效。归档前改为陈述实际布局：instance 路径按 profile 固定并复用，不清理；`pid` 文件仍被写入但当前无消费者。
- `docs/prd.md`: none。启动入口与「profile 未显式控制的行为保持 Pi 原生」已在产品目标中覆盖，本变更不改变定位、目标或非目标。
- `CONTEXT.md`: none。`instance`、`Source scope`、`Project trust` 已有定义，规范使用它们而不新增术语。
- `docs/adr/`: none。宿主架构由 ADR-0005 承载，规范引用而不复制其论证。清扫失效属实现缺陷，不构成难以撤销的决策。
