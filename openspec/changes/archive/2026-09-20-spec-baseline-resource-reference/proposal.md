# Proposal

## Why

`openspec/specs/` 里目前只有一个能力域的基线。`resource-reference` 是其余能力域的前置：profile 里的引用如何解析、解析失败时是阻塞还是警告、哪些工具在 spawn 前不可知，这些决定同时约束启动与切换两条路径。没有这份规范，改动引用解析的任何一处都只能靠读代码判断影响面。

## What Changes

- 新增 `resource-reference` 能力域的基线规范，覆盖 skill、extension、MCP server、tool 四类引用的发现与解析，以及 profile 级设置字段的解析校验。
- 不改动代码。规范逐条取自 `src/skill-registry.ts`、`src/extension-discovery.ts`、`src/mcp-config.ts`、`src/profile-resolver.ts`、`src/switching/tool-references.ts`。
- 不写设计文档。机制已由 `docs/architecture/overview.md` 的过滤模型与 ADR-0007、ADR-0008 承载；失败分级由 ADR-0009 承载，规范只陈述行为。

## Capabilities

### New Capabilities

- `resource-reference`: 四类引用的可引用形式与发现来源、引用解析的成功与失败语义、失败分级、以及 profile 级设置字段的校验。

### Modified Capabilities

（无）

## Impact

- 新增 `openspec/specs/resource-reference/spec.md`，归档时落地。
- 代码零改动，不触碰 `src/`、`extensions/`、`bin/`、`test/`。
- 后续变更依次为 `launcher` 与 `in-session-switch` 两个能力域建立基线。

## Doc Impact

- `docs/architecture/overview.md`: **需要新增一条已知限制**。`src/skill-registry.ts` 排除项目范围的 package skill（其包装在项目 `.pi/npm` 下，生成的全局 settings 无法引用）。这条限制原先记录在 `docs/specs/initial-implementation/issues/03-project-catalogs-scope-state.md`，该文件已随 matt 体系删除，目前只剩代码注释。归档前写入「已知限制」段。
- `docs/prd.md`: none。四类资源已在「产品目标」中覆盖；本变更不改变定位、目标或非目标。
- `CONTEXT.md`: none。`Resource`、`SkillRegistry`、`ExtensionDiscovery`、`McpServerRegistry` 四个术语已有定义，规范使用它们而不新增术语。
- `docs/adr/`: none。失败分级由 ADR-0009 承载，发现与入口枚举的归属分别由 ADR-0007、ADR-0008 承载，规范引用而不复制其论证。
