# Spec Delta

## MODIFIED Requirements

### Requirement: instance 目录契约

启动器 SHALL 为本次启动生成一个 instance 目录，路径为 `<PI_PROFILE_SWITCH_DIR>/instances/launch-<随机标识>`，工作区根默认为 `~/.pi-profile-switch`。每次启动 SHALL 使用此前不存在的路径，同一 profile 的多次启动 MUST NOT 复用同一路径。

该目录 SHALL 通过 `PI_CODING_AGENT_DIR` 交给 Pi 进程。启动器 SHALL 从子进程环境中移除 `PI_CODING_AGENT_SESSION_DIR`，使 session 存储由该 instance 决定；instance 的 `sessions` 是真实 agentDir 对应目录的镜像。

instance 中的受管文件（`settings.json`、`pi-profile.json`、`mcp.json`、`APPEND_SYSTEM.md`、`trust.json`、`pid`、`extensions`）由 pi-profile 生成；`pid` SHALL 记录本次启动的 Pi 子进程号。真实 agentDir 下的其余文件与目录 SHALL 以符号链接镜像进 instance，并在链接时清理已失效的链接。

`trust.json` SHALL 只在 `default` profile 下链接；命名 profile MUST NOT 链接它。

profile 声明了 `mcps` 时，instance 的 `mcp.json` SHALL 是生成的过滤结果，只包含被允许的 server 定义。对于配置来源中的共享位置（用户级标准 MCP 配置、项目 `.mcp.json`）里未被允许的 server，instance 配置 SHALL 显式标记其被禁用，MUST NOT 仅靠省略：这些位置由 adapter 直接读取，不省略不标记就不会失效。

用户配置文件 MUST NOT 被修改。

#### Scenario: instance 路径按 profile 固定

- **WHEN** 连续两次以同一个 profile 启动
- **THEN** 两次使用不同的 instance 路径（scenario 名沿用旧契约的措辞，断言已反转）

#### Scenario: 未受限制时 MCP 配置直接链接

- **WHEN** profile 不声明 `mcps`，且真实 agentDir 下存在 `mcp.json`
- **THEN** instance 的 `mcp.json` 是指向该文件的符号链接，内容未被改写

#### Scenario: 命名 profile 不链接 trust.json

- **WHEN** 以命名 profile 启动
- **THEN** instance 内不存在 `trust.json` 链接

#### Scenario: 受限的 MCP 配置令未选中的共享 server 失效

- **WHEN** profile 声明 `mcps` 只允许 server A，而用户级共享配置中还定义了 server B
- **THEN** instance 的 `mcp.json` 含 A 的定义，并以禁用标记含 B，B 不连接

## ADDED Requirements

### Requirement: 陈旧 instance 清扫

启动器 SHALL 在生成本次 instance 之前清扫 instance 根 `<PI_PROFILE_SWITCH_DIR>/instances` 下的陈旧目录，且 SHALL 只回收自己生成的 instance 目录形态；根下的其他目录 MUST NOT 被删除。

是否回收一个 instance 目录 SHALL 按以下顺序判定：`pid` 可解析且对应进程存活（含进程存在但不可发信号）时保留；`pid` 可解析且进程不存在时回收；`pid` 缺失或不可解析时，仅当目录 mtime 距当前超过宽限期才回收。

目录内含 pi-profile 未生成的条目（既不是符号链接，也不是受管生成物，包括受管目录内部的条目）时，启动器 SHALL 保留该目录并在 stderr 输出警告；警告 SHALL 指明目录、未识别条目与可处置方式。

清扫 SHALL 是尽力而为的：单个目录出错 MUST NOT 中断清扫或阻止启动。退出时 SHALL NOT 删除 instance 目录，回收只发生在后续启动的清扫。

#### Scenario: pid 存活时保留

- **WHEN** instance 目录的 `pid` 指向一个仍在运行的进程
- **THEN** 该目录不被回收

#### Scenario: pid 已退出时回收

- **WHEN** instance 目录的 `pid` 指向的进程已不存在
- **THEN** 该目录被回收

#### Scenario: 无 pid 的目录在宽限期内保留

- **WHEN** instance 目录没有 `pid` 文件，且其 mtime 在宽限期内
- **THEN** 该目录不被回收

#### Scenario: 含未识别条目时保留并告警

- **WHEN** 一个待回收的 instance 目录内含真实 agentDir 没有、pi-profile 也未生成的条目
- **THEN** 该目录被保留，stderr 输出指明该目录与条目的警告

#### Scenario: 非本次形态的目录不被删除

- **WHEN** instance 根下存在不符合本次生成形态的目录
- **THEN** 该目录不被删除，也不影响本次启动

### Requirement: instance 运行时状态 seed

在把真实 agentDir 镜像进 instance 之前，启动器 SHALL 把 Pi 在运行时创建的状态路径指向真实 agentDir，使这些写入不落在 instance 内：

| 路径 | 形态 | seed 方式 |
| --- | --- | --- |
| `sessions`、`missions` | 目录 | 真实 agentDir 下缺失时创建，已存在时保持原样；启动器 MUST NOT 写入其内容 |
| `auth.json`、`models-store.json` | 文件 | instance 内建立指向真实 agentDir 对应路径的符号链接；目标文件不存在时 SHALL 同样建立 |

对文件类路径，启动器 SHALL NOT 因为真实 agentDir 下没有对应文件而删除 instance 内的该链接，也 MUST NOT 自己创建或写入该文件；文件的内容与格式由 Pi 决定。

未被 seed 的路径仍按「陈旧 instance 清扫」处理。

#### Scenario: 首次启动即建立软链

- **WHEN** 真实 agentDir 下不存在 `missions` 目录时启动任一 profile
- **THEN** 真实 agentDir 下出现 `missions` 目录，且 instance 内 `missions` 是指向它的符号链接

#### Scenario: 已存在时不改写

- **WHEN** 真实 agentDir 下已存在含记录的 `missions` 目录
- **THEN** 该目录内容不变，instance 内 `missions` 是它的符号链接

#### Scenario: 目标文件尚不存在时仍建立软链

- **WHEN** 真实 agentDir 下不存在 `auth.json` 时启动任一 profile
- **THEN** instance 内 `auth.json` 是指向真实 agentDir 对应路径的符号链接，且真实 agentDir 下没有被创建出来的 `auth.json`

#### Scenario: 通过软链写入落在真实 agentDir

- **WHEN** 进程在 instance 内写入 `auth.json`
- **THEN** 真实 agentDir 的 `auth.json` 得到该内容，instance 内该条目仍是符号链接

#### Scenario: 重写同一 instance 目录后软链仍在

- **WHEN** 同一 instance 目录被就地重写（会话内切换）
- **THEN** `auth.json` 与 `models-store.json` 仍是符号链接
