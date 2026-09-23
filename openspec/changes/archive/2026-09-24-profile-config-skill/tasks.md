# Tasks

## 1. Skill 内容

- [x] 1.1 新增 `skills/profile-config/SKILL.md`：frontmatter `name` 必须为 `profile-config`（与默认注入的引用名一致；不符则命名 profile 激活失败），`description` 写明触发场景（创建/修改/删除 profile 时）。内容：指导 agent 按模糊或明确需求创建/修改/删除 profile。覆盖：名字字符集 `^[A-Za-z0-9][A-Za-z0-9._-]*$`、裸定义格式与全部字段语义、全局 `$PI_PROFILE_SWITCH_DIR/profiles/`（默认 `~/.pi-profile-switch/profiles/`）vs 项目 `<projectDir>/.pi/profiles/` 落点、可引用资源的发现位置（`<agentDir>/skills/`、`~/.agents/skills/`、`<agentDir>/settings.json` 声明的已安装 packages、`<agentDir>/extensions/` 散装文件、`<agentDir>/mcp.json`；tool 引用身份为 Pi 工具注册表的工具名；项目级资源可见性不随 profile 收窄，不指导声明它们）、创作时默认注入规则（生成声明了 `skills` 的 profile 时默认含 `"profile-config"`，除非用户明确要求不含；`skills` 已含覆盖性 glob 如 `"*"` 时不重复注入；未声明 `skills` 时不动作）、无 `write` 工具时退化为输出 JSON、项目未受信任时写项目 scope 前提示 `/trust` + 重启、声明内容为 package 所有勿手改。验证：对照主 spec `openspec/specs/profile-catalog/spec.md` 与 `openspec/specs/resource-reference/spec.md` 逐条核对格式与发现事实描述一致

## 2. 分发

- [x] 2.1 `bin/postinstall.js`：安装时把随包 skill 写入用户 agentDir 的 `skills/profile-config/`。该文件是纯 JS（npm postinstall 环境限制），现有镜像只覆盖 profile-switch 目录解析；需新增 agentDir 解析镜像（`PI_CODING_AGENT_DIR` 支持 `~` 展开，缺省 `~/.pi/agent`），并遵守文件头「keep in sync」注释约定。始终覆写，失败降级为警告不阻塞安装。验证：单测覆盖「安装分发 profile-config skill」全部 scenario
- [x] 2.2 `package.json`：`files` 数组加入 `skills`。验证：`npm pack --dry-run` 输出含 `skills/profile-config/SKILL.md`

## 3. 回归与文档

- [x] 3.1 `npm run check` 与 `npm test` 全部通过
- [x] 3.2 `README.md` 与 `README.zh-CN.md`：提及随包 `profile-config` skill 及其用途与默认注入约定
