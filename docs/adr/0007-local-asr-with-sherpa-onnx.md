# 语音识别用 sherpa-onnx-node + SenseVoice

## Status

accepted

## Context

M4 需要把语音转成文字。可选的路线：

1. **云端 ASR**（OpenAI 兼容的 `/audio/transcriptions`）：实现最省事，但音频要离开本机，与"本地优先"的定位冲突，还要再管一个 provider 的计费和密钥。
2. **WASM sherpa-onnx**：跨平台、无原生依赖，但单线程、加载和推理都慢，不适合常驻。
3. **原生 sidecar（Rust + sherpa-onnx C API）**：最可控，但要重写音频采集、模型加载和 IPC，和现有钩子 sidecar 混在一起。
4. **`sherpa-onnx-node`**：N-API 原生插件，官方提供 Windows x64 预编译包，Electron 下不需要重编，API 是同步/异步的 `OfflineRecognizer`。

模型方面，SenseVoice-Small 支持中英日韩粤，int8 量化后约 228 MB，5 秒音频在本机解码约 200 ms。

## Decision

- **采集在渲染进程**：`getUserMedia` + `MediaRecorder`，停止后用 `AudioContext.decodeAudioData` 取出单声道 float32 PCM，连同采样率通过 IPC 交给主进程。
- **转写在主进程**：`sherpa-onnx-node` 的 `OfflineRecognizer.createAsync` 懒加载 SenseVoice int8；主进程负责 48k/44.1k → 16k 的线性重采样和转写串行化。
- **模型首次使用时下载**：`model.int8.onnx` 与 `tokens.txt` 下载到 `userData/models/sensevoice/`，先试 HuggingFace，失败（或 15 秒无响应）再走 `hf-mirror.com`；`.part` 文件支持断点续传。
- 音频只在显式点击/选择录音时采集，不落盘，不发送到任何服务器。

## Consequences

- 离线、无额外账号和费用；延迟可接受（模型加载约 1.5 s，解码约 200 ms）。
- 安装包不包含 228 MB 模型，首次使用需要下载；下载进度和状态在设置里展示。
- 原生插件必须随包分发，M5 打包时要 `asarUnpack` `sherpa-onnx-*` 和 `.node`/`.dll` 文件。
- Windows 的麦克风隐私设置可能直接拒绝 `getUserMedia`，界面需要给出明确提示。
- 目前只做"录音 → 一次性转写"；流式识别和 PTT（按住说话）留待后续，需要键盘钩子。
- 云端 ASR 可以作为后续的可选 provider，接口已隔离在 `src/main/asr.ts`。
