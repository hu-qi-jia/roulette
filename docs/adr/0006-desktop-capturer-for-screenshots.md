# 截图用 desktopCapturer，不在原生层做 BitBlt

## Status

superseded by [ADR 0008](0008-gdi-screenshot-capture.md)

## Context

v1 设计最初写的是在 Rust helper 里用 GDI BitBlt 抓虚拟屏幕。真正实现时要额外解决：多显示器拼接、逐显示器 DPI、BMP→PNG/JPEG 编码，以及把图片传回主进程。原生 helper 目前只负责鼠标钩子和粘贴，引入图像编码会明显扩大它的职责。

Electron 的 `desktopCapturer.getSources({ types: ['screen'] })` 一次调用就能拿到每个显示器的缩略图（`NativeImage`），可以直接转成 data URL，且不需要额外权限提示。

## Decision

- 主进程用 `desktopCapturer` 抓取所有显示器，`thumbnailSize` 取最大显示器的物理分辨率。
- 渲染进程的截图窗口覆盖整个虚拟桌面，按每个显示器的 DIP bounds 排列图片；拖拽结束后在 canvas 上按选区裁剪。
- 裁剪时按选区所在显示器的 `scaleFactor` 映射回图片像素，最长边压到 2048px，输出 JPEG（0.85）。
- 松手即确认；Esc / 右键取消。

## Consequences

- 不需要新的原生图像代码，Windows / macOS 行为一致。
- 跨显示器混合 DPI 时，单个窗口的预览在其中一块屏上可能略显模糊；保存的裁剪仍按每块显示器的比例映射，尺寸正确。
- 受保护内容（DRM）或 HDR 屏幕可能截出黑图，这是系统限制。
- 超大分辨率的多屏桌面会产生几 MB 的 data URL 经过一次 IPC；只在截图时发生，可接受。
- 以后若要支持窗口级截图或滚动截图，可以在同一入口替换实现。
