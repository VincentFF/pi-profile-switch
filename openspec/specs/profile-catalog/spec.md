# profile-catalog Specification

## Purpose
定义 profile 从哪里读取、什么内容合法、同名 profile 之间谁生效。它是 profile 选择机制的数据来源：其他三个能力域都从这个能力域解析出的定义出发。

## Requirements

### Requirement: Catalog 目录位置与发现

系统 SHALL 从两个位置读取 profile 定义：全局 catalog 与项目 catalog。

全局 catalog 位于工作区根下的 `profiles/` 目录，工作区根默认为 `~/.pi-profile-switch`，可由 `PI_PROFILE_SWITCH_DIR` 覆盖。

项目 catalog 位于 `<projectDir>/.pi/profiles/` 目录。

目录中每个扩展名为 `.json` 的常规文件 SHALL 定义一个 profile，文件名去掉 `.json` 后缀即为 profile 名。其他条目（非 `.json` 文件、子目录）SHALL 被忽略。

目录不存在 SHALL 被视为空 catalog，而不是错误。系统 MUST NOT 读取上述两个位置之外的任何历史路径。

#### Scenario: 工作区根被环境变量覆盖

- **WHEN** 设置了 `PI_PROFILE_SWITCH_DIR`，且该目录下存在 `profiles/` 目录
- **THEN** 系统读取该目录作为全局 catalog，不读取默认工作区根

#### Scenario: 目录不存在

- **WHEN** 全局或项目的 `profiles/` 目录不存在
- **THEN** 对应 catalog 视为空，不报错

#### Scenario: 非 JSON 条目被忽略

- **WHEN** `profiles/` 目录中同时存在 `review.json`、子目录与无 `.json` 后缀的文件
- **THEN** 只有 `review.json` 参与解析，其余条目不报错、不产生 profile

### Requirement: Catalog 文件格式校验

系统 SHALL 在任一 profile 文件内容不合法时报错，MUST NOT 静默降级。

每个 profile 文件的顶层值 SHALL 是一个对象，即该 profile 的完整定义，不含 `schemaVersion` 等信封字段。JSON 语法 SHALL 合法。

校验失败 SHALL 可行动：错误 SHALL 指明出错的文件路径；字段级错误 SHALL 同时指明 profile 名与字段名。

#### Scenario: catalog 内容不合法

- **WHEN** 某 profile 文件的内容不是合法 JSON，或其顶层值不是对象
- **THEN** 系统报错，消息指出出错的文件路径，且整个 catalog 读取失败

### Requirement: Profile 定义字段

一个 profile 定义 SHALL 是对象，并 SHALL 只包含以下字段：`label`、`description`、`skills`、`extensions`、`mcps`、`tools`、`defaultProvider`、`defaultModel`、`defaultThinkingLevel`、`instructions`。

`skills`、`extensions`、`mcps`、`tools` SHALL 是字符串数组。其余字段 SHALL 是字符串。

全部字段可选。未声明的字段 SHALL NOT 产生任何行为变化。

读取时，未列出的键 SHALL 被忽略。写入时，只有上列字段 SHALL 被写出。

#### Scenario: 字段类型不符

- **WHEN** 某 profile 的 `skills` 含非字符串项，或其 `defaultModel` 不是字符串，或其定义本身不是对象
- **THEN** 系统报错，消息指出该 profile 名与出错字段

#### Scenario: 未声明的字段不影响行为

- **WHEN** 某 profile 只声明 `skills`
- **THEN** 该 profile 的模型、thinking level 与 instructions 保持 Pi 的当前状态

#### Scenario: 未知键被忽略且不写回

- **WHEN** catalog 中某 profile 带一个未列出的键，随后该 profile 被经向导改写
- **THEN** 读取不因该键报错，且写回的文件不含该键

### Requirement: 内建 default profile

系统 SHALL 始终提供名为 `default` 的内建 profile，其来源为 `builtin`，其定义不含任何字段。

`default` MUST NOT 在 catalog 中定义：任何 profiles 目录下存在 `default.json` 均为错误。`default` MUST NOT 可编辑，也 MUST NOT 可删除。

#### Scenario: catalog 中定义 default

- **WHEN** 任一 profiles 目录下存在 `default.json`
- **THEN** 系统报错，消息指出出错的文件路径

### Requirement: Profile 来源与项目覆盖

