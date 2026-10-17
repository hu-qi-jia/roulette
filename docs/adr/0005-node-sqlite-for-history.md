# 历史库用 node:sqlite

## Status

accepted

## Context

会话和消息需要持久化（sessions / messages 两张表，见 v1 设计）。常见方案是 `better-sqlite3`：API 成熟，但它是原生模块，在 Electron 下必须针对 ABI 重新编译。对一个要分发给技术用户的开源 Windows 应用，这意味着安装依赖时可能要求 Visual Studio Build Tools，升级 Electron 时还要重编。

Electron 44 内置 Node 24，`node:sqlite` 已经稳定，提供同步的 `DatabaseSync`，足以覆盖本地单用户场景。

## Decision

用 `node:sqlite` 的 `DatabaseSync`，数据库放在 `app.getPath('userData')/roulette.db`，启用 WAL 与外键。所有访问封装在 `src/main/store.ts` 的少量函数里，主进程是唯一调用方。

## Consequences

- 安装和打包都不需要原生编译工具链，也不存在 ABI 失配。
- 渲染进程不能直接访问数据库；所有读写走 IPC，与现有权限模型一致。
- `node:sqlite` 的 API 比 `better-sqlite3` 精简，复杂迁移/事务写法需要自己补，但当前两张表远未到这一步。
- 如果以后换运行时（例如评估 Tauri），只需替换 `store.ts` 这一层。
- 数据库损坏时 `openStore` 返回 false，应用继续运行但历史功能禁用，不阻塞轮盘与对话。
