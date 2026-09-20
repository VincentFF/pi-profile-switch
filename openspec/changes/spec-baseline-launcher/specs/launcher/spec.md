# Spec Delta

## Purpose

定义 `pi-profile` 启动器在 Pi 进程出现之前做了什么：如何划分哪些参数属于启动器、哪些属于 Pi，如何选定初始 profile，什么情况必须在启动前失败，以及项目资源在什么条件下才被读取。

## ADDED Requirements

### Requirement: CLI 参数解析与透传

启动器的调用形式 SHALL 为 `pi-profile [profile] [--] <pi 参数>...`。

启动器 SHALL 只消费两项输入：一个可选的前导位置参数作为 profile 名（不以 `-` 开头时才算），以及至多一个 `--` 分隔符。该分隔符之后的 `--` 属于 Pi。

其余全部参数 SHALL 原样传给被启动的 Pi 进程，无论 Pi 是否认识它们。profile 名之后的位置参数属于 Pi。

`--approve`、`-a`、`--no-approve`、`-na` SHALL 被识别为一次性的信任输入而不透传。同一输入重复出现且相互矛盾时，SHALL 采用最后一个。

#### Scenario: 位置参数与透传边界

- **WHEN** 以 `pi-profile review -- --model openai/gpt-5.4 extra` 启动
- **THEN** profile 名为 `review`，Pi 收到 `--model openai/gpt-5.4 extra`

#### Scenario: 未知 Pi 参数照样透传

- **WHEN** 用户传入一个 Pi 不认识的 flag
- **THEN** 启动器不拦截也不报错，该 flag 原样到达 Pi

#### Scenario: 信任 flag 被消费且后者优先

- **WHEN** 参数中同时出现 `--approve` 与 `--no-approve`
- **THEN** 两者都不透传给 Pi，启动器采用最后一个作为信任输入

### Requirement: 初始 profile 选择

指定了位置参数时，启动器 SHALL 使用该名字。

未指定位置参数时，启动器 SHALL 依次尝试：受信任项目的已保存选择、全局的已保存选择、内建 `default`。

位置参数指定的名字不存在时，SHALL 在启动 Pi 之前失败。由已保存状态恢复的名字不存在时，SHALL 回退到 `default` 并给出警告，MUST NOT 阻止启动。

通过 CLI 指定的初始选择 SHALL NOT 被写入运行时状态。

#### Scenario: 位置参数指定未知 profile

- **WHEN** 以 `pi-profile nosuchprofile` 启动
- **THEN** 启动失败，错误指明该名字，Pi 进程未被创建

#### Scenario: 保存的选择已失效

- **WHEN** 未指定位置参数，且已保存的活动 profile 在 catalog 中已不存在
- **THEN** 启动继续，使用 `default`，并输出一条说明回退的警告

#### Scenario: 受信任项目的保存选择优先

- **WHEN** 未指定位置参数，项目已受信任且项目状态中有活动 profile，全局状态中也有另一个
- **THEN** 使用项目状态中的活动 profile

### Requirement: 启动前失败与退出码

下列失败 SHALL 在 Pi 进程创建之前终止启动：未知 profile、不可解析的引用、声明了 MCP server 而 adapter 不可用、catalog 内容不合法、MCP 配置内容不合法、声明的模型未通过校验。

上述失败 SHALL 以退出码 `2` 结束。其他未预期的失败 SHALL 以退出码 `1` 结束。失败信息 SHALL 写入 stderr。

#### Scenario: 声明的模型未认证

- **WHEN** profile 声明的模型不存在或未认证
- **THEN** 启动以退出码 `2` 结束，且 Pi 进程未被创建

#### Scenario: catalog 内容损坏

- **WHEN** catalog 文件内容不合法
- **THEN** 启动以退出码 `2` 结束，错误指明文件路径

### Requirement: 项目信任守门

项目范围的一切——catalog、运行时状态、资源、MCP 配置——SHALL 只在项目已受信任时才被读取。