每个可解析的 profile SHALL 带一个来源，取值为 `builtin`、`global` 或 `project`。全局 catalog 的条目来源为 `global`，项目 catalog 的条目来源为 `project`。

项目条目 SHALL 完整替换同名全局条目，MUST NOT 与之合并或追加任何字段。项目条目被删除后，同名全局条目 SHALL 立即重新可解析。

#### Scenario: 项目条目完整替换全局条目

- **WHEN** 全局与项目 catalog 都定义 `review`，全局声明 `skills: ["a"]`，项目声明 `tools: ["read"]`
- **THEN** 解析 `review` 得到来源 `project`、只含 `tools: ["read"]` 的定义

#### Scenario: 删除项目覆盖条目后全局条目恢复

- **WHEN** 项目 catalog 删除上例中的 `review`
- **THEN** 解析 `review` 得到来源 `global`、全局声明的定义

### Requirement: 项目信任门禁

项目 catalog 的内容 SHALL 只在项目已受信任时参与解析。项目未受信任时，系统 MUST NOT 读取项目 catalog 的任何文件，以项目 scope 的写入 SHALL 失败。

#### Scenario: 未受信任项目不读取 catalog 文件

- **WHEN** 项目未受信任，且该目录下存在 `.pi/profiles/` 目录
- **THEN** 以项目 scope 读取得到空结果、不报错，且该目录中的文件未被读取

#### Scenario: 写入未受信任项目的 catalog

- **WHEN** 以项目 scope 执行任何写入，而项目未受信任
- **THEN** 操作失败，消息指出该目录未受信任

### Requirement: Profile 列表顺序

列表 SHALL 以 `default` 开头，其后按文件名字典序列出全局条目，然后是只存在于项目 catalog 的名字，同样按文件名字典序。

#### Scenario: 列表顺序

- **WHEN** 全局 catalog 含 `b.json`、`a.json`，项目 catalog 含 `c.json`
- **THEN** 列表顺序为 `default`、`a`、`b`、`c`

### Requirement: Profile 创建、编辑与复制

创建 SHALL 在指定 scope 写入一个完整定义；同名 profile 已存在于该 scope 时 SHALL 失败。

编辑 SHALL 替换指定 scope 中一个已存在 profile 的完整定义；该 profile 不在该 scope 时 SHALL 失败。

复制 SHALL 把一个已存在定义的完整副本写入指定 scope 下的新名字；源不存在或新名已存在时 SHALL 失败。

写入前 SHALL 校验定义。校验失败或上述任一前置条件不满足时，profiles 目录 MUST NOT 被改动。

#### Scenario: 目标 scope 已存在同名条目

- **WHEN** 在全局 scope 创建 `review`，或把 `review` 复制为 `implement`，而全局 catalog 已含该目标名
- **THEN** 操作失败，消息指出该名字与 scope，目标文件未改动

#### Scenario: 编辑不在该 scope 的 profile

- **WHEN** 在项目 scope 编辑一个只存在于全局 catalog 的名字
- **THEN** 操作失败，消息指出该名字与 scope

#### Scenario: 非法定义不落地

- **WHEN** 写入一个 `skills` 含非字符串项的定义
- **THEN** 操作失败，目标文件保持原样或不产生

### Requirement: Profile 删除

删除 SHALL 从指定 scope 移除一个 profile。该 profile 不在该 scope 时 SHALL 失败，而不是空操作。

删除当前活动的 profile 时，请求 SHALL 同时指定替代 profile，否则 SHALL 失败。

#### Scenario: 删除不存在的 profile

- **WHEN** 从全局 scope 删除一个不在全局 catalog 中的名字
- **THEN** 操作失败，消息指出该名字

#### Scenario: 删除活动 profile 未指定替代

- **WHEN** 删除当前活动的 profile，且未提供替代 profile
- **THEN** 操作失败，消息要求先选择替代 profile

### Requirement: Catalog 写入

写入 SHALL 只影响目标 profile 自己的文件：创建与编辑写 `<name>.json`，删除移除 `<name>.json`，其余文件 MUST NOT 被改动。文件内容为格式化 JSON 的完整定义，且只包含通过校验的已声明字段。

并发修改 SHALL 按同名单文件最后写入生效处理；不同名字的并发写入互不影响。向导保存 MUST NOT 因目录被其他实例同时修改而阻塞。

#### Scenario: 写入文件结构

- **WHEN** 一次写入完成
- **THEN** 目标 profile 的文件为格式化 JSON，顶层即该 profile 的定义，不含 `schemaVersion` 等信封字段

