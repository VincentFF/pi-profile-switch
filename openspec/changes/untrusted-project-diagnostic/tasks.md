# Tasks

## 1. 诊断实现

- [ ] 1.1 在 launcher 的信任判定之后输出未受信任项目诊断：判定为未受信任且项目存在需要信任的内容（pi-profile 项目文件或 Pi 项目资源）时，向 stderr 输出一条诊断，说明未受信任、不可见的内容与授权方式（`/trust` 持久、`-- --approve` 一次性）；受信任或无需要信任的内容时不输出。验证：单测覆盖 specs delta 的四个 scenario（触发、消息内容、受信任不报、`--no-approve` 空项目不报），`npm run check` 与 `npm test` 通过
