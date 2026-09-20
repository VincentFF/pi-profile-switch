# Spec Delta

## Purpose

定义 profile 从哪里读取、什么内容合法、同名 profile 之间谁生效。它是 profile 选择机制的数据来源：其他三个能力域都从这个能力域解析出的定义出发。

## ADDED Requirements

### Requirement: Catalog 文件位置与发现

系统 SHALL 从两个位置读取 profile 定义：全局 catalog 与项目 catalog。

全局 catalog 位于工作区根下的 `profiles.json`，工作区根默认为 `~/.pi-profile-switch`，可由 `PI_PROFILE_SWITCH_DIR` 覆盖。当该文件不存在时，系统 SHALL 回退读取 `<agentDir>/profiles.json`。

项目 catalog 位于 `<projectDir>/.pi/profiles.json`。

文件不存在 SHALL 被视为空 catalog，而不是错误。

#### Scenario: 全局首选文件缺失时回退到 legacy 路径

- **WHEN** `~/.pi-profile-switch/profiles.json` 不存在，且 `~/.pi/agent/profiles.json` 存在
- **THEN** 系统读取 `~/.pi/agent/profiles.json` 作为全局 catalog

#### Scenario: 工作区根被环境变量覆盖

- **WHEN** 设置了 `PI_PROFILE_SWITCH_DIR`，且该目录下存在 `profiles.json`
- **THEN** 系统读取该文件作为全局 catalog，不读取默认工作区根

### Requirement: Catalog 文件格式校验

系统 SHALL 在 catalog 内容不合法时报错，MUST NOT 静默降级为空 catalog。

顶层值 SHALL 是对象。`schemaVersion` SHALL 等于 `1`。`profiles` SHALL 是对象，其键为 profile 名、值为 profile 定义。JSON 语法 SHALL 合法。

校验失败 SHALL 可行动：错误 SHALL 指明出错的文件路径；字段级错误 SHALL 同时指明 profile 名与字段名。

#### Scenario: catalog 内容不合法

- **WHEN** catalog 的 `schemaVersion` 不为 `1`，或其 `profiles` 不是对象，或其内容不是合法 JSON
- **THEN** 系统报错，消息指出出错的文件路径，且不得到空 catalog

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

`default` MUST NOT 在 catalog 文件中定义。`default` MUST NOT 可编辑，也 MUST NOT 可删除。

#### Scenario: catalog 中定义 default

- **WHEN** 任一 catalog 文件的 `profiles` 含键 `default`
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

项目 catalog 的内容 SHALL 只在项目已受信任时参与解析。项目未受信任时，系统 MUST NOT 读取项目 catalog 文件，以项目 scope 的写入 SHALL 失败。

#### Scenario: 未受信任项目不读取 catalog 文件

- **WHEN** 项目未受信任，且该目录下存在 `.pi/profiles.json`
- **THEN** 以项目 scope 读取得到空结果、不报错，且该文件未被读取

#### Scenario: 写入未受信任项目的 catalog

- **WHEN** 以项目 scope 执行任何写入，而项目未受信任
- **THEN** 操作失败，消息指出该目录未受信任

### Requirement: Profile 列表顺序

列表 SHALL 以 `default` 开头，其后按 catalog 文件中的顺序列出全局条目，然后是只存在于项目 catalog 的名字。

#### Scenario: 列表顺序

- **WHEN** 全局 catalog 依次定义 `b`、`a`，项目 catalog 定义 `c`
- **THEN** 列表顺序为 `default`、`b`、`a`、`c`

### Requirement: Profile 创建、编辑与复制

创建 SHALL 在指定 scope 写入一个完整定义；同名 profile 已存在于该 scope 时 SHALL 失败。

编辑 SHALL 替换指定 scope 中一个已存在 profile 的完整定义；该 profile 不在该 scope 时 SHALL 失败。

复制 SHALL 把一个已存在定义的完整副本写入指定 scope 下的新名字；源不存在或新名已存在时 SHALL 失败。

写入前 SHALL 校验定义。校验失败或上述任一前置条件不满足时，catalog 文件 MUST NOT 被改动。

#### Scenario: 目标 scope 已存在同名条目

- **WHEN** 在全局 scope 创建 `review`，或把 `review` 复制为 `implement`，而全局 catalog 已含该目标名
- **THEN** 操作失败，消息指出该名字与 scope，文件未改动

#### Scenario: 编辑不在该 scope 的 profile

- **WHEN** 在项目 scope 编辑一个只存在于全局 catalog 的名字
- **THEN** 操作失败，消息指出该名字与 scope

#### Scenario: 非法定义不落地

- **WHEN** 写入一个 `skills` 含非字符串项的定义
- **THEN** 操作失败，文件内容保持原样

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

写入 SHALL 以整文件覆盖方式进行，输出为格式化 JSON，且顶层含 `schemaVersion: 1` 与 `profiles`。写入 SHALL 只包含通过校验的已声明字段。

并发修改 SHALL 按整文件最后写入生效处理：写入前读取整个文件，因此一次写入会覆盖其他进程在同一时刻对其他 profile 的改动。向导保存 MUST NOT 因文件被其他实例同时修改而阻塞。

#### Scenario: 写入文件结构

- **WHEN** 一次写入完成
- **THEN** 文件顶层为 `schemaVersion` 与 `profiles`，并包含该次写入的定义

#### Scenario: 并发编辑后保存

- **WHEN** 向导打开期间，另一个进程向同一 catalog 文件新增了另一个 profile
- **THEN** 保存成功，但被新增的那个 profile 不保留在文件中

### Requirement: 安装播种 starter profile

安装包时，若全局工作区还没有 catalog 文件，系统 SHALL 写入随包提供的 starter catalog，其中含一个名为 `ask` 的 profile。已存在 catalog 文件时 MUST NOT 覆盖。legacy 路径 `<agentDir>/profiles.json` 存在时 SHALL 跳过播种。播种失败 MUST NOT 使安装失败。

#### Scenario: 首次安装

- **WHEN** 全局工作区与 legacy 路径都没有 catalog 文件
- **THEN** 写入 starter catalog，其中含 `ask` profile

#### Scenario: 已有 catalog

- **WHEN** 全局工作区已存在 `profiles.json`，或 legacy 路径已存在 catalog 文件
- **THEN** 不写入新文件，安装继续