#### Scenario: 并发编辑后保存

- **WHEN** 向导打开期间，另一个进程向同一 profiles 目录新增了另一个 profile
- **THEN** 保存成功，且被新增的那个 profile 不受影响

### Requirement: 播种 starter profile

安装包时与 launcher 每次启动时，若全局 profiles 目录中尚无任何 profile 文件，系统 SHALL 写入随包提供的 starter profile 文件，其中定义一个名为 `ask` 的 profile。目录中已存在任何 profile 文件时 MUST NOT 覆盖。launcher 启动时的播种 SHALL 在解析初始 profile 之前完成，使播种结果对本次启动可见。播种失败 MUST NOT 使安装或启动失败， SHALL 降级为警告。

#### Scenario: 首次安装

- **WHEN** 全局 `profiles/` 目录不存在或其中没有任何 `.json` 文件
- **THEN** 写入 starter profile 文件 `ask.json`

#### Scenario: 已有 catalog

- **WHEN** 全局 `profiles/` 目录中已存在至少一个 `.json` 文件
- **THEN** 不写入新文件，安装继续

#### Scenario: 启动时补齐

- **WHEN** launcher 启动，且全局 `profiles/` 目录中没有任何 `.json` 文件（如安装期播种被跳过）
- **THEN** 启动流程写入 starter profile 文件 `ask.json`，且该 profile 对本次启动的初始 profile 解析可见

#### Scenario: 启动时不覆盖

- **WHEN** launcher 启动，且全局 `profiles/` 目录中已存在至少一个 `.json` 文件
- **THEN** 不写入新文件，启动继续

#### Scenario: 启动时播种失败降级为警告

- **WHEN** launcher 启动时播种写入失败（如目标目录不可写）
- **THEN** 打印警告，启动继续

### Requirement: 分发 profile-config skill

安装包时与 launcher 每次启动时，系统 SHALL 把随包的 `profile-config` skill 写入用户 agentDir 的 `skills/profile-config/` 目录。该 skill 指导 agent 创建、修改与删除 profile 文件。

该 skill 是普通用户级资源：系统 MUST NOT 为它引入过滤豁免或运行时特判；命名 profile 只在声明引用它时才包含它。

已存在的 skill 文件内容与随包版本不同时 SHALL 覆写为随包版本；内容一致时不写入。分发失败 MUST NOT 使安装或启动失败，SHALL 降级为警告。

#### Scenario: 首次安装

- **WHEN** 用户 agentDir 的 `skills/` 下尚不存在 `profile-config`
- **THEN** 安装写入随包的 skill 文件

#### Scenario: 升级覆写

- **WHEN** 用户 agentDir 的 `skills/profile-config/` 已存在，且内容与随包版本不同
- **THEN** 安装以随包版本覆写

#### Scenario: 分发失败降级为警告

- **WHEN** 安装期写入 skill 文件失败（如目标目录不可写）
- **THEN** 安装降级为警告继续，安装本身不失败

#### Scenario: 启动时补齐或同步

- **WHEN** launcher 启动，且用户 agentDir 的 `skills/profile-config/SKILL.md` 不存在或内容与随包版本不同（如安装期分发被跳过，或包已升级）
- **THEN** 启动流程写入或覆写为随包版本，且该 skill 对本次会话可见

#### Scenario: 启动时内容已一致

- **WHEN** launcher 启动，且 `skills/profile-config/SKILL.md` 内容已与随包版本一致
- **THEN** 不写入文件，启动继续

#### Scenario: 启动时分发失败降级为警告

- **WHEN** launcher 启动时写入 skill 文件失败（如目标目录不可写）
- **THEN** 打印警告，启动继续

### Requirement: Profile 名字约束

Profile 名 SHALL 匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`。读取时，profiles 目录中存在名字非法的 `.json` 文件 SHALL 报错并指明文件路径；写入时，名字非法 SHALL 失败并说明该规则。

仅大小写不同的两个名字在大小写不敏感的文件系统上是同一文件；系统 SHALL NOT 为这种情形提供额外校验。

#### Scenario: 非法名字的文件

- **WHEN** 全局 `profiles/` 目录中存在 `我的 profile.json`
- **THEN** 系统报错，消息指出该文件路径与名字规则

#### Scenario: 写入非法名字

- **WHEN** 创建名为 `foo bar` 的 profile
- **THEN** 操作失败，消息说明允许的名字字符集
