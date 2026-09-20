# Proposal

## Why

会话内切换是用户日常接触最多的一层，也是失败代价最高的一层：切换要求重写正在运行的进程所依赖的运行时文件。回滚、overlay 的作用边界、以及状态写在 reload 之后而非之前，这三条决定了失败时是否会留下半切换的 runtime，目前只写在代码注释里。

## What Changes

- 新增 `in-session-switch` 能力域的基线规范，覆盖 `/profile` 命令族与模式门禁、切换与 reload 流程、失败回滚、session start 的 plan 应用与变更摘要、runtime overlay、运行时状态文件、观层面（选择器、`list`、`status`）以及 CRUD 的会话内效果。
- 不改动代码。规范逐条取自 `extensions/pi-profile/index.ts` 与 `src/switching/`、`src/runtime-state-store.ts`。
- 不写设计文档。reload 与生成式 settings 的机制由 `docs/architecture/overview.md` 的「激活流程」与 ADR-0005 承载。

## Capabilities

### New Capabilities

- `in-session-switch`: Pi 进程内 `/profile` 命令族的可观察行为——切换与 reload 的时序与失败语义、overlay 的作用范围、运行时状态的位置与合并规则、以及观测与 CRUD 命令对运行时的影响。

### Modified Capabilities

（无）

## Impact

- 新增 `openspec/specs/in-session-switch/spec.md`，归档时落地。
- 代码零改动，不触碰 `src/`、`extensions/`、`bin/`、`test/`。
- CRUD 的写入语义（失败条件、scope 归属、并发覆盖）已在 `profile-catalog` 能力域规范中，本规范只覆盖它对运行时的**影响**，不重复其写入规则。
- 本变更为四个能力域基线的最后一块。

## Doc Impact

- `docs/prd.md`: none。「切换不重启进程」「overlay 是临时调整且不写 catalog」「切换保留 session」已在产品目标与运行语义中覆盖，本变更不改变定位、目标或非目标。
- `docs/architecture/overview.md`: none。「激活流程」的会话内切换段与「已知限制」已描述本能力域的机制与偏离；规范只补充可验证行为。
- `CONTEXT.md`: none。`RuntimeOverlay`、`Runtime state`、`ActivationPlan`、`Runtime reload` 已有定义，规范使用它们而不新增术语。
- `docs/adr/`: none。本变更不引入难以撤销的决策；reload 机制由 ADR-0005 承载。