信任判定 SHALL 按以下顺序取第一个成立的结果：一次性的 `--approve` 或 `--no-approve` 输入；项目不含任何需要信任的资源时视为受信任；真实 `trust.json` 中最近祖先的已存储决定；用户的全局 `defaultProjectTrust` 设置为 `always`；否则不受信任。

需要信任的项目资源 SHALL 包括 pi-profile 自己的项目文件 `<projectDir>/.pi/profiles.json` 与 `<projectDir>/.pi/pi-profile-state.json`。

信任判定 MUST NOT 执行任何 extension 代码。

`default` profile SHALL 保持 Pi 原生的信任行为：启动器记录的信任 flag SHALL 重新附加给 Pi 进程。命名 profile MUST NOT 转发该 flag。

#### Scenario: 一次性信任输入优先于已存储决定

- **WHEN** `trust.json` 对当前项目记录了不受信任，而本次启动带 `--approve`
- **THEN** 项目资源在本次启动可读

#### Scenario: 项目的 defaultProjectTrust 为 ask

- **WHEN** 用户全局设置为 `ask`，且 `trust.json` 无当前项目的记录
- **THEN** 项目视为不受信任，项目范围的文件与资源都不被读取

#### Scenario: 只存在 pi-profile 的项目文件

- **WHEN** 项目目录下只有 `.pi/profiles.json` 而没有 Pi 认识的项目资源
- **THEN** 该项目仍被判定为含需要信任的资源，不因"没有项目资源"而自动受信任

### Requirement: 启动诊断输出

启动器 SHALL 把非致命的诊断信息输出到 stderr 并继续启动：extension 发现的警告，以及解析阶段零匹配的 glob 引用。

#### Scenario: 零匹配 glob

- **WHEN** profile 的某个 glob 引用本次解析零匹配
- **THEN** 启动继续，stderr 输出一条指明该引用零匹配的警告

### Requirement: instance 目录契约

启动器 SHALL 为本次启动生成一个 instance 目录，路径为 `<PI_PROFILE_SWITCH_DIR>/instances/<profile>/agent`，工作区根默认为 `~/.pi-profile-switch`。同一 profile 的多次启动 SHALL 复用同一路径。

该目录 SHALL 通过 `PI_CODING_AGENT_DIR` 交给 Pi 进程。启动器 SHALL 从子进程环境中移除 `PI_CODING_AGENT_SESSION_DIR`，使 session 存储由该 instance 决定；instance 的 `sessions` 是真实 agentDir 对应目录的镜像。

instance 中的受管文件（`settings.json`、`pi-profile.json`、`mcp.json`、`APPEND_SYSTEM.md`、`trust.json`、`pid`、`extensions`）由 pi-profile 生成。真实 agentDir 下的其余文件与目录 SHALL 以符号链接镜像进 instance，并在链接时清理已失效的链接。

`trust.json` SHALL 只在 `default` profile 下链接；命名 profile MUST NOT 链接它。

用户配置文件 MUST NOT 被修改。

#### Scenario: instance 路径按 profile 固定

- **WHEN** 连续两次以同一个 profile 启动
- **THEN** 两次使用同一个 instance 路径

#### Scenario: 未受限制时 MCP 配置直接链接

- **WHEN** profile 不声明 `mcps`，且真实 agentDir 下存在 `mcp.json`
- **THEN** instance 的 `mcp.json` 是指向该文件的符号链接，内容未被改写

#### Scenario: 命名 profile 不链接 trust.json

- **WHEN** 以命名 profile 启动
- **THEN** instance 内不存在 `trust.json` 链接

### Requirement: 子进程启动

启动器 SHALL 启动真实的 Pi 二进制，并以 `-e` 参数加载随包提供的 pi-profile extension。用户参数 SHALL 原样追加在 extension 参数之后。

启动器 SHALL 转发子进程的退出码，并把信号转发给子进程。

#### Scenario: 参数顺序

- **WHEN** 启动器构建 Pi 的 argv
- **THEN** 依序为 extension 参数、`default` profile 下的信任 flag、用户参数

#### Scenario: 退出码转发

- **WHEN** Pi 子进程以退出码 N 结束
- **THEN** 启动器以退出码 N 结束
