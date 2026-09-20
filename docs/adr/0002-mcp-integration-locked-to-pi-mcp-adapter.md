# MCP 集成锁定 pi-mcp-adapter

## 背景

MCP server 的连接参数、OAuth 与 token 是凭据，不是 profile 的资源配置。pi-profile 需要按 profile 限制可用 server，但不应该自己实现 server 管理。

## 决策

MCP 支持完全委托给可选的 `pi-mcp-adapter` 包。profile 的 `mcps` 数组只声明启用哪些 server，并作为该 profile 的持久存储；连接参数、OAuth 与 token 全部留在 adapter 配置里，pi-profile 从不写入。

pi-profile 不注册 `/mcp` 命令，不占用该命名空间。

## 被否方案

**pi-profile 自己管理 MCP 配置。** 否掉的理由：会把 server 管理从 adapter 的单一实现分叉出去，并把凭据引进 profile catalog。

**曾实现的 `/mcp enable|disable` 命令已撤销。** 注册 `/mcp` 会与 `pi-mcp-adapter` 的原生命令命名空间冲突并劫持其 TUI setup、status、tools、reconnect 等子命令。所有 `/mcp` 命令返回 adapter。

## 代价

- profile 声明了 `mcps` 而 adapter 未安装时，该 profile 激活失败。不含 `mcps` 的 profile 不依赖 adapter。
- profile 只能声明启用哪些 server，不能声明 server 的连接方式；新增或修改 server 必须走 adapter 自己的配置面。
