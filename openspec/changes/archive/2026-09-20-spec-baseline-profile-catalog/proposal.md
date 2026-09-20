# Proposal

## Why

pi-profile-switch 已经实现并可运行，但 `openspec/specs/` 是空的。行为契约目前只存在于三处间接位置：代码本身、`docs/architecture/overview.md` 的机制描述、7 条 ADR 的决策记录。没有可验证的规范，后续变更就只能是"改代码、顺手改描述"，无法判断一次改动是否破坏了既有行为，也无法在评审时指出"这条要求被违反了"。

本变更建立基线的第一部分：`profile-catalog` 能力域。

## What Changes

- 新增 `profile-catalog` 能力域的基线规范，覆盖 profile 定义与字段校验、catalog 文件解析、profile 来源与覆盖规则、create/edit/delete/duplicate 的可观察行为。
- 不改动代码。规范逐条取自现存实现：`src/profile-catalog.ts`、`src/profile-catalog-store.ts`、`src/switching/profile-crud.ts`、`src/workspace.ts`、`bin/postinstall.js`。
- 不写设计文档。本能力域的机制已由 `docs/architecture/overview.md` 与 ADR-0003、ADR-0004 承载，没有待决的新设计。

## Capabilities

### New Capabilities

- `profile-catalog`: profile 定义与字段校验、catalog 文件的读写、profile 来源与项目覆盖全局的解析规则、create/edit/delete/duplicate 的可观察行为。

### Modified Capabilities

（无）

## Impact

- 新增 `openspec/specs/profile-catalog/spec.md`，归档时落地。
- 代码零改动，不触碰 `src/`、`extensions/`、`bin/`、`test/`。
- 后续变更依次为 `resource-reference`、`launcher`、`in-session-switch` 三个能力域建立基线。

## Doc Impact

- `docs/prd.md`: none。本变更不改变定位、目标或非目标；「项目级定义覆盖全局定义」已是非目标的对应目标项。
- `docs/architecture/overview.md`: none。catalog 模块与来源解析已在该文档描述，规范只补充可验证行为，不引入新机制。归档时需核对没有把机制写进规范。
- `CONTEXT.md`: none。`Profile`、`Catalog`、`Source scope`、`default profile` 四个术语已有定义，规范使用它们而不新增术语。
- `docs/adr/`: none。本变更不引入难以撤销的决策；非继承语义由 ADR-0003 承载，引用而非复制语义由 ADR-0004 承载。
