# Roulette v1 设计

## 1. 定位

Windows 桌面即时对话工具：全局触发 → 轮盘选动作 → 面板对话 → 结果插入光标处。

- **即时**：2–3 轮内完成，不追求长会话。
- **就地**：结果直接进入用户正在使用的应用，而不是复制到另一个聊天窗口。
- **API-first**：v1 只接 OpenAI 兼容 API，不接 CLI harness。
- **本地优先**：历史、设置、密钥、语音识别都在本机。
- **开源**：MIT。

## 2. 非目标（v1）

知识库、CLI / 任务模式、云向量库、RTL、插件系统、OCR 批量摄取、团队同步、移动端、代码签名。

## 3. 交互

### 3.1 触发绑定

`Trigger Binding` 是键盘键和/或鼠标键的组合。**选中方式继承呼出设备**：

| 绑定包含 | 选中方式 | 轮盘生命周期 | 取消 |
|---|---|---|---|
| 左 / 中 / 右键 | 按住 → 滑动 → 松开选中 | 鼠标按住期间显示 | 死区松开 / Esc |
| 键盘键、鼠标侧键，或无鼠标键 | 按键呼出 → 移动 → 点击扇区 | 呼出后常驻 | 点空白 / Esc / 再按一次 |

- 默认绑定：`Alt + 右键`（长按滑动）。
- 侧键归点击模式：厂商驱动对侧键按下/抬起的上报不可靠。
- 死区半径约 30–36px；外径约 140–190px。
- 设置里显示推导出的模式，并允许手动覆盖（自动 / 始终点击 / 始终长按）。

### 3.2 轮盘

四个扇区：文字（上）、截图（左）、语音（右）、历史（下）。

- 文字 → 面板打开，输入框聚焦，新建 session。
- 截图 → 冻结全屏，进入区域选择；截完回到面板，图片附在本轮。
- 语音 → 面板打开并开始录音。
- 历史 → 面板打开并展开历史抽屉，选择某条会话即可继续。

视觉上轮盘是一枚深色环形四分区：每格含图标与文字，中央 hub 显示当前指向的动作并兼作取消区；外圈是低透明度虚线轨道，背后有柔和暗色光晕，保证在亮色桌面上依然可读。悬停项带绿色描边与浅绿填充，内容沿半径外移 4px。

### 3.3 面板

一个会话面，不是四个并列 tab：

```
┌──────────────────────────────────────────────┐
│ 会话标题 · 应用名                  [历史] × │
├──────────────────────────────────────────────┤
│  消息流 / 流式结果                            │
│  ┌ 截图缩略图（本轮附带的图） ┐                │
├──────────────────────────────────────────────┤
│ [📷] [🎤]  ┌─ 输入框 ────────┐        [发送] │
│            └─────────────────┘               │
└──────────────────────────────────────────────┘
```

- 截图和语音是输入方式，不是独立内容区。
- 历史是标题栏左侧图标展开的浮层抽屉，按今天 / 昨天 / 更早分组；支持搜索、类型筛选、重命名，删除后 5 秒内可撤销。
- 设置固定为两个区块：模型配置（Base URL / API Key / 模型）和语音模型（状态、下载、自动发送）。API Key 掩码预填，眼睛图标切换可见性；模型默认一个多模态模型，可展开分别配置文本 / 视觉模型。
- 面板默认展示对话；设置不再在未配置时自动弹出，用户通过齿轮或错误提示进入。
- 错误按类型本地化（未配置、鉴权、限流、网络等），配置类错误提供「打开设置」入口。
- 支持两种状态：紧凑态（单轮结果 + 插入）和展开态（多轮对话）。
- 视觉风格：近黑背景、细描边、单一绿色强调色；空会话展示居中的品牌标识和欢迎语。

### 3.4 键盘

| 键 | 行为 |
|---|---|
| Enter | 输入框有内容时发送 |
| Enter（输入框为空） | 插入最后一条结果 |
| Ctrl+Enter | 始终插入最后一条结果 |
| Shift+Enter | 换行 |
| `Ctrl+Alt+H` | 任意位置打开历史浮层（备选 `Alt+Shift+H`） |
| Esc | 依次关闭设置弹窗 / 历史浮层；生成中则先中断；否则关闭面板 |
| Esc（截图覆盖层） | 取消截图；覆盖层显示期间临时注册为全局快捷键，避免焦点被其他置顶窗口抢走 |
| Ctrl+/ | 打开快捷键提示（后续） |

插入后默认关闭面板；设置里可改为保持打开。

## 4. 架构

