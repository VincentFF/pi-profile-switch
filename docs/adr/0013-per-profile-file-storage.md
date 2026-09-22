# 每 Profile 单独立文件存储；退役单文件 Catalog 与信封

## 背景

此前全局与项目 catalog 分别保存在单个 `profiles.json` 文件中，内含 `{ schemaVersion: 1, profiles: { <name>: <definition> } }`。

实践中的代价：

- 写侧操作粒度过大：创建、编辑或删除一个 profile 需要全文件读出后整文件覆写；为了并发编辑安全需要写时重读机制。
- 错误隔离度差：单文件中任意一处 JSON 损坏或单个 profile 字段非法，整个 catalog 读取失败，其他正常的 profile 均不可用。
- 无法利用文件系统原生能力：用户无法通过文件系统直接查看、复制、软链或删除某个特定 profile 的定义。
- 维护了已无必要的 legacy 回退路径（`<agentDir>/profiles.json`）与单文件信封结构（`schemaVersion`）。

## 决策

将 catalog 从单个 JSON 文件改为每个 profile 独立文件的目录形态：

1. **目录位置与文件枚举**：全局 profiles 保存在工作区根的 `profiles/` 目录（默认 `~/.pi-profile-switch/profiles/`，可由 `PI_PROFILE_SWITCH_DIR` 覆盖）；项目 profiles 保存在 `<projectDir>/.pi/profiles/` 目录。系统仅枚举扩展名为 `.json` 的常规文件，文件名去掉 `.json` 后缀即为 profile 名。其他非 `.json` 条目与子目录被忽略；目录不存在视为空 catalog。
2. **裸定义，无信封**：每个 `<name>.json` 文件的顶层值即为一个裸 `ProfileDefinition` JSON 对象，不再包含 `schemaVersion` 或 `profiles` 信封。Profile 名称由文件名权威决定，文件内不出现名字字段。
3. **名字字符集约束**：Profile 名字必须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`。读侧遇到非法名字的 `.json` 文件报错并指明文件路径；写侧创建与编辑前校验名字并给出规则。
4. **单文件写侧与原子写入**：写侧操作收敛为单文件粒度——创建与编辑写目标 `<name>.json`（经校验后先写同目录临时文件再原子 rename），删除直接 unlink 对应文件。删除整文件覆写与写时重读逻辑。
5. **错误可行动性**：文件格式非法或字段校验失败时，错误信息精确指明出错的文件路径、profile 名与字段名。
6. **安装播种与示例**：安装包时播种单个 starter 文件 `ask.json`，仅在全局 `profiles/` 目录下不存在任何 `.json` 文件时写入。

## 被否方案

**保留单文件 `profiles.json`**。否掉的理由见背景的四条代价：冲突面大、无法单文件隔离、文件损坏牵连全局、多进程向导编辑需要复杂的锁或写时重读。

**文件名编码映射（如 percent-encoding）以支持任意字符（中文、空格等）**。引入名字与文件名两套标识，容易出现第二事实来源与不同平台转义分歧；收益仅为允许空格与特殊字符，对于 CLI/命令交互并不友好，不值。

**自动数据迁移（在启动时将旧 `profiles.json` 自动拆分）**。单次破坏性迁移可以用文档清晰说明，用户手动拆分成本低；自动迁移引入额外的探测、写入与遗留兼容包袱，违背极简原则。

## 代价

- 破坏性变更：不再支持旧版 `profiles.json`，无自动迁移逻辑。旧用户需要手动把旧文件内的 profiles 拆分为 `profiles/<name>.json` 裸定义。
- 在大小写不敏感的文件系统（macOS / Windows 默认）上，仅大小写不同的两个 profile 名字映射到同一文件。系统不对大小写冲突做额外探测。

## 相关

行为契约见 `openspec/specs/profile-catalog/spec.md` 与 `openspec/specs/launcher/spec.md`；架构描述见 `docs/architecture/overview.md`。
