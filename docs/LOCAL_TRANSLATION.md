# 本地翻译方案调查

查询日期：2026-11-03。目标：为「繁花有图」的 OCR 段落提供 Windows CPU 离线中英互译，保持截图工具轻量、随叫随用。

后续实施：1.3.0 已按下述首选接入 Transformers.js + OPUS-MT Q8，两个方向随完整安装包提供；实际实现和验证分别见 [架构说明](ARCHITECTURE.md) 与 [验证记录](VALIDATION.md)。本文保留最初调查结论，以下“本轮仅调查”描述的是 1.2.1 阶段，不是当前功能状态。

本轮仅做资料调查：没有安装翻译依赖、下载模型、接入翻译功能或进行本机性能测试。下文的文件大小来自发布方文件列表，不能等同于安装包大小或运行内存；架构与选型属于工程建议。

## 建议选择

**当前 Electron 项目首选评估 Transformers.js + OPUS-MT ONNX Q8。** 它可以在 Node.js 中直接调用，避免额外分发 Python；官方 Node 后端使用 ONNX Runtime，后者提供 Windows CPU 预编译包。若后续实测需要进一步控制 CPU 推理性能，再采用 CTranslate2 INT8；若优先快速验证语言包管理，则可用 Argos Translate。[Transformers.js Node 文档](https://huggingface.co/docs/transformers.js/v3.8.1/tutorials/node)、[ONNX Runtime Node 平台支持](https://onnxruntime.ai/docs/get-started/with-javascript/node.html)

| 方案 | 调用方式及 Windows CPU 条件 | 体积与适用判断 |
| --- | --- | --- |
| Transformers.js + OPUS-MT Q8 | `@huggingface/transformers`，Node 环境显式指定 `device: 'cpu'`、`dtype: 'q8'`；官方稳定版后端包含 CPU 映射。[后端源码](https://github.com/huggingface/transformers.js/blob/3.8.1/src/backends/onnx.js) | 所选 ONNX 权重约 **113.1 MB/方向，双向约 226.2 MB**，详见下一节。适合当前 JavaScript/Electron 工程；仍须验证打包后的原生运行库、模型加载和译文质量。 |
| CTranslate2 + OPUS-MT INT8 | 官方 Python/C++ 接口；Windows x86-64 wheel，Python ≥3.9、VC++ runtime；CPU 使用 INT8，不要求 CUDA。[安装要求](https://opennmt.net/CTranslate2/installation.html)、[CPU 性能建议](https://opennmt.net/CTranslate2/performance.html) | 原始 PyTorch 权重各 312 MB；转换后的 INT8 文件大小尚未实测。适合作为性能与资源控制的备选，需增加 Python worker 或编译 C++ 程序。[模型文件](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en/tree/main) |
| Argos Translate | Python API / CLI，底层使用 CTranslate2；可设置 CPU、计算精度和线程数。官方包索引确有 `en→zh`、`zh→en` 1.9 包，也有繁体 `zt↔en`。[官方仓库](https://github.com/argosopentech/argos-translate)、[设置源码](https://github.com/argosopentech/argos-translate/blob/master/argostranslate/settings.py)、[包索引](https://raw.githubusercontent.com/argosopentech/argospm-index/main/index.json) | 接入简单，已有分句、语言包管理；索引未列包字节数和参数量，本轮未下载测量。完整 Windows 依赖与打包需实测。 |
| LibreTranslate | Argos 的 HTTP 服务封装，可通过本地 REST API 调用；官方提供 Python / Docker 安装和 Windows Docker 启动说明。[安装文档](https://docs.libretranslate.com/guides/installation/)、[项目说明](https://github.com/LibreTranslate/LibreTranslate) | 与 Argos 共用翻译引擎，多出服务与端口管理。对单机截图工具不作为首选；已有本地服务时可考虑。安装时应限制 `--load-only en,zh`，避免默认加载所有语言。 |

## OPUS-MT 的实际文件和许可

中英互译需要两个方向的模型。Xenova 发布的是供 Transformers.js 使用的 ONNX 转换版本，原始模型来自 Helsinki-NLP；不是重新训练的另一种翻译模型。[英→中转换模型](https://huggingface.co/Xenova/opus-mt-en-zh)、[中→英转换模型](https://huggingface.co/Xenova/opus-mt-zh-en)

| 方向 | 本次选择的 Q8 文件 | 权重合计 | 原始模型卡许可 |
| --- | --- | --- | --- |
| 英文 → 中文 | `encoder_model_quantized.onnx` 52.9 MB + `decoder_model_merged_quantized.onnx` 60.2 MB | 约 113.1 MB。[文件列表](https://huggingface.co/Xenova/opus-mt-en-zh/tree/main/onnx) | **Apache-2.0**。[模型卡](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh) |
| 中文 → 英文 | `encoder_model_quantized.onnx` 52.9 MB + `decoder_model_merged_quantized.onnx` 60.2 MB | 约 113.1 MB。[文件列表](https://huggingface.co/Xenova/opus-mt-zh-en/tree/main/onnx) | **CC-BY-4.0**。[模型卡](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en) |

双向 226.2 MB 是上述四个权重文件的近似加总，**不含 tokenizer、配置、运行库、程序安装体积或运行内存**。模型仓库还包含 FP32、FP16、其他量化及解码器变体，不能将整个仓库下载量当成所选方案的必需体积。稳定版源码将 `dtype: 'q8'` 映射到 `_quantized` 文件后缀。[Q8 文件映射](https://github.com/huggingface/transformers.js/blob/3.8.1/src/utils/dtypes.js)

英→中模型卡要求句首目标语言 token，简体普通话候选为 `>>cmn_Hans<<`；实现时应结合实际 tokenizer 验证，不应忽略语言标记。模型卡记录原始训练权重日期为 2020-07-17，因此仍需以真实 OCR 短句、菜单和技术文本评估翻译效果。[输入规范与训练日期](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh)

运行库与模型许可证需要分开记录：Transformers.js 为 Apache-2.0，CTranslate2 为 MIT；OPUS 两个方向的许可不同。Argos 代码和索引仓库声明 MIT/CC0，但索引没有逐模型包的独立许可字段，正式分发前应核对所选包附带说明。LibreTranslate 服务为 AGPL-3.0。[Transformers.js 许可](https://github.com/huggingface/transformers.js/blob/3.8.1/LICENSE)、[CTranslate2 许可](https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE)、[Argos 许可](https://github.com/argosopentech/argos-translate#license)、[Argos 索引许可](https://github.com/argosopentech/argospm-index#license)、[LibreTranslate 许可](https://github.com/LibreTranslate/LibreTranslate#license)

## 稳定版调用与离线模式

本次查阅时，Transformers.js 文档将 **v3.8.1** 标为 npm 稳定版；`main` 是开发分支。其 Electron 页面主要提供示例入口，不能据此认定当前项目已完成 Electron 适配。下面仅演示经稳定版 API 核实的 Node 调用形状，不是已经接入的项目代码。[版本说明](https://huggingface.co/docs/transformers.js/en/index)、[Electron 示例入口](https://huggingface.co/docs/transformers.js/v3.8.1/en/tutorials/electron)、[Node 文档](https://huggingface.co/docs/transformers.js/v3.8.1/tutorials/node)、[量化参数](https://huggingface.co/docs/transformers.js/v3.8.1/guides/dtypes)

```js
// 设计示意：应放在独立 Node worker / utilityProcess 中。
// modelRoot 必须是已准备好模型、配置与 tokenizer 的本地绝对路径。
import { env, pipeline } from '@huggingface/transformers';

env.localModelPath = modelRoot;
env.allowLocalModels = true;
env.allowRemoteModels = false;

const translate = await pipeline('translation', 'Xenova/opus-mt-zh-en', {
  device: 'cpu',
  dtype: 'q8',
});

const result = await translate('请先保存当前截图。');
```

`localModelPath` 指向模型根目录，目录下保留 `Xenova/opus-mt-zh-en/` 的配置、tokenizer 与 `onnx/` 结构；`allowRemoteModels = false` 禁止模型文件缺失时回退远程下载。下载/导入模型应由单独的安装流程负责，正常翻译只读取本地资源。[环境配置 API](https://huggingface.co/docs/transformers.js/v3.8.1/api/env)、[模型目录与 pipeline](https://huggingface.co/docs/transformers.js/v3.8.1/pipelines)

该示意针对 Node CPU 后端。若改用浏览器 Web Worker 的 WASM 后端，还必须把 WASM 运行资源部署到本地；仅关闭远程模型并不代表所有运行资源都已离线。[后端资源加载源码](https://github.com/huggingface/transformers.js/blob/3.8.1/src/backends/onnx.js)

CTranslate2 备选可在构建阶段通过 `ct2-transformers-converter` 转换 OPUS 模型并指定 `--quantization int8`，运行时用 `ctranslate2.Translator(..., device='cpu', compute_type='int8')`；Electron 经 JSONL 标准输入输出调用常驻 Python worker。Argos 则直接用 `argostranslate.translate.translate(text, 'en', 'zh')` 或其 CLI。[MarianMT 转换与推理](https://opennmt.net/CTranslate2/guides/transformers.html#marianmt)、[CTranslate2 量化](https://opennmt.net/CTranslate2/quantization.html)、[Argos 调用示例](https://github.com/argosopentech/argos-translate#examples)

## 其他模型与本地运行器

| 候选 | 已核实的体积 / 参数 | 许可与建议 |
| --- | --- | --- |
| NLLB-200 distilled 600M | 600M 参数，原始 PyTorch 权重 **2.46 GB**，可做多语翻译。[模型卡](https://huggingface.co/facebook/nllb-200-distilled-600M)、[文件](https://huggingface.co/facebook/nllb-200-distilled-600M/tree/main) | **CC-BY-NC-4.0**；模型卡定位研究和单句翻译，非商业限制不适合作为产品默认模型。 |
| MADLAD-400 3B | 官方模型页面给出原始权重 **11.8 GB**，Q4K GGUF **1.65 GB**，并提供 Candle `quantized-t5` 调用示例。[模型卡](https://huggingface.co/google/madlad400-3b-mt) | **Apache-2.0**；可作为多语扩展包评估。CPU 开销与质量需实测，不能仅因文件是 GGUF 就认定任意 Ollama/llama.cpp 版本都能直接加载。 |
| TranslateGemma 4B | Ollama `translategemma:4b` 标注实际 **4.3B**、**Q4_K_M 3.3 GB**；系列支持 55 种语言。[Ollama 模型页](https://ollama.com/library/translategemma:4b) | **Gemma 自定义条款**，不是 Apache-2.0；可作为用户自行安装的增强选项，不建议默认附带。[Gemma 条款](https://ai.google.dev/gemma/terms) |
| Ollama 运行器 | Windows 原生后台运行，通过 `localhost:11434` API 调用。官方标准 Windows 安装要求本体至少 **4 GB 磁盘空间**，模型另占空间。[Windows 文档](https://docs.ollama.com/windows) | 运行器代码 **MIT**，模型各自许可；它是运行器，不是翻译模型。适合兼容用户已有的本地服务，不能把 3.3 GB TranslateGemma 权重写成完整部署体积。[运行器许可](https://github.com/ollama/ollama/blob/main/LICENSE) |

维护情况参考：CTranslate2 的 PyPI 当前版为 4.8.5（2026-11-02），Argos 为 1.11.0（2026-02-02），LibreTranslate 为 1.9.6（2026-05-26）。这些是运行库/服务发布日期，不代表其语言模型同期重新训练。[CTranslate2](https://pypi.org/project/ctranslate2/)、[Argos](https://pypi.org/project/argostranslate/)、[LibreTranslate](https://pypi.org/project/libretranslate/)

## 与截图工具的衔接建议

以下为后续实施建议，本轮没有实现：

1. **按需下载、懒加载。** 首次启用时选择中→英或英→中，把对应模型、配置、tokenizer、校验信息及许可保存到应用用户数据目录；正常启动和 Alt+A 截图时不加载翻译模型。
2. **独立执行。** 在 worker / Electron `utilityProcess` 中完成推理，主进程只调度；限制并发与 CPU 线程，闲置时释放模型。翻译不得阻塞 Alt+A、截图遮罩、框选和保存。
3. **延续现有 OCR 侧栏。** 以 OCR 原图段落为输入，保留 `paragraphId`、原文和坐标；译文在该段落下逐条展示，不新增 Dialog 或独立系统页面，也不把译文或 OCR 虚拟框绘入保存图片。
4. **管理任务生命周期。** 请求携带截图 ID、段落 ID 和请求版本；切换截图或关闭窗口后丢弃过期结果，提供取消、重试和仅翻译当前段落。长段落分句后还原到同一段落，不静默截断。
5. **再作性能决策。** 选定模型 revision 与运行库版本后，在 Windows 打包产物中验证彻底断网运行、中文路径和模型缺失提示；测冷启动、短句/长段落延迟、峰值内存、空闲释放、截图并发响应和中英质量，再决定是否换用 CTranslate2。不承诺尚未实测的秒数或内存占用。

Electron 的 `utilityProcess` 官方提供子进程与消息通信能力，可作为隔离推理任务的实现基础；其与 ONNX 原生依赖的实际打包组合仍需项目验证。[Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