```
┌────────────────── Electron main ──────────────────┐
│ Binding / wheel state machine                     │
│ Engine (OpenAI-compatible, SSE, text + vision)    │
│ SessionStore (SQLite)                             │
│ Injector (clipboard snapshot + Ctrl+V)            │
│ Settings (JSON + safeStorage)                     │
│ i18n                                              │
└───────┬───────────────────────────┬───────────────┘
        │ IPC (contextBridge)       │ spawn + JSONL
   ┌────┴──────────────┐      ┌─────┴────────────────┐
   │ Renderer          │      │ roulette-hook.exe    │
   │ overlay + panel   │      │ WH_MOUSE_LL (Rust)   │
   └───────────────────┘      └──────────────────────┘
```

- **Electron 44 + TypeScript + React + electron-vite**。
- **原生 sidecar**：Rust 低级鼠标钩子，只吞按下/抬起，**不吞移动**（吞移动会让光标不动）。
- **渲染进程**：overlay 负责轮盘；panel 负责会话。两者共用一套 preload。
- **主进程**：状态机、引擎、存储、注入、设置。

## 5. 模块

| 模块 | 职责 |
|---|---|
| `binding` | 解析触发绑定，推导 hold / click 模式 |
| `hook-client` | 启动 sidecar，解析 JSONL 事件，处理退出与重连 |
| `wheel` | 轮盘状态机：idle → showing → hovering → selected/cancelled |
| `windows` | overlay / panel 的创建、定位、显示、销毁 |
| `engine` | `Engine` 接口 + `OpenAiCompatibleEngine` |
| `session-store` | SQLite：sessions / messages |
| `injector` | 锁定目标窗口、剪贴板快照、WM_PASTE / Ctrl+V、恢复、失败回退 |
| `screenshot` | 原生 helper GDI 抓屏（desktopCapturer 回退）、canvas 裁剪与压缩 |
| `asr` | 本地 SenseVoice（sherpa-onnx-node），渲染进程采集 + 主进程转写，首次使用下载模型 |
| `settings` | provider / key / model / 热键 / 语言 / 插入行为 |
| `i18n` | zh-CN / en |

### 引擎接口

```ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // file paths or data URLs
}

export interface Engine {
  chat(messages: ChatMessage[], signal: AbortSignal): AsyncIterable<string>;
}
```

- v1 只有一个实现：`OpenAiCompatibleEngine`。
- 设置里只填一个多模态模型，主进程把它同时用于文本和图像请求；数据结构保留 `textModel` / `visionModel` 两个字段，方便以后拆分或接入分别配置的 provider。
- 流式 SSE；`signal` 用于中断。
- 知识库（v1.1）的检索在宿主侧完成，Engine 不感知。

## 6. 数据模型

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL,        -- chat | screenshot | voice
  app_name    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,        -- user | assistant
  content     TEXT NOT NULL,
  image_path  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_messages_session ON messages(session_id, id);
