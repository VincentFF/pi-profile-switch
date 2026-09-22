# Tasks

## 1. Skill 内容

- [ ] 1.1 新增 `skills/profile-config/SKILL.md`：指导 agent 按模糊或明确需求创建/修改/删除 profile。覆盖：名字字符集 `^[A-Za-z0-9][A-Za-z0-9._-]*$`、裸定义格式与全部字段语义、全局 `~/.pi-profile-switch/profiles/` vs 项目 `<projectDir>/.pi/profiles/` 落点、可引用资源的发现位置、创作时默认注入规则（生成声明了 `skills` 的 profile 时默认含 `"profile-config"`，除非用户明确要求不含）、无 `write` 工具时退化为输出 JSON、项目未受信任时写项目 scope 前提示 `/trust` + 重启、声明内容为 package 所有勿手改。验证：对照 `per-profile-config-files` 的 specs delta 逐条核对格式描述一致

## 2. 分发

- [ ] 2.1 `bin/postinstall.js`：安装时把随包 skill 写入用户 agentDir 的 `skills/profile-config/`（agentDir 解析沿用既有镜像规则），始终覆写，失败降级为警告不阻塞安装。验证：单测覆盖「安装分发 profile-config skill」两个 scenario
- [ ] 2.2 `package.json`：`files` 数组加入 `skills`。验证：`npm pack --dry-run` 输出含 `skills/profile-config/SKILL.md`

## 3. 回归与文档

- [ ] 3.1 `npm run check` 与 `npm test` 全部通过
- [ ] 3.2 `README.md` 与 `README.zh-CN.md`：提及随包 `profile-config` skill 及其用途与默认注入约定
