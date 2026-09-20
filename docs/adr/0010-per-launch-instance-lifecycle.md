# instance 生命周期为一次启动

子进程宿主与生成式 settings 见 [ADR-0005](0005-subprocess-host-with-generated-settings.md)。

## 背景

instance 的定义是"为一次 Pi 进程生成的运行时目录"，实现却曾把它固定成 `instances/<profile>/agent`，同一 profile 每次启动复用同一路径。三种后果同时存在：同一 profile 并发启动会互相重写受管文件与 `pid`；会话内切换只能就地重写（`PI_CODING_AGENT_DIR` 在进程内不可变更），切换后目录名与内容不符；目录复用意外地给"运行时新建的第三方状态"提供了持久性，使 pi-subagents 的 mission store 被按 profile 复制成互不相干的多份。

instance 的内容分三类：pi-profile 生成的受管文件、指向真实 agentDir 的符号链接、以及**运行时在 instance 内新建的条目**。第三类不在镜像快照里，此前只靠目录复用才活下来。

## 决策

instance 目录与一次启动绑定：每次启动生成唯一目录 `instances/launch-<随机标识>`，它就是交给 Pi 的 agentDir，同一 profile 不复用路径。回收由启动清扫承担，退出时不删除：

| 判定 | 结果 |
| --- | --- |
| `pid` 可解析且进程存活（含存在但不可发信号） | 保留 |
| `pid` 可解析且进程不存在 | 回收 |
| `pid` 缺失或不可解析，mtime 超过宽限期 | 回收 |
| 目录含 pi-profile 未生成的条目 | 保留并输出警告 |
| 非 `launch-` 形态的目录 | 不删除 |

运行时新建的状态用软链锚回真实 agentDir：镜像前在真实 agentDir 下确保 `missions` 目录存在，它因此以符号链接进入 instance，第三方从第一次启动起写入的就是真实路径。判定"未识别条目"时**不**比对真实 agentDir，只看条目本身是否由 pi-profile 生成。

## 被否方案

**持久 per-profile 目录**。同一 profile 的并发启动共享一个目录，会话内切换会改到别的会话正在使用的文件；目录名在切换后与内容不符。"内容每次整目录替换"救不了，冲突来自共享路径本身。

**回收时吸收**（把未识别条目搬进真实 agentDir）。第三方记录里带着指向 instance 的绝对路径：pi-subagents 台账的 `recordPath`、记录的 `ownerSessionId` 与 artifacts 路径。搬走之后台账会把指针当 stale 清空；要修就得改写第三方文件格式，还要一套冲突合并策略。

**把 `missions` 指向项目 `.pi/subagents/missions`**。launcher 会替项目建文件，未受信任的项目也不例外，破坏信任守门，也违背 pi-subagents 把 store 放在 agentDir 以保持工作区干净的选择。

**枚举更多第三方状态目录进 seed 名单**。名单是兼容债：扩展换路径时 seed 会静默失效，而静默失效最不可接受。只收录有观察证据的条目，未收录的由"未识别条目"警告兜住。

**退出时删除 instance 目录**。任何退出方式都会结束 pid，下次启动的清扫必然收敛；把删除放到退出路径只换来即时干净，代价是在信号路径上引入删除逻辑。

## 代价

- 未识别条目判定会保留死目录并在每次启动重复警告，直到用户处理；这是刻意的：宁可留着并告知，也不静默销毁第三方数据。
- seed 名单随第三方改路径而静默失效，只能靠上述警告变成可见失败。
- `missions` 会在真实 agentDir 下被创建（原生 Pi 也会创建它），因此该状态跨 profile 共享而非隔离。
- 0.4.x 遗留的 `instances/<profile>/agent` 目录不清理、不迁移；其中的 mission 记录带旧绝对路径，只能由用户自行处置。
- PID 复用会让本应回收的目录暂时保留，直到该 pid 结束。
