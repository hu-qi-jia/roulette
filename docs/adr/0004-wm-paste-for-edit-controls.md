# 注入：原生编辑控件用 WM_PASTE，自绘控件先点击恢复焦点

## Status

accepted

## Context

把结果注入目标窗口有两条路：模拟 Ctrl+V（SendInput），或直接向焦点控件发 `WM_PASTE`。前者对 Chromium/Electron/终端等自绘控件更通用，但在受限宿主（Electron 子进程、沙箱、焦点尚未恢复）里会静默失败；后者对 Win32/WinForms 编辑控件最可靠，但依赖控件处理 `WM_PASTE`。

实际测试还发现三个问题：

1. 面板会抢走目标应用的键盘焦点。面板隐藏后，Chromium 虽然重新成为前台窗口（`GetForegroundWindow` 已指向它），但网页内容仍可能没有键盘焦点（`document.hasFocus()` 为 false），此时 Ctrl+V 会被丢弃。
2. 滚轮呼出时锁定的窗口可能在用户切换应用后已经过期，文本被插到错误的应用。
3. 主进程固定等待 500ms 就恢复剪贴板，可能早于实际粘贴，导致粘贴到旧内容。

## Decision

1. 面板隐藏后重新查询当前前台窗口，优先用它作为目标；本应用窗口和桌面类窗口除外，查不到时回退到滚轮呼出时锁定的窗口。
2. 原生 helper 调用 `SetForegroundWindow` 后轮询前台窗口，最多等 1.2s，确认目标真正接管前台。
3. 焦点控件类名包含 `edit`（`Edit`、`RichEdit`、`WindowsForms10.Edit` 等）时，向焦点控件发送 `WM_PASTE`，不产生鼠标点击。
4. 其他控件（Chromium、Electron、终端等）先在滚轮呼出点点击一次，恢复键盘焦点并把光标放到用户呼出轮盘的鼠标位置，再发送 `SendInput` 的 Ctrl+V。点击前用 `WindowFromPoint` 确认该点属于目标窗口。
5. helper 通过 JSONL 回报 `paste-result`；主进程收到结果后才恢复剪贴板。失败时保留结果文本在剪贴板，并提示手动粘贴。

## Consequences

- 标准编辑控件（Notepad、WinForms、多数传统应用）稳定，且不产生额外点击。
- Chromium/Electron 目标在点击后能可靠粘贴；插入位置就是用户呼出轮盘时的鼠标位置。
- 自绘控件下多了一次点击，若用户在轮盘呼出点覆盖的是按钮/链接，可能触发目标应用的点击行为；这是"插入到鼠标位置"语义的代价。
- 焦点恢复失败、目标已关闭或提权时，注入会回报失败并回退为"已复制，请手动粘贴"。
- 注入策略集中在原生 helper 里，主进程只发送 `paste <hwnd> <x> <y>`。
