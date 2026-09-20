# in-session-switch Specification

## Purpose
定义 Pi 进程内 `/profile` 命令族的行为：切换如何在不重启进程的前提下替换资源、失败时如何回到切换前的状态、overlay 的范围与生命周期、以及运行时状态写在哪里。

## Requirements

### Requirement: /profile 命令族与模式门禁

`/profile` SHALL 接受以下子命令：裸调用（打开选择器）、`use`、`reload`、`customize`、`reset`、`list`、`status`、`create`、`edit`、`delete`、`duplicate`。

未知子命令 SHALL 被拒绝并给出用法说明。`use` 缺少名字、`edit` 与 `delete` 缺少名字时 SHALL 被拒绝并给出该子命令的用法。

`create`、`edit`、`delete`、`duplicate` SHALL 只在 TUI 模式下提供；其他模式下 SHALL 被拒绝，且错误说明当前模式。

`use`、`reload`、`customize`、`reset`、`list`、`status` 与裸调用 SHALL 在非 TUI 模式下同样可用。

#### Scenario: CRUD 在非 TUI 模式被拒绝

- **WHEN** 在 RPC 模式执行 `/profile create`
- **THEN** 操作被拒绝，错误指出该子命令需要 TUI 模式并给出当前模式名，且没有 catalog 被改动

#### Scenario: 未知子命令

- **WHEN** 执行 `/profile frobnicate`
- **THEN** 操作被拒绝并输出用法说明

### Requirement: 会话内切换

`/profile use <name>` SHALL 依次执行：等待当前 agent turn 结束、快照运行时文件、按完整启动路径重新解析目标 profile、就地重写运行时文件、触发 Pi 的原生 reload。

等待 SHALL 使用 Pi 原生的空闲等待，MUST NOT 打断正在进行的 turn。

重新解析 SHALL 包含与启动路径相同的校验：信任判定、catalog 读取、资源发现、模型与 MCP 校验。解析失败时 SHALL NOT 写入任何运行时文件，运行时保持切换前的状态。

切换 SHALL NOT 重启 Pi 进程；当前 session 的 sessionId 与消息历史 SHALL 保持不变。

切换 SHALL NOT 改变 Pi 的项目信任输入：instance 的 `trust.json` 链接形态在切换前后相同，项目级资源的可见性因此在同一进程内保持稳定。切换后的项目级可见性 SHALL 与直接以目标 profile 启动一致，MUST NOT 需要重启进程才生效。

`/profile use` SHALL 保存该选择，并 SHALL 丢弃切换前 profile 的 overlay。

`/profile reload` SHALL 走同一路径，但 SHALL NOT 产生变更摘要，并 SHALL 保持当前 profile 既有的选择持久性不变（启动时的一次性选择在 reload 后仍是一次性的）。

#### Scenario: 切换成功

- **WHEN** 执行 `/profile use implement`，且解析与 reload 都成功
- **THEN** 运行时文件被重写为该 profile 的解析结果，session 未中断

#### Scenario: 项目级可见性不因切换而改变

- **WHEN** 项目已受信任，以命名 profile 启动后执行 `/profile use default`
- **THEN** 项目级 skill 与 extension 在两个 profile 下都可见，进程未重启，sessionId 与消息历史不变

#### Scenario: 解析阶段失败

- **WHEN** 目标 profile 的引用无法解析
- **THEN** 操作失败并报告原因，运行时文件未被改动

#### Scenario: reload 保持一次性选择

- **WHEN** 以 `pi-profile review` 启动（一次性选择），随后执行 `/profile reload`
- **THEN** 仍运行 `review`，且该选择不因此被写入运行时状态

### Requirement: 切换失败回滚

reload 失败时 SHALL 恢复快照中的运行时文件并再次 reload，然后报告失败原因。runtime MUST NOT 停留在半切换状态。

PI 的交互模式可能吞掉 reload 的拒绝或失败而不报错。因此切换 SHALL 在 reload 之后验证它确实执行过；未能证明时 SHALL 按失败处理并回滚。

恢复 SHALL 精确还原快照：不存在、符号链接目标、文件内容与权限位都被还原，MUST NOT 通过遗留的符号链接写到链接目标。

选择与 overlay 的持久化 SHALL 发生在 reload 之后的 extension 实例中，因此回滚 MUST NOT 需要撤销状态文件的写入。

#### Scenario: reload 报错

- **WHEN** reload 抛出错误
- **THEN** 运行时文件被还原为切换前的内容，并再次 reload，错误说明目标 profile 激活失败及其原因

#### Scenario: reload 被静默跳过

- **WHEN** reload 既未报错也没有真正重新执行 extension
- **THEN** 按失败处理并回滚，报告 reload 未执行

### Requirement: session start 的 plan 应用与变更摘要

每次 session start（启动、reload、新建、恢复、fork）SHALL 应用当前运行时目录中的 plan：按 profile 的原始 tool 引用对 Pi 当时的实时工具注册表展开，并把展开结果设为活动工具集合。

对实时注册表零匹配的 tool 字面量 SHALL 以警告报告出来，MUST NOT 静默丢弃。

plan 标记了选择持久化时，本次 session start 若由 reload 触发，SHALL 把活动 profile 写入该 profile 来源 scope 的状态文件。

切换产生的变更摘要 SHALL 注入下一个 agent turn，且 SHALL 只出现一次：标记在注入后被清除，后续 reload 不再重复。

#### Scenario: 工具白名单在 reload 后重新生效

- **WHEN** reload 后新 extension 实例执行 session start
- **THEN** 活动工具集合被重设为按原始引用对实时注册表展开的结果

#### Scenario: 变更摘要只出现一次

