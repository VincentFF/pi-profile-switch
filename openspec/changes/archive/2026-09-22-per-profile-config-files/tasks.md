# Tasks

## 1. 读侧：目录形态的 catalog

- [x] 1.1 `src/workspace.ts`：用 `getGlobalProfilesDir()`（工作区根下 `profiles/`）替换 `getGlobalProfilesPath`/`resolveGlobalProfilesPath`，删除 agentDir legacy 回退；`npm run check` 通过（调用方暂存编译错误可在 1.3 一并修复）
- [x] 1.2 `src/profile-catalog.ts`：读侧改为枚举 `profiles/` 目录的 `*.json` 常规文件，basename 即 profile 名；忽略非 `.json` 条目与子目录；单文件非法 JSON 或顶层非对象时抛 `CatalogError` 并指明文件路径；`default.json` 存在时报错；非法名字（不匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`）的文件报错并指明路径；覆盖语义保持逐名字完整替换。验证：新增/改写的单测覆盖 specs delta 中「Catalog 目录位置与发现」「Catalog 文件格式校验」「内建 default profile」「Profile 名字约束」的全部 scenario

## 2. 写侧：单文件 upsert / delete

- [x] 2.1 `src/profile-catalog-store.ts`：upsert 写 `<dir>/<name>.json`（先经 `parseProfileDefinition` 校验，写临时文件再 rename），delete 删对应文件；删除 `writeDefinitions` 与写时重读逻辑；非法名字写入失败并说明规则。验证：单测覆盖「Catalog 写入」「Profile 创建、编辑与复制」「Profile 删除」「Profile 名字约束」写侧 scenario
- [x] 2.2 `src/switching/profile-crud.ts`：store 构造改传目录路径（全局 `getGlobalProfilesDir()`，项目 `<cwd>/.pi/profiles/`）。验证：`npm run check` 通过，相关单测通过

## 3. 播种与 schema

- [x] 3.1 `bin/postinstall.js`：播种目标改为全局 `profiles/ask.json`，仅当目录中没有任何 `.json` 文件时写入（仍 `COPYFILE_EXCL`、失败不阻塞安装），删除 legacy 路径检测。验证：postinstall 单测覆盖「安装播种 starter profile」两个 scenario
- [x] 3.2 `examples/`：`profiles.json` 拆为 starter 单文件 `ask.json`（裸定义）；`example.json` 保持全字段示例但改为裸定义形态。验证：postinstall 测试引用新文件通过
- [x] 3.3 `schemas/profiles.schema.json`：改为单 profile 文件的 schema（裸 `ProfileDefinition`，无 `schemaVersion` 信封）。验证：schema 校验测试通过

## 4. 整体回归

- [x] 4.1 全仓搜索 `profiles.json` 残留引用并清理（源码、测试）；`npm run check` 与 `npm test` 全部通过

## 5. 文档

- [x] 5.1 `CONTEXT.md`：Catalog 术语定义改为「持有 profile 定义的 `profiles/` 目录：全局一个，每个项目一个，每 profile 一个 `<name>.json` 文件」
- [x] 5.2 `docs/architecture/overview.md`：模块表、schema 权威段、`bin/` 与 `examples/` 条目中的 `profiles.json` 路径与播种描述改为目录形态
- [x] 5.3 `README.md` 与 `README.zh-CN.md`：路径表改为 `~/.pi-profile-switch/profiles/<name>.json` 与 `<project>/.pi/profiles/<name>.json`，删除 legacy 回退说明，补一段旧格式手动搬家说明
- [x] 5.4 新增 `docs/adr/0013-per-profile-file-storage.md`：记录每 profile 一个文件的决策，被否方案为保留单文件 catalog；并在相关旧 ADR 顶部按需标注
