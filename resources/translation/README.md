# 中英离线翻译资源

繁花有图使用 Helsinki-NLP / OPUS-MT 的中英专用翻译模型，由 Xenova 转换为 ONNX 并进行 Q8 量化，通过 Transformers.js 3.8.1 在本机 CPU 推理。模型只在请求翻译时加载，程序运行时不下载模型、不向模型发布方发送图片或文字。

## 来源、署名与许可

原始模型作者为 **University of Helsinki, Language Technology Research Group / Helsinki-NLP**。相关研究：Jörg Tiedemann and Santhosh Thottingal, *OPUS-MT — Building open translation services for the World*, EAMT 2020。ONNX 转换及量化版本由 **Xenova** 发布在 Hugging Face。

| 方向 | 原始模型与许可 | 实际分发的转换版本 |
| --- | --- | --- |
| 英文 → 简体中文 | [Helsinki-NLP/opus-mt-en-zh](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh)，**Apache License 2.0** | [Xenova/opus-mt-en-zh](https://huggingface.co/Xenova/opus-mt-en-zh/tree/046f55aec303cdee3e0318604406d4df20f1e8ea)，revision `046f55aec303cdee3e0318604406d4df20f1e8ea` |
| 中文 → 英文 | [Helsinki-NLP/opus-mt-zh-en](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en)，**Creative Commons Attribution 4.0 International** | [Xenova/opus-mt-zh-en](https://huggingface.co/Xenova/opus-mt-zh-en/tree/39d480d52a9ea3065a1f117adfe4dbc55de10e6f)，revision `39d480d52a9ea3065a1f117adfe4dbc55de10e6f` |

与原始训练权重相比，本次分发的是发布方提供的 ONNX 格式、Q8 量化版本。繁花有图没有重新训练模型或修改下载文件，仅选择运行需要的文件打包。上述作者和发布方没有为本应用或译文质量背书。许可分别适用于各自模型，不应把两方向统一标为 Apache-2.0。

许可全文随安装包保留：

- [LICENSE-APACHE-2.0.txt](LICENSE-APACHE-2.0.txt)，来源：https://www.apache.org/licenses/LICENSE-2.0.txt
- [LICENSE-CC-BY-4.0.txt](LICENSE-CC-BY-4.0.txt)，来源：https://creativecommons.org/licenses/by/4.0/legalcode.txt

分发时应保留本说明、模型来源及对应许可。应用的其他运行库有各自许可证；本说明不替代其许可文件。

## 可复现准备

```powershell
npm run models:prepare
npm run models:check
```

`manifest.json` 固定两个模型的仓库 revision、逐文件字节数与 SHA-256。ONNX 校验值来自发布方 Hugging Face API 的 LFS 元数据；JSON 文件从同一固定 revision 获取，先核对 API 中的 Git blob SHA-1 和字节数，再记录 SHA-256。

准备脚本只访问固定 HTTPS 文件地址，最多并发下载两个文件。大型权重按 4 MiB 分块，每文件最多四路并发；校验每个响应的 Content-Range 和整文件 SHA-256。完成校验后才将同目录临时文件重命名为正式文件，失败可重试；已有且完整的文件直接复用。`--check` / `models:check` 仅校验，不访问网络。构建安装包前执行检查，避免分发缺失模型的程序。

运行布局为 `resources/translation/Xenova/opus-mt-<方向>/`，每方向包含两个 Q8 ONNX、模型配置、生成配置及 tokenizer JSON。Transformers.js 使用合并解码器；不下载 FP32/FP16、独立 decoder-with-past、PyTorch 权重或重复的 SentencePiece 文件。

所有模型文件合计 **238,991,573 字节**（约 239.0 MB，含配置和分词器；不含运行库和本说明），其中四个 ONNX 权重合计 226,225,092 字节。该数字不是运行内存或完整安装包大小。`Xenova/` 中可重复下载的文件不纳入 Git；来源、许可、清单和下载脚本纳入版本记录。

模型训练资料较早，短句、术语与复杂排版的译文仍可能不准确。中英方向由用户明确选择；翻译结果作为段落文本展示，不改变原图或标注，不进入图片导出。
