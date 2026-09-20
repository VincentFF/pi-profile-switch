# Tasks

本变更不产出代码。下面每个任务都是把规范逐条对回实现，确认没有写出未实现的行为，也没有漏掉已实现的行为。

## 1. 规范与实现一致性核对

- [ ] 1.1 核对「Catalog 文件位置与发现」：读 `src/workspace.ts` 的 `getProfileSwitchDir`、`getGlobalProfilesPath`、`resolveGlobalProfilesPath`，确认首选路径、`PI_PROFILE_SWITCH_DIR` 覆盖、legacy 回退与「缺文件即空 catalog」四项均与规范一致
- [ ] 1.2 核对「Catalog 文件格式校验」与「Profile 定义字段」：读 `src/profile-catalog.ts` 的 `loadCatalogFile` 与 `parseProfileDefinition`，确认四条错误路径（JSON 无效、顶层非对象、schemaVersion 不符、profiles 非对象）与字段类型校验的报错内容一致
- [ ] 1.3 核对「内建 default profile」：读 `src/profile-catalog.ts` 中 `DEFAULT_PROFILE_NAME` 的三处处理（catalog 内定义时抛错、解析时返回 builtin、`resolve` 短路），确认与规范一致
- [ ] 1.4 核对「Profile 来源与项目覆盖」与「Profile 列表顺序」：读 `src/profile-catalog.ts` 的 `load` 与 `list`，确认项目条目覆盖全局、覆盖顺序、以及 `default` 在列表最前的实现
- [ ] 1.5 核对「项目信任门禁」：读 `src/switching/profile-crud.ts` 的 `requireScope` 与 `readCatalogScope`，确认未受信任时读返回空、写报错，且读路径不触碰文件
- [ ] 1.6 核对「Profile 创建、编辑与复制」与「Profile 删除」：读 `src/switching/profile-crud.ts` 的 `createProfile`、`editProfile`、`deleteProfile`、`duplicateProfile`，逐条确认六个失败条件与消息内容
- [ ] 1.7 核对「Catalog 写入」：读 `src/profile-catalog-store.ts` 的 `writeDefinitions` 与 `upsert`，确认整文件覆盖、只写已声明字段、以及写入前先校验再落盘
- [ ] 1.8 核对「安装播种 starter profile」：读 `bin/postinstall.js`，确认首次写入、已存在不覆盖、legacy 存在则跳过、失败不阻断安装四种情形

## 2. 规范质量校验

- [ ] 2.1 运行 `openspec validate spec-baseline-profile-catalog --strict` 通过，确认无 requirement 缺少 scenario、无 scenario 标记数错误
- [ ] 2.2 逐条比对 `openspec/changes/spec-baseline-profile-catalog/specs/profile-catalog/spec.md` 与 `docs/architecture/overview.md`、`docs/adr/0003-no-profile-inheritance.md`、`docs/adr/0004-profiles-reference-shared-resources.md`，确认规范没有复述机制描述或决策论证
- [ ] 2.3 逐条核对规范用词与 `CONTEXT.md` 一致，确认未使用规避词（`preset`、`config`、`bundle`、`capability`、`session profile`、`temporary profile`、`built-in`、`内置`）
- [ ] 2.4 确认规范未出现实现类名与文件内部符号（如模块类名、内部函数名），只出现用户可见的文件路径与字段名

## 3. 文档同步核对

- [ ] 3.1 核对 `docs/prd.md`：确认本次没有改变定位、目标或非目标，无需改动
- [ ] 3.2 核对 `CONTEXT.md`：确认本次没有引入新术语或改变既有术语含义，无需改动
- [ ] 3.3 核对 `docs/architecture/overview.md`：确认本次没有改变模块边界、数据流或已知限制，无需改动
- [ ] 3.4 核对 `docs/adr/`：确认本次没有引入难以撤销的决策，无需新增 ADR
