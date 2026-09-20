# profile 只引用资源，不复制

## 背景

profile 需要引用 skill、extension、MCP server 与 tool。这些资源在 Pi 中已经存在实现与名称。

## 决策

profile 按名字引用资源，从不复制。一个 `SKILL.md`、extension 或 MCP server 只有一份实现，被所有引用它的 profile 共享。修改实现后，引用方在下一次启动或 reload 得到新内容，profile 定义不需要改动。

## 被否方案

**自包含 profile，把资源副本放进 profile 目录。** 否掉的理由：会把实现分叉成 N 份，修一个 skill 要改 N 个副本；并且破坏用户直接拥有并维护自己资源的前提。

## 代价

- 资源被删除或改名会同时影响所有引用它的 profile。
