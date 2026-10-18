# 知识库：本地嵌入 + sqlite-vec，检索在宿主侧

## Status

accepted

## Context

v1.1 要加个人知识库：用户上传内容，提问时检索相关片段，答案可引用来源。约束是本地优先：文档、索引、查询向量都不应离开本机；只有最终发给模型的检索片段会离开。

候选方案：

- 云端 embedding / 向量库：违反本地优先，还要再管一个 provider。
- 本地 ONNX embedding：`@huggingface/transformers` + `onnxruntime-node`，模型用 `Xenova/bge-small-zh-v1.5`（int8 约 24MB，512 维），在 Electron 主进程内运行，无额外服务。
- 向量索引：`sqlite-vec` 可加载扩展（`node:sqlite` 支持 `loadExtension`），KNN 查询；或纯 JS 余弦扫描。前者原生但快，后者零依赖但 O(n)。

## Decision

- 文档按约 700 字、120 字重叠切块；块文本带上文档标题后本地嵌入。
- 嵌入模型首次使用时下载（约 25MB），先走 hf-mirror，失败再走 HuggingFace；缓存在 `userData/models/embeddings`，用 `.ready` 标记已安装。
- 文档和块存现有的 SQLite；向量存 `kb_vectors`（sqlite-vec，`chunk_id` 主键，`float[512]`）。扩展加载失败时自动退回 `kb_embeddings` BLOB + JS 余弦扫描。
- 检索在主进程完成：查询加 BGE 中文检索指令，KNN 取前 5，距离阈值 1.2。
- 检索片段作为额外的 system message 发给模型；助手消息的 `meta` 里保存来源 JSON，面板在回复下方展示「参考来源」。
- 知识库开关控制是否检索；知识库弹窗提供模型状态/下载、粘贴文本、从文件添加（txt/md/csv/json）、文档列表和删除。
- 文件仅支持文本类、单文件 ≤5MB；PDF、URL、增量重索引留待后续。

## Consequences

- 除最终对话请求外全部在本机完成；只发送检索到的片段，界面明确列出引用来源。
- 这是第二个模型下载（另一个是 ASR 的约 228MB）；嵌入模型每次启动首次使用时加载约 1.5 秒，首条消息会多一次检索延迟。
- `sqlite-vec`、`onnxruntime-node`、`sharp` 等原生依赖必须在 M5 打包时 `asarUnpack`。
- 余弦回退是线性扫描，对个人知识库规模足够。
- 维度固定 512；更换嵌入模型需要重建索引，当前未实现。
