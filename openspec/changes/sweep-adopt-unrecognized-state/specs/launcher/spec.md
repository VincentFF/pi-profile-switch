# Spec Delta

## MODIFIED Requirements

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
