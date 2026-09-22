# Proposal

## Why

Profile 定义目前全部集中在一个 `profiles.json` 里：编辑一个 profile 要整文件覆写，并发编辑需要写时重读，单个 profile 的内容坏了会让整个 catalog 报错，且无法单独查看、复制或删除某个 profile 的定义文件。改为每 profile 一个文件后，写侧退化为单文件读写，错误可以精确到文件。

## What Changes

- **BREAKING** 全局 catalog 从 `~/.pi-profile-switch/profiles.json`（单文件）改为 `~/.pi-profile-switch/profiles/` 目录，每个 profile 一个 `<name>.json` 文件，文件名（去掉 `.json`）即 profile 名。
- **BREAKING** 项目 catalog 从 `<projectDir>/.pi/profiles.json` 改为 `<projectDir>/.pi/profiles/` 目录，同样每 profile 一个文件；仍只在项目受信任时读取。
- **BREAKING** 删除 legacy 回退路径 `<agentDir>/profiles.json` 与单文件 `profiles.json` 的全部读写代码，不提供迁移。
- **BREAKING** 文件内容改为裸 profile 定义，不再包 `schemaVersion` 信封；`schemaVersion` 校验随之删除。
- Profile 名字增加字符集约束：`^[A-Za-z0-9][A-Za-z0-9._-]*$`，非法名字报错并说明规则。
- 覆盖语义不变：项目目录中的同名文件完整遮罩全局同名 profile，其余全局 profile 照常可见。
- 写侧简化：创建/编辑 = 写单个文件，删除 = 删单个文件；整文件覆写与写时重读逻辑移除。
- 目录中某个文件内容不合法时整个 catalog 读取失败，错误指明文件路径；非 `.json` 条目忽略。
- 安装播种从"写入 starter catalog 文件"改为"写入一个 starter profile 文件"。
- 不新增用户可见配置字段：profiles 目录由固定位置发现，无需配置。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `profile-catalog`：catalog 的存储形态从单文件改为每 profile 一文件的目录；涉及「文件位置与发现」「文件格式校验」「Profile 定义字段」（名字约束）「Profile 创建、编辑与复制」「Profile 删除」「Catalog 写入」「安装播种」等 requirement。
- `launcher`：「项目信任守门」中 pi-profile 项目文件的路径从 `.pi/profiles.json` 变为 `.pi/profiles/` 目录。

## Impact

- 代码：`src/profile-catalog.ts`、`src/profile-catalog-store.ts`、`src/workspace.ts`（`resolveGlobalProfilesPath` 删除）、`bin/postinstall.js`、`examples/`（播种文件形态变化）、`schemas/`（schema 权威定义改述目录形态）。
- 测试：catalog 读写、播种、launcher 信任守门相关用例。
- 文档：README.md 的路径表与 examples 说明；详见 Doc Impact。
- 无依赖变化。

## Doc Impact

- `docs/prd.md`：none——存储形态是实现细节，不影响产品定位与非目标。
- `docs/architecture/overview.md`：模块表、生成物与 schema 权威段落中的 `profiles.json` 路径与播种描述需改为目录形态。
- `CONTEXT.md`：Catalog 术语定义从「`profiles.json` 文件」改为「profiles 目录，每 profile 一个文件」。
- `docs/adr/`：新增 ADR-0013，记录「每 profile 一个文件」的存储决策；被否方案为保留单文件 catalog（编辑冲突面大、错误无法定位到单个 profile）。
