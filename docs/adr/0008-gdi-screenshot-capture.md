# 截图改为 GDI 优先，desktopCapturer 回退

## Status

accepted；取代 [ADR 0006](0006-desktop-capturer-for-screenshots.md)

## Context

ADR 0006 用 `desktopCapturer` 抓屏。实测双屏 1080p 下 `getSources` 需要约 1.6 秒，滚轮选中截图后要明显卡顿一下才出现冻结层。原生 helper 已经在运行，增加 GDI 截屏的成本很低：`BitBlt` + `GetDIBits` 单块 1920×1080 约 30ms。

如果继续在 Rust 里编码 JPEG，即使把 `opt-level` 调到 3，pure-Rust 编码器处理 1080p 仍需约 400ms；因此改成传未压缩的 32 位 BMP，由 Chromium 原生解码。

## Decision

- 主进程把每个显示器的 DIP bounds 通过 `screen.dipToScreenPoint` 转成物理矩形，发 `capture <count> <id x y w h>...` 给 helper。
- helper 用 `GetDC(NULL)` + `BitBlt(SRCCOPY)` 抓取每个矩形，`GetDIBits` 取 BGRA，把 alpha 置 255，写 32 位 BMP 到系统临时目录，回传 `capture-result`。
- 主进程读取 BMP，以 `image/bmp` 发给截图窗口；渲染进程用 Blob URL 显示和裁剪。
- helper 不在、抓取失败或 6 秒超时 → 回退到 `desktopCapturer`。
- 选中截图后跳过 280ms 的结果动画；轮盘隐藏 220ms 后立即抓屏。

## Consequences

- 双屏截图总耗时从约 1.7 秒降到约 0.37 秒，抓屏本身每屏约 30ms。
- BMP 未压缩：每个 1080p 显示器约 8MB，会经过一次 IPC；换来无需编码器和额外延迟。
- 必须把 alpha 置 255，否则 Chromium 把 32 位 BMP 当作透明，裁剪结果是黑图。
- 混合 DPI 依赖 `dipToScreenPoint` 得到的物理矩形；安全桌面 / 锁屏下 GDI 可能抓不到画面。
- `desktopCapturer` 回退保留，覆盖 helper 异常以及未来非 Windows 平台。
