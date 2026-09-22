# Design

## Context

现状：全局与项目 catalog 各是一个 `profiles.json`，内含 `{ schemaVersion, profiles: { <name>: <definition> } }`。读侧 `ProfileCatalog`（`src/profile-catalog.ts`）整文件解析；写侧 `ProfileCatalogStore`（`src/profile-catalog-store.ts`）整文件覆写、写时重读；`bin/postinstall.js` 用 `examples/profiles.json` 播种；`src/workspace.ts` 的 `resolveGlobalProfilesPath` 维护 legacy 回退。动机见 proposal.md「Why」。

## Goals / Non-Goals

**Goals:**

- 每 profile 一个文件：全局 `<workspaceRoot>/profiles/<name>.json`，项目 `<projectDir>/.pi/profiles/<name>.json`。
- 写侧操作粒度收缩到单文件；错误定位到具体文件。
- 删除 legacy 回退、单文件读写、`schemaVersion` 信封三类代码路径。

**Non-Goals:**

- 不做旧格式数据迁移（用户已确认不需要兼容；旧文件被忽略）。
- 不改变逐名字覆盖、项目信任门禁、default profile 内建等既有语义。
- 不引入目录监听、热加载或嵌套目录组织。

## Decisions

### 目录发现与文件枚举

profiles 目录位置固定：全局在工作区根（`PI_PROFILE_SWITCH_DIR` 可覆盖根），项目在 `<projectDir>/.pi/` 下。目录不存在视为空 catalog。枚举时只认 `.json` 后缀的常规文件，忽略其他条目（`.DS_Store`、README、子目录）。basename（去掉 `.json`）即 profile 名。

ADR required: per-profile-file-storage

### 文件内容：裸定义，无信封

每个文件就是一个 `ProfileDefinition` JSON 对象。名字不再出现在文件内，避免与文件名不一致的第二事实来源。`schemaVersion` 删除：目录形态下版本演进可以通过新增可选字段完成（解析本来就只认已知字段、忽略未知键）。

### 名字字符集约束

`^[A-Za-z0-9][A-Za-z0-9._-]*$`。读侧遇到非法 basename 的 `.json` 文件时报错并指明文件路径；写侧 upsert 前校验名字并给出同样规则说明。已知边界：大小写不敏感文件系统（macOS/Windows 默认）上，仅大小写不同的两个名字是同一文件，不做额外校验，spec 记一句说明。被否方案：名字→文件名编码映射（如 percent-encoding）——引入第二套命名规则，收益仅为保留空格/中文名，不值。

### 读侧失败分级

单个文件 JSON 不合法或定义字段非法 → 整个 catalog 读取失败，`CatalogError` 指明文件路径。保持现有 fail-loudly 不变量；静默跳过会让用户以为 profile 丢失，违反错误可行动原则。

### 写侧：单文件 upsert / delete

- upsert：定义先经 `parseProfileDefinition` 校验，再写 `<dir>/<name>.json`（`default` 仍不可写）。
- delete：删除对应文件；文件不存在即"profile 不存在"。
- 写入用临时文件 + rename，避免崩溃留下半个 JSON 导致下次读取整体失败。
- 整文件覆写、`writeDefinitions`、写时重读逻辑删除。并发冲突面从整个 catalog 收缩到同名单文件，保持 last-write-wins。

### 播种

postinstall 改为向全局 `profiles/` 写入随包 starter（`examples/` 提供单文件形态）。目录下已存在任何 `.json` 文件时跳过；仍用 `COPYFILE_EXCL` 防并发，播种失败不使安装失败。legacy 路径检测代码删除。

### 模块落点

- `src/workspace.ts`：`getGlobalProfilesPath`/`resolveGlobalProfilesPath` → `getGlobalProfilesDir`；agentDir 回退删除后 `resolve*` 失去存在意义。
- `src/profile-catalog.ts`：读侧改为目录枚举 + 逐文件解析。
- `src/profile-catalog-store.ts`：写侧改为单文件 upsert/delete。
- `src/switching/profile-crud.ts`：store 构造改传目录路径。
- `bin/postinstall.js`：播种目标改为目录形态，删除 legacy 检测。
- `examples/`：`profiles.json` 拆为 starter 单文件；`example.json` 保持全字段示例。
- `schemas/profiles.schema.json`：从「catalog 文件 schema」改为「单 profile 文件 schema」。

## Risks / Trade-offs

- 用户已有 `profiles.json` 中的定义被静默忽略（无迁移）→ 用户已明确接受；README 与 CHANGELOG 写明破坏性变更与手动搬家方法（把每个键拆成 `profiles/<name>.json`）。
- 仅大小写不同的名字在大小写不敏感文件系统上互相覆盖 → 不校验；文档记为已知边界。
- 目录中混入坏文件导致整个 catalog 不可用 → 错误指明文件路径，用户删/修该文件即可恢复；与现有 fail-loudly 语义一致。

## Migration Plan

发布即切换：代码不读旧格式。用户手动把旧 `profiles.json` 的每个 profile 拆为 `profiles/<name>.json`（裸定义，去掉 `schemaVersion` 信封）。回滚方式为换回旧版本包并恢复原文件。
