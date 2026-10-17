# Mouse-hook spike

验证"按住鼠标键唤出轮盘、滑动、松开选中"在 Windows 上是否可行，以及能否吞掉触发事件。

## 运行

```bash
cd spike
npm install
npm run build:hook
npm start
```

看到终端输出 `HOOK READY` 后：按住 `Alt`，再按住鼠标右键，轮盘应出现在光标处。保持按住并滑到某个扇区，松开右键。

选中结果会打印在终端（`SELECTED: text` 等），轮盘上也会短暂显示。

## 验证清单

- [ ] Explorer / VS Code / Chrome / 微信 / Notepad 里轮盘都能出现
- [ ] 右键菜单不弹出，目标应用不开始框选或拖拽
- [ ] 松开后选中正确扇区；中心松开取消
- [ ] 125% / 150% DPI 下轮盘中心与光标对齐
- [ ] 多显示器下位置正确
- [ ] 退出 Electron 后钩子进程不残留

## 当前验证结果

- [x] 钩子安装成功（`HOOK READY`）
- [x] Alt+右键按下 / 移动 / 抬起事件都能捕获
- [x] 三个扇区选中正确（`text` / `screenshot` / `voice`）
- [x] 轮盘渲染与悬停高亮（见 `wheel-capture.png`）
- [x] 关闭 Electron 后钩子进程不残留
- [ ] 真实应用里按钮事件被吞掉
- [ ] 125% / 150% DPI
- [ ] 多显示器

自动化注入（`test-inject.ps1`）只能证明钩子和坐标链路通；真实鼠标在目标应用里的行为仍需手工验证。

```powershell
# 模拟 Alt + 右键上滑（文字）
& .\test-inject.ps1 -Dx 0 -Dy -120
# 左下（截图）
& .\test-inject.ps1 -Dx -120 -Dy 70
# 右下（语音）
& .\test-inject.ps1 -Dx 120 -Dy 70
```

## 已知限制

- 只处理 `Alt + 右键`
- 只吞按下 / 抬起，不吞移动：移动必须放行，光标才能正常移动；目标应用收不到按钮事件，所以不会开始拖动
- Esc 取消尚未实现（用中心松开取消）
- 注入测试用 `mouse_event`，不是真实硬件输入
- 不是产品代码，只回答"这个交互能不能成立"