- **WHEN** 一次成功切换之后又执行了 `/profile reload`
- **THEN** 只有切换后的第一个 turn 收到变更摘要

#### Scenario: 状态写入不覆盖 overlay

- **WHEN** reload 后的实例根据 plan 写入活动 profile
- **THEN** 状态文件中已有的 overlay 保持不变，除非本次切换明确要求丢弃它

### Requirement: Runtime overlay

overlay SHALL 只作用于当前 runtime，MUST NOT 被写入任何 catalog 文件。

overlay SHALL 能够禁用当前 profile 已解析出的 skill、extension 与 MCP server，并能够替换 tool 引用集合。

禁用未被当前 profile 解析出的资源 SHALL 失败，并指明该名字。

`/profile customize` SHALL 先以候选 overlay 重新解析（校验在此发生），再切换并 reload，最后才把 overlay 写入状态文件。切换失败时已存储的 overlay SHALL 保持不变。

`/profile reset` SHALL 先在不带 overlay 的情况下切换并 reload，再删除状态文件中的 overlay。切换回滚时已存储的 overlay 仍 SHALL 与已还原的 runtime 一致。

启动 SHALL 忽略已存储的 overlay：overlay MUST NOT 跨 runtime 存活。

`default` profile 默认不过滤。被 overlay 收窄时 SHALL 成为「全部资源减去被禁用项」的选择，因此其中的 skill、extension 与 tool 都可以被禁用。`default` profile 的 MCP 禁用 SHALL 被拒绝——它没有 MCP 白名单可收窄。

#### Scenario: overlay 不写 catalog

- **WHEN** 执行 `/profile customize disable skill git-commit`
- **THEN** 该 skill 在当前 runtime 中不再活动，而 catalog 文件内容未改变

#### Scenario: 禁用未解析出的资源

- **WHEN** 禁用当前 profile 未解析出的 skill、extension 或 MCP server
- **THEN** 操作失败，错误指明该名字

#### Scenario: reset 恢复定义

- **WHEN** 存在 overlay 时执行 `/profile reset`
- **THEN** runtime 恢复为 profile 定义的内容，且状态文件中的 overlay 被删除

#### Scenario: default profile 的 MCP 禁用被拒绝

- **WHEN** 对 `default` profile 执行禁用某个 MCP server 的 overlay
- **THEN** 操作失败，错误说明该 profile 没有 MCP 白名单可收窄

### Requirement: 运行时状态

运行时状态 SHALL 存放在状态文件中：项目 scope 为 `<projectDir>/.pi/pi-profile-state.json`，全局 scope 为工作区根下的 `pi-profile-state.json`。

写入位置 SHALL 由活动 profile 的来源 scope 决定；内建 `default` SHALL 视为全局 scope。

状态 SHALL 保存活动 profile 与 overlay 两项，并可被独立更新：写入其中一项 MUST NOT 抹掉另一项。

状态文件缺失或内容损坏 SHALL 被读作空状态，MUST NOT 报错。除此之外的读取失败 SHALL 传播。

#### Scenario: 更新活动 profile 保留 overlay

- **WHEN** 状态中已有 overlay，随后一次切换仅更新活动 profile
- **THEN** 状态中的 overlay 仍在

#### Scenario: 状态文件损坏

- **WHEN** 状态文件内容不是合法 JSON
- **THEN** 读取得到空状态，启动或切换不因此失败

### Requirement: 观测面

裸 `/profile` SHALL 打开交互式选择器；当前环境不具备可交互 UI 时 SHALL 退化为输出 profile 列表。

`/profile list` SHALL 只列出可见 profile，且 SHALL 与激活使用同一套信任门控：未受信任项目带来的 profile MUST NOT 出现。

列表的每一项 SHALL 报告胜出定义的来源，并在该项目定义遮蔽了同名全局定义时予以标注。

`/profile status` SHALL 报告活动 profile、已存储的 overlay、解析后的资源与路径、MCP server 的三态（已启用、已发现但未启用、被引用但未发现）、以及同名 tool 或 command 冲突与实际胜出结果。

`list` 与 `status` SHALL 以携带结构化负载的消息发出，供非交互消费者读取。

#### Scenario: 未受信任项目的 profile 不可见

- **WHEN** 项目未受信任，且项目 catalog 中存在 profile
- **THEN** 列表与选择器中都不出现该 profile

#### Scenario: 同名项目定义遮蔽全局定义

- **WHEN** 项目与全局 catalog 定义同名 profile
- **THEN** 列表中该条目报告来源为项目，并标注它遮蔽了全局定义

### Requirement: CRUD 对运行时的影响

`create` 与 `duplicate` SHALL 只改动 catalog，MUST NOT 影响当前运行时。

`edit` 修改当前活动 profile 时 SHALL 在保存后立即重新激活；修改非活动 profile 时 MUST NOT 影响运行时。

`delete` 删除当前活动 profile 时，SHALL 在删除前要求选择一个替代 profile 并随后切换到它；若另一 scope 仍持有同名 profile，则 SHALL 重新激活被揭示出的同名定义。

#### Scenario: 编辑非活动 profile

- **WHEN** 编辑一个不是当前活动的 profile
- **THEN** 保存成功，当前 runtime 与活动 profile 不变

#### Scenario: 编辑活动 profile

- **WHEN** 编辑当前活动的 profile 并保存
- **THEN** 保存后立即重新激活该 profile，新的定义生效

#### Scenario: 删除活动 profile

- **WHEN** 删除当前活动的 profile，且该名字不在另一 scope 中
- **THEN** 删除前先要求选择替代 profile，删除后切换到该替代 profile
