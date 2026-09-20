# Tasks

本变更不产出代码。每个任务是把规范逐条对回实现，确认没有写出未实现的行为，也没有漏掉已实现的行为。

## 1. 规范与实现一致性核对

- [x] 1.1 核对「Skill 引用解析」：读 `src/skill-registry.ts`，确认只读发现、`noExtensions`、同名优先级交给 Pi、每次解析重新运行、项目未受信任时不扫描，以及项目范围 package skill 被排除这六项均与规范一致
- [x] 1.2 核对「Extension 引用解析」：读 `src/extension-discovery.ts` 的 `DiscoveredExtensions` 构造与 `select`，确认三种选中形式与散装文件 ID 推导规则（含 `index.<ext>` 折叠）
- [x] 1.3 核对「Extension 引用的失败行为」与「Extension ID 碰撞」：读 `src/extension-discovery.ts` 的 `#unknownMessage`、`select` 的抛错分支与构造期碰撞检测，逐条确认四个失败条件与警告文案
- [x] 1.4 核对「MCP server 引用解析与 adapter 依赖」：读 `src/mcp-config.ts`，确认六个标准配置位置、`isShared` 的作用、三条配置错误路径，以及 `MissingMcpAdapterError` 的触发条件
- [x] 1.5 核对「Tool 引用解析」：读 `src/switching/tool-references.ts` 与 `src/profile-resolver.ts` 中 `literalMustExist: false` 的调用，确认 spawn 前只展开内建工具、未匹配字面量被报告而非丢弃、未声明 `tools` 时不进入 plan
- [x] 1.6 核对「Profile 级设置字段的解析与校验」：读 `src/profile-resolver.ts` 的 `VALID_THINKING_LEVELS` 校验、`validateModel` 缺失时的报错，以及 plan 组装时的条件展开
- [x] 1.7 核对「引用失败的统一分级」：读 `src/profile-resolver.ts` 的 `expandReferences` 与 `unmatched` 收集（`skill:` / `extension:` / `mcp:` 前缀），确认 tool 两类情形都不进入失败面

## 2. 规范质量校验

- [x] 2.1 运行 `openspec validate spec-baseline-resource-reference --strict` 通过
- [x] 2.2 比对规范与 `docs/adr/0007-discovery-only-extension-filtering.md`、`docs/adr/0008-extension-discovery-delegates-to-pi-package-manager.md`、`docs/adr/0009-reference-resolution-failure-tiering.md`，确认没有复述其论证与实现历史
- [x] 2.3 比对规范与 `docs/architecture/overview.md` 的「过滤模型」表，确认规范只陈述行为，没有复述作用域到 Pi 机制的映射
- [x] 2.4 核对用词与 `CONTEXT.md` 一致，确认未使用规避词，且未出现实现类名与内部函数名

## 3. Doc Impact 落地

- [x] 3.1 向 `docs/architecture/overview.md` 的「已知限制」表新增一行：项目范围的 package skill 不可引用，原因是其包装在项目 `.pi/npm` 下而生成的全局 settings 无法引用
- [x] 3.2 核对 `docs/prd.md`：确认本次没有改变定位、目标或非目标，无需改动
- [x] 3.3 核对 `CONTEXT.md`：确认没有引入新术语或改变既有术语含义，无需改动
- [x] 3.4 核对 `docs/adr/`：确认没有引入难以撤销的决策，无需新增 ADR
