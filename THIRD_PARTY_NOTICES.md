# 第三方组件与模型许可

繁花有图的 MIT 许可证适用于本项目原创源码和文档。第三方组件、模型、字体和运行库保留各自的版权与许可证，不因随本项目使用或分发而改为 MIT。

本文件是主要组件的许可索引，不替代上游完整的 `LICENSE`、`NOTICE`、版权声明或源码提供要求。依赖的实际版本以 `package-lock.json` 为准；翻译模型的固定 revision、文件大小和 SHA-256 以 `resources/translation/manifest.json` 为准。

## 软件组件

| 组件 | 用途 | 上游许可与来源 |
| --- | --- | --- |
| Electron | 桌面运行时、窗口、托盘与系统能力 | [MIT](https://github.com/electron/electron/blob/main/LICENSE)；Chromium、Node.js 等组成部分另有许可，完整运行时中的 `LICENSE` 与 `LICENSES.chromium.html` 应一并保留。 |
| Vue 3 | 界面框架 | [MIT](https://github.com/vuejs/core/blob/main/LICENSE)。 |
| Ant Design Vue | 界面组件 | [MIT](https://github.com/vueComponent/ant-design-vue/blob/main/LICENSE)。 |
| Lucide Vue Next | 界面图标 | [ISC，含来自 Feather 的 MIT 声明](https://github.com/lucide-icons/lucide/blob/main/LICENSE)，须保留两部分声明。 |
| Vite | 前端开发与构建 | [MIT](https://github.com/vitejs/vite/blob/main/LICENSE)。 |
| PDF.js / pdfjs-dist | PDF 解析与渲染 | [Apache-2.0](https://github.com/mozilla/pdf.js/blob/master/LICENSE)；字体、CMap、ICC 和 WASM 资源还有独立许可，见下文。 |
| pdf-lib | PDF 导出 | [MIT](https://github.com/Hopding/pdf-lib/blob/master/LICENSE.md)。 |
| Tesseract.js | 本地 OCR 回退 | [Apache-2.0](https://github.com/naptha/tesseract.js/blob/master/LICENSE.md)。 |
| Transformers.js | 本地翻译推理接口 | [Apache-2.0](https://github.com/huggingface/transformers.js/blob/3.8.1/LICENSE)。 |
| ONNX Runtime | CPU 模型推理 | 当前 Node 运行库为 1.21.0，[MIT 全文](https://github.com/microsoft/onnxruntime/blob/v1.21.0/LICENSE)与[第三方声明](https://github.com/microsoft/onnxruntime/blob/v1.21.0/ThirdPartyNotices.txt)由上游提供；附带的运行库组件遵循各自许可。 |
| Sharp | 图片编码与解码 | [Apache-2.0](https://github.com/lovell/sharp/blob/v0.34.5/LICENSE)；Windows 原生包和底层库的许可见下文。 |

## Windows 原生图片库

当前使用的 `@img/sharp-win32-x64` 0.34.5 声明为 **Apache-2.0 AND LGPL-3.0-or-later**。其 libvips、GLib 等底层库与其他图像解码库分别遵循 LGPL、BSD、MIT、MPL 等许可，不能把整个原生包视为只有 Apache-2.0。

依赖安装后，第三方库许可表位于 `node_modules/@img/sharp-win32-x64/README.md`，实际组件版本位于同目录的 `versions.json`。上游源码、构建方法与许可信息见 [Sharp](https://github.com/lovell/sharp/tree/v0.34.5) 和 [sharp-libvips](https://github.com/lovell/sharp-libvips)。分发或修改相关二进制时，应按所包含组件的许可保留声明，并满足相应的源码提供等要求。

## PDF 资源

`scripts/prepare-pdf-assets.mjs` 从固定版本的 `pdfjs-dist` 复制运行所需资源及其许可文件。PDF.js 主库的 Apache-2.0 不覆盖全部配套资源：

- Liberation 字体：`standard_fonts/LICENSE_LIBERATION` 中的 GPL-2.0 及字体嵌入等例外条款。
- Foxit 字体：`standard_fonts/LICENSE_FOXIT` 中的版权与许可声明。
- CMap、ICC 和 WASM 解码资源：各自目录中的 `LICENSE*` 文件。

源码依赖中的许可位于 `node_modules/pdfjs-dist/`；构建时复制到 `dist/pdf-assets/`，并随应用内容打包。更新 PDF.js 或调整资源复制规则时，应同时保留对应许可。

## OCR 语言数据

简体中文和英文数据来自 Tesseract.js 官方语言数据包 1.0.0 的 `4.0.0_best_int` 版本，上游语言模型采用 **Apache License 2.0**。

来源与校验值见 `resources/ocr/README.txt`，完整许可见 `resources/ocr/LICENSE.txt`。上游项目为 [naptha/tessdata](https://github.com/naptha/tessdata) 和 [tesseract-ocr/tessdata](https://github.com/tesseract-ocr/tessdata)。这些来源说明和许可文件随 OCR 数据一起分发。

## 中英翻译模型

原始模型作者为 **University of Helsinki, Language Technology Research Group / Helsinki-NLP**。相关研究为 Jörg Tiedemann 与 Santhosh Thottingal 的 *OPUS-MT — Building open translation services for the World*（EAMT 2020）。ONNX 转换及 Q8 量化版本由 **Xenova** 提供。

| 方向 | 原始模型 | 许可 | 使用的转换版本 |
| --- | --- | --- | --- |
| 英文 → 简体中文 | [Helsinki-NLP/opus-mt-en-zh](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh) | Apache-2.0 | [Xenova，revision 046f55a](https://huggingface.co/Xenova/opus-mt-en-zh/tree/046f55aec303cdee3e0318604406d4df20f1e8ea) |
| 中文 → 英文 | [Helsinki-NLP/opus-mt-zh-en](https://huggingface.co/Helsinki-NLP/opus-mt-zh-en) | CC BY 4.0 | [Xenova，revision 39d480d](https://huggingface.co/Xenova/opus-mt-zh-en/tree/39d480d52a9ea3065a1f117adfe4dbc55de10e6f) |

本项目未重新训练模型或修改下载文件，仅选取运行所需的 ONNX Q8、配置和分词器文件。原作者与转换版本发布方不为本应用或译文质量背书。

`resources/translation/README.md` 保留完整署名、来源和转换说明；`LICENSE-APACHE-2.0.txt` 与 `LICENSE-CC-BY-4.0.txt` 保留两种许可全文。分发模型时应一并保留；尤其不能省略中译英模型的 CC BY 4.0 署名及来源信息。

## 再分发说明

- 保留项目 MIT 文本及各组件原有的版权、许可证和第三方声明；本索引不能替代这些文件。
- 对照实际构建所包含的版本检查声明。某些 npm 包只提供许可链接，发布完整运行库时仍需从相应上游版本取得所需文本。
- 项目源码采用 MIT，不等于整个安装包的全部组成部分均采用 MIT。修改或重新分发第三方代码、模型与原生运行库时，应遵循它们各自的许可。
- LocalSend 和 DeskFlow 是用户独立安装的应用，本项目通过文件交接或系统剪贴板与其协作，不随本仓库分发它们的程序。
