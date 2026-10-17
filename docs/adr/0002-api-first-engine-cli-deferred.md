# v1 只接 OpenAI 兼容 API，CLI harness 延后

## Status

accepted

## Context

产品定位是即时、少轮、把结果插入光标的对话工具。Claude Code、Codex、DeepSeek Harness 的独特能力（工具调用、文件访问、长会话）与这个核心场景不匹配，却会带来 1–3 秒冷启动、权限 UI、workspace 管理、版本漂移和登录合规风险。

## Decision

v1 只实现 `ApiEngine`：任意 OpenAI 兼容的 base URL + API key，文本模型和视觉模型分开配置。保留 `Engine` 接口；CLI harness 作为未来的独立"任务模式"，不进入即时流。

## Consequences

- 延迟低、安装门槛低、没有登录合规风险。
- 失去订阅复用和文件/工具能力；这些留给未来的任务模式。
- 未来的任务模式需要独立的 UI（diff、权限确认、workspace），不是简单的引擎替换。
