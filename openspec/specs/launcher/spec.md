# launcher Specification

## Purpose
定义 `pi-profile` 启动器在 Pi 进程出现之前做了什么：如何划分哪些参数属于启动器、哪些属于 Pi，如何选定初始 profile，什么情况必须在启动前失败，以及项目范围中哪些内容由 pi-profile 读取。

## Requirements

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

### Requirement: 启动诊断输出

启动器 SHALL 把非致命的诊断信息输出到 stderr 并继续启动：extension 发现的警告，以及解析阶段零匹配的 glob 引用。

#### Scenario: 零匹配 glob

- **WHEN** profile 的某个 glob 引用本次解析零匹配
- **THEN** 启动继续，stderr 输出一条指明该引用零匹配的警告

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

### Requirement: 陈旧 instance 清扫

启动器 SHALL 在生成本次 instance 之前清扫 instance 根 `<PI_PROFILE_SWITCH_DIR>/instances` 下的陈旧目录，且 SHALL 只回收自己生成的 instance 目录形态；根下的其他目录 MUST NOT 被删除。

是否回收一个 instance 目录 SHALL 按以下顺序判定：`pid` 可解析且对应进程存活（含进程存在但不可发信号）时保留；`pid` 可解析且进程不存在时回收；`pid` 缺失或不可解析时，仅当目录 mtime 距当前超过宽限期才回收。

对判定可回收的 instance 目录，启动器 SHALL 逐个检查第一层中 pi-profile 未生成的条目（既不是符号链接，也不是受管生成物），并按内容分流处置：

- 条目为常规文件或目录，其内容未引用其所在 instance 的路径（目录递归检查其全部内容，超过扫描上限视为无法判定），且真实 agentDir 无同名条目时，启动器 SHALL 把它搬入真实 agentDir（收养），并在 stderr 输出一行指明条目与去向的 notice。
- 条目满足上述条件但真实 agentDir 已有同名条目时，启动器 SHALL 删除 instance 内副本（真实 agentDir 优先），并在 stderr 输出一行指明条目的 notice。该分支 SHALL NOT 比较两侧内容。
- 条目内容引用了其所在 instance 的路径、超过扫描上限无法判定、或条目不是常规文件或目录时，启动器 SHALL 保留该条目并在 stderr 输出警告；警告 SHALL 指明目录、未识别条目与可处置方式。

受管目录 `extensions/` 内部的未识别条目 SHALL 只按上一条的警告处理，MUST NOT 被收养或删除。

存在任何被保留的未识别条目时，该 instance 目录 SHALL 整体保留；全部未识别条目都被收养或删除后，该目录 SHALL 被回收。

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

- **WHEN** 一个待回收的 instance 目录内含未识别条目，且其内容引用了该 instance 的路径、超过扫描上限无法判定、或不是常规文件或目录
- **THEN** 该目录被保留，stderr 输出指明该目录与条目的警告（scenario 名沿用旧契约的措辞，条件已收窄为不可收养的子集）

#### Scenario: 未识别条目被收养进真实 agentDir

- **WHEN** 一个待回收的 instance 目录内含未识别条目，其内容未引用该 instance 的路径，且真实 agentDir 下没有同名条目
- **THEN** 该条目被搬入真实 agentDir，stderr 输出一行 notice；目录内无其余被保留条目时，该目录被回收

#### Scenario: 真实 agentDir 已有同名条目时删除实例副本

- **WHEN** 一个待回收的 instance 目录内含未识别条目，其内容未引用该 instance 的路径，但真实 agentDir 下已有同名条目
- **THEN** instance 内副本被删除且不做内容比较，stderr 输出一行 notice；目录内无其余被保留条目时，该目录被回收

#### Scenario: 受管目录内部的未识别条目只告警

- **WHEN** 一个待回收的 instance 目录的受管目录 `extensions/` 内含未识别条目
- **THEN** 该条目不被收养也不被删除，该目录被保留，stderr 输出指明该条目的警告

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

### Requirement: 子进程启动

启动器 SHALL 启动真实的 Pi 二进制，并以 `-e` 参数加载随包提供的 pi-profile extension。用户参数 SHALL 原样追加在 extension 参数之后。

启动器 SHALL 转发子进程的退出码，并把信号转发给子进程。

#### Scenario: 参数顺序

- **WHEN** 启动器构建 Pi 的 argv
- **THEN** 依序为 extension 参数、记录到的一次性信任 flag（存在时）、用户参数

#### Scenario: 退出码转发

- **WHEN** Pi 子进程以退出码 N 结束
- **THEN** 启动器以退出码 N 结束
