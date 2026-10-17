# 轮盘是宿主应用，不是 agent 平台的插件

## Status

accepted

## Context

我们最初想把轮盘做成 Claude Code、Codex、DeepSeek Harness 的插件，以复用成熟 agent 平台的能力。核实后，这些平台的扩展点（skills、commands、hooks、MCP servers）全部运行在它们自己的进程内，没有任何 API 能注册全局热键、绘制透明浮层、截屏，或向其他应用注入文本。

## Decision

轮盘作为常驻桌面应用（宿主），通过子进程或 HTTP API 调用外部引擎。反向的 MCP server / 插件包只作为未来的可选分发形态，让 agent 能调用轮盘的能力。

## Consequences

- 全局热键、浮层、截屏、注入全部由我们自己实现，不能依赖平台。
- 引擎可以替换，不被某一个平台锁定。
- 用户不需要把轮盘安装进任何 agent 平台的插件系统。
