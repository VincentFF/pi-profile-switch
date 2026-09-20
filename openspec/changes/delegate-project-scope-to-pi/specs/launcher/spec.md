# Spec Delta

## MODIFIED Requirements

### Requirement: 项目信任守门

项目范围中由 pi-profile 自己读取的内容——项目 catalog、项目运行时状态、项目 MCP 配置——SHALL 只在项目已受信任时才被读取。

项目级资源（`.pi/skills`、`.pi/extensions`、ancestor `.agents/skills`、`.pi/prompts`、`.pi/themes`、`.pi/settings.json`）的可见性 SHALL 由 Pi 自己按项目信任判定决定。pi-profile MUST NOT 通过 Generated settings 收窄、附加或排除这些资源。

信任判定 SHALL 按以下顺序取第一个成立的结果：一次性的 `--approve` 或 `--no-approve` 输入；项目不含任何需要信任的资源时视为受信任；真实 `trust.json` 中最近祖先的已存储决定；用户的全局 `defaultProjectTrust` 设置为 `always`；否则不受信任。

需要信任的项目资源 SHALL 包括 pi-profile 自己的项目文件 `<projectDir>/.pi/profiles.json` 与 `<projectDir>/.pi/pi-profile-state.json`。

信任判定 MUST NOT 执行任何 extension 代码。

启动器记录的信任 flag SHALL 重新附加给被启动的 Pi 进程，且 SHALL 对所有 profile 一致：一次性信任输入在任何 profile 下都 SHALL 同时决定项目 catalog 的可读性与 Pi 的项目级可见性，MUST NOT 出现两者分歧。

#### Scenario: 一次性信任输入优先于已存储决定

- **WHEN** `trust.json` 对当前项目记录了不受信任，而本次启动带 `--approve`
- **THEN** 项目资源在本次启动可读

#### Scenario: 命名 profile 同样转发信任 flag

- **WHEN** 以 `pi-profile doc -- --no-approve` 启动
- **THEN** Pi 进程收到 `--no-approve`，且该 flag 不出现在用户参数中

#### Scenario: 项目的 defaultProjectTrust 为 ask

- **WHEN** 用户全局设置为 `ask`，且 `trust.json` 无当前项目的记录
- **THEN** 项目 catalog 与项目运行时状态都不被读取，命名 profile 的项目级资源也不可见

#### Scenario: 只存在 pi-profile 的项目文件

- **WHEN** 项目目录下只有 `.pi/profiles.json` 而没有 Pi 认识的项目资源
- **THEN** 该项目仍被判定为含需要信任的资源，不因"没有项目资源"而自动受信任

### Requirement: instance 目录契约

启动器 SHALL 为本次启动生成一个 instance 目录，路径为 `<PI_PROFILE_SWITCH_DIR>/instances/launch-<随机标识>`，工作区根默认为 `~/.pi-profile-switch`。每次启动 SHALL 使用此前不存在的路径，同一 profile 的多次启动 MUST NOT 复用同一路径。

该目录 SHALL 通过 `PI_CODING_AGENT_DIR` 交给 Pi 进程。启动器 SHALL 从子进程环境中移除 `PI_CODING_AGENT_SESSION_DIR`，使 session 存储由该 instance 决定；instance 的 `sessions` 是真实 agentDir 对应目录的镜像。

instance 中的受管文件（`settings.json`、`pi-profile.json`、`mcp.json`、`APPEND_SYSTEM.md`、`trust.json`、`pid`、`extensions`）由 pi-profile 生成；`pid` SHALL 记录本次启动的 Pi 子进程号。真实 agentDir 下的其余文件与目录 SHALL 以符号链接镜像进 instance，并在链接时清理已失效的链接。

`trust.json` SHALL 是指向真实 agentDir 对应路径的符号链接，且 SHALL 对每一种 profile 都成立：MUST NOT 因为 profile 不是 `default` 而省略或移除，也 MUST NOT 因为目标文件尚不存在而不建立（Pi 通过该链接写入的信任决定落在真实 agentDir）。

profile 声明了 `mcps` 时，instance 的 `mcp.json` SHALL 是生成的过滤结果，只包含被允许的 server 定义。对于用户级共享位置（`~/.config/mcp/mcp.json`、`~/.agents/mcp.json`、`~/.agents/mcp/mcp.json`）里未被允许的 server，instance 配置 SHALL 显式标记其被禁用，MUST NOT 仅靠省略：这些位置由 adapter 直接读取，不省略不标记就不会失效。项目级位置（项目 `.mcp.json`、项目 `.pi/mcp.json`）定义的 server SHALL 保持启用，MUST NOT 被标记禁用。

用户配置文件 MUST NOT 被修改。

#### Scenario: instance 路径按 profile 固定

- **WHEN** 连续两次以同一个 profile 启动
- **THEN** 两次使用不同的 instance 路径（scenario 名沿用旧契约的措辞，断言已反转）

#### Scenario: 未受限制时 MCP 配置直接链接

- **WHEN** profile 不声明 `mcps`，且真实 agentDir 下存在 `mcp.json`
- **THEN** instance 的 `mcp.json` 是指向该文件的符号链接，内容未被改写

#### Scenario: 命名 profile 不链接 trust.json

- **WHEN** 以命名 profile 启动
- **THEN** instance 内存在 `trust.json` 链接，且它指向真实 agentDir 对应路径（scenario 名沿用旧契约的措辞，断言已反转）

#### Scenario: 受限的 MCP 配置令未选中的共享 server 失效

- **WHEN** profile 声明 `mcps` 只允许 server A，而用户级共享配置中还定义了 server B
- **THEN** instance 的 `mcp.json` 含 A 的定义，并以禁用标记含 B，B 不连接

#### Scenario: 项目来源的 MCP server 不被禁用

- **WHEN** profile 声明 `mcps` 只允许 server A，而项目 `.mcp.json` 定义了 server P
- **THEN** instance 的 `mcp.json` 中 P 不带禁用标记，P 仍可用

### Requirement: 子进程启动

启动器 SHALL 启动真实的 Pi 二进制，并以 `-e` 参数加载随包提供的 pi-profile extension。用户参数 SHALL 原样追加在 extension 参数之后。

启动器 SHALL 转发子进程的退出码，并把信号转发给子进程。

#### Scenario: 参数顺序

- **WHEN** 启动器构建 Pi 的 argv
- **THEN** 依序为 extension 参数、记录到的一次性信任 flag（存在时）、用户参数

#### Scenario: 退出码转发

- **WHEN** Pi 子进程以退出码 N 结束
- **THEN** 启动器以退出码 N 结束
