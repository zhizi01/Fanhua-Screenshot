# 中英本地翻译

繁花有图使用 Transformers.js 的 Node 后端，通过 ONNX Runtime 在 CPU 上执行中英专用 OPUS-MT Q8 模型。两个方向的模型随完整程序分发，运行时不下载模型、不调用云端接口，也不需要 Python、Ollama 或单独启动模型服务。

## 模型与来源

| 方向 | 原始模型与许可 | ONNX Q8 版本 |
| --- | --- | --- |
| 英文 → 简体中文 | [Helsinki-NLP/opus-mt-en-zh](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh)，Apache License 2.0 | [Xenova/opus-mt-en-zh](https://huggingface.co/Xenova/opus-mt-en-zh) |
| 中文 → 英文 | [Helsinki-NLP/opus-mt-zh-en](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en)，CC BY 4.0 | [Xenova/opus-mt-zh-en](https://huggingface.co/Xenova/opus-mt-zh-en) |

原始模型作者为 University of Helsinki, Language Technology Research Group / Helsinki-NLP，ONNX 转换与量化版本由 Xenova 提供。专用翻译模型适合当前中英范围，可直接由 Electron 后台进程调用，无需额外部署通用大语言模型。

每个方向使用一个量化编码器和一个合并解码器。四个 ONNX 权重共 226,225,092 字节；包含配置和分词器的模型文件合计 238,991,573 字节，约 239 MB。这不是运行内存或完整安装包大小。

固定 revision、逐文件 SHA-256、来源、作者署名和许可全文见 [翻译资源说明](../resources/translation/README.md)及 [manifest.json](../resources/translation/manifest.json)。两个方向的模型许可不同，分发时须分别保留。Transformers.js 使用 Apache-2.0 许可，运行库仍遵循各自随包许可证。Node 调用方式参考 [Transformers.js 文档](https://huggingface.co/docs/transformers.js/v3.8.1/tutorials/node)和 [ONNX Runtime Node 文档](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)。

## 使用与显示

在预览窗口启用翻译，先识别当前原图文字，再选择“英文 → 简体中文”或“中文 → 英文”。可翻译所有段落或单段，也可先修正 OCR 原文。结果逐段显示，支持复制单段或全部已完成译文。

图片上的译文位于原 OCR 识别区域，以浅色遮罩覆盖原文并自适应字号；过长内容在框内截断，右侧段落栏保留全文。识别框和译文均由独立 DOM 层呈现，不改动原图，不进入标注历史、图片保存、PDF 导出、复制或 LocalSend 共享。

修改原文会使该段旧译文失效。切换方向、重新识别、关闭识别栏或关闭预览会取消在途任务；已完成结果保留在当前图片的识别状态中。PDF 翻页后清空原页结果，避免串页。

## 运行方式

- `src/services/translation.ts` 管理方向、段落原文、请求编号、进度与取消；仅接收当前图片、当前请求、方向及原文仍匹配的结果。
- `electron/translation.cjs` 校验请求并绑定窗口身份，全应用同时处理一个翻译任务。
- `electron/translation-worker.cjs` 按需启动独立 Electron `utilityProcess`，使用 Transformers.js 3.8.1、CPU、2 个算子内线程和 1 个算子间线程。主进程与渲染进程不执行推理。
- 一次只保留一个方向的模型，切换前释放旧模型，空闲 60 秒后终止子进程。取消、错误、超时或退出会释放相关进程。
- 模型只从固定本地目录读取，关闭远程模型与缓存回退。模型不可用时明确提示，不联网补下载。

`electron/translation-text.cjs` 按行保留换行，长行先按句子划分，再按实际 tokenizer 数量拆分为不超过 192 个输入 token 的片段。禁止自动截断输入；每段生成最多 384 个新 token，达到输出限制时提示拆分。英译中附加 `>>cmn_Hans<<` 目标语言标记，纯数字和符号行直接保留。

## 限制

- 仅中英互译，由用户明确选择方向，不自动猜测整批文本的语言。
- 一次最多 200 段，单段最多 12000 字符，总计最多 60000 字符。
- 无进度等待最多 120 秒，整批任务最多 10 分钟；可取消后重新尝试。
- CPU 首次加载和长文推理需要时间，速度与内存使用取决于设备和内容。
- OCR 错字、专业术语、短句和复杂上下文可能影响译文，应按用途核对；它不是通用问答模型。

## 模型准备

```powershell
npm run models:prepare
npm run models:check
```

准备命令从固定 HTTPS 地址下载文件，校验后才替换正式文件；完整已有文件会复用。检查命令不联网，只核对本地文件大小和 SHA-256。`pack`、`dist` 会先检查模型，避免生成缺失离线翻译资源的程序。