```

- 标题取第一条用户消息的前 40 个字符。
- v1 不自动清理；用户在历史里删除。
- 设置存 JSON；API key 用 Electron `safeStorage`（Windows DPAPI）加密。

## 7. 关键流程

### 文字

1. 触发绑定 → 轮盘 → 选中文字。
2. 新建 session，面板打开，输入框聚焦。
3. Enter 发送：消息入库 → Engine 流式返回 → 面板渲染。
4. 输入框为空时 Enter / Ctrl+Enter → 注入最后一条结果 → 默认关闭面板。

### 截图

1. 轮盘选中截图。
2. 原生 helper 用 GDI BitBlt 抓取轮盘所在显示器（约 30ms），返回未压缩 BMP；helper 不可用时回退 `desktopCapturer`。
3. 在覆盖整个虚拟桌面的冻结层上拖拽选区，松手确认；Esc / 右键取消。
4. 按显示器的 `scaleFactor` 裁剪并压到最长边 2048px 的 JPEG。
5. 面板打开，图片附在本轮；输入指令（留空则用默认提示）。
6. 提交给视觉模型；该会话的后续追问继续使用视觉模型，并重新附带历史图片。

### 语音

1. 轮盘选中语音，面板打开并立即录音；面板里的麦克风按钮也能随时开始/停止（PTT 热键留待后续）。
2. `getUserMedia` + `MediaRecorder` 采集，停止后解码为 16k 单声道 PCM。
3. `sherpa-onnx-node` 的 SenseVoice int8 在本机转写（首次使用时下载约 228 MB 模型，HF 失败自动切 hf-mirror，支持断点续传）。
4. 转写结果进入输入框，可编辑；设置里可开启"转写后自动发送"。
5. 结果按文字流程处理，音频不落盘、不出本机。

### 注入

1. 唤出轮盘时记录鼠标位置和目标窗口。
2. 面板隐藏后重新查询前台窗口，作为最终目标（排除本应用和桌面）。
3. 快照剪贴板 → 写入结果。
4. 原生 helper 激活目标并等待其真正获得前台；取目标线程的焦点控件并读窗口类名。
5. 类名包含 `edit` 时向焦点控件发送 `WM_PASTE`；否则先在轮盘呼出点点击一次恢复键盘焦点，再发送 Ctrl+V。点击点即用户呼出轮盘时的鼠标位置。
6. helper 回报粘贴结果后，主进程才恢复剪贴板；原剪贴板为空时保留结果，方便用户再次粘贴。
7. 目标窗口已关闭、提权、焦点恢复失败或注入失败 → 结果显示在面板并提示复制。

## 8. 隐私与安全

- 无遥测、无账号、零后端。
- API key 只存在本机。
- 截图和语音内容只发给用户配置的 provider。
- 知识库（v1.1）：本地 embedding + 本地索引；检索片段随问题发给云端模型，界面必须明确提示。
- 不做任何登录代管；不提供绕过权限的开关。

## 9. i18n

- `i18next` + `react-i18next`，JSON 资源，ICU 消息。
- 首发 zh-CN / en；RTL 不在 v1。
- UI 语言与回答语言分离：回答默认跟随输入，可在设置里强制。
- Prompt 模板与 UI 文案分开管理。
- ASR / embedding 选多语模型，避免跨语断层。

## 10. 打包与更新

- `electron-builder`，NSIS 安装包，Windows 10/11 x64。
- GitHub Releases + `electron-updater`。
- v1 不做代码签名，首次安装会有 SmartScreen 警告。
- 托盘、开机启动、单实例。

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 鼠标钩子在部分应用/提权窗口失效 | 保留键盘 + 点击模式作为 fallback；测试矩阵覆盖 |
| DPI / 多显示器坐标偏移 | `screen.screenToDipPoint`；截图按每块显示器的比例映射；多显示器手工矩阵 |
| 截图抓取失败 / 安全桌面 | GDI 抓屏失败时回退 desktopCapturer；仍失败则提示并退出截图模式 |
| 混合 DPI 下副屏截图错位 | 覆盖层只针对轮盘所在显示器，不再跨屏拼接；代价是不能跨屏框选 |
| 剪贴板竞态 / 恢复失败 | 重试 OpenClipboard；失败时保留结果并提示 |
| 受限宿主 / 沙箱下输入注入静默失败 | 标准编辑控件走 WM_PASTE；自绘控件先点击恢复焦点再 Ctrl+V；失败时保留剪贴板并提示复制 |
| 本地 ASR 模型体积与首次加载 | 首次使用下载（约 228 MB）；懒加载约 1.5 s；HF 失败切 hf-mirror；可切云端点（后续） |
| 麦克风被系统隐私设置拒绝 | 捕获 `getUserMedia` 错误并在面板提示，引导检查 Windows 隐私设置 |
| Electron 体积与常驻内存 | v1 接受；后续评估 Tauri |
| 提供商输出格式差异 | 只承诺 OpenAI 兼容协议；错误可视化 |

## 12. 里程碑

- **M0（已完成）**：鼠标钩子 spike，验证长按滑动选择。
- **M1**：正式工程骨架、轮盘、面板、绑定、hook sidecar。
- **M2（已完成）**：文字闭环（settings、engine、streaming、insert、history）。
- **M3（已完成）**：截图。
- **M4（已完成）**：语音。
- **M5**：打包、自动更新、i18n 完成。
- **v1.1**：知识库。

## 13. 决策记录

- [ADR 0001：轮盘是宿主，不是 agent 平台插件](../adr/0001-roulette-is-host-not-agent-plugin.md)
- [ADR 0002：v1 API-first，CLI 延后](../adr/0002-api-first-engine-cli-deferred.md)
- [ADR 0003：知识库检索在宿主侧](../adr/0003-retrieval-in-host.md)
- [ADR 0004：标准编辑控件用 WM_PASTE 注入](../adr/0004-wm-paste-for-edit-controls.md)
- [ADR 0005：历史库用 node:sqlite](../adr/0005-node-sqlite-for-history.md)
- [ADR 0006：截图用 desktopCapturer](../adr/0006-desktop-capturer-for-screenshots.md)
- [ADR 0007：本地 ASR 用 sherpa-onnx-node](../adr/0007-local-asr-with-sherpa-onnx.md)
- [ADR 0008：截图改为 GDI 优先](../adr/0008-gdi-screenshot-capture.md)
- [术语表](../../GLOSSARY.md)
