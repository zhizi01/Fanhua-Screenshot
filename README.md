<p align="center">
  <img src="build/icon.png" width="96" height="96" alt="繁花有图图标" />
</p>

# 繁花有图

[![版本 0.26.1](https://img.shields.io/badge/version-0.26.1-7860d2)](https://github.com/zhizi01/Fanhua-Screenshot/releases)
[![Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D4)](#安装与使用)
[![MIT License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

一款面向 Windows 的开源截图与图片标注工具。启动后驻留系统托盘，按下快捷键即可截图，在独立窗口中完成编辑、文字识别、中英翻译和分享。

基于 **Vite + Vue 3 + Ant Design Vue + lucide-vue-next + Electron** 开发。截图、标注、OCR 与翻译均在本机完成，无需账号、API Key 或额外部署模型服务。

[下载版本](https://github.com/zhizi01/Fanhua-Screenshot/releases) · [反馈问题](https://github.com/zhizi01/Fanhua-Screenshot/issues) · [从源码运行](#开发与构建) · [开源许可](#开源许可)

## 功能概览

| 场景 | 功能 |
| --- | --- |
| 快速截图 | 全局快捷键、冻结桌面遮罩、拖动框选、鼠标所在窗口自动识别。 |
| 图片标注 | 文字、序号、箭头、方框、圆形与马赛克，支持重新编辑、删除、撤销和重做。 |
| 图片水印 | 文字 / 图片水印、九宫格定位、平铺、透明度与命名存档。 |
| 文字识别 | 本地中英文 OCR、段落列表、原图位置标记与双向定位。 |
| 中英翻译 | 本机 CPU 离线推理，译文同时显示在原位置和段落列表。 |
| PDF | 按页查看和标注，导出当前页图片或当前页 / 全部页面 PDF。 |
| 保存与分享 | PNG、JPEG、WebP、BMP、PDF；普通剪贴板、DeskFlow、LocalSend。 |
| 桌面集成 | 预览置顶、自定义快捷键、开机启动，以及可选的资源管理器右键菜单。 |

## 安装与使用

当前面向 **Windows x64**，不提供 macOS、Linux 或 Windows ARM64 构建。

在 [GitHub Releases](https://github.com/zhizi01/Fanhua-Screenshot/releases) 查看可用下载。安装包名称为 `Fanhua-Screenshot-0.26.1-Setup.exe`，支持选择安装目录；如果该页暂未提供附件，可按下文自行构建。GitHub 自动生成的 **Source code** 压缩包是源码，不能直接运行。

如果使用 `win-unpacked` 程序目录，运行其中的 `繁花有图.exe` 即可，须保留整个目录中的文件，不能只复制 EXE。

1. 启动后，程序驻留系统托盘，默认显示准备就绪通知。
2. 按 **Alt + A** 发起截图，在桌面遮罩上拖动框选；单击自动识别的窗口可截取该窗口。按 `Esc` 取消。
3. 截图成功后显示独立预览，可置顶、编辑、复制、共享或保存。关闭预览不自动保存。
4. 双击托盘图标打开设置；右键托盘可截图、打开图片 / PDF 或退出。关闭设置后程序继续驻留托盘。

截图遮罩在后台预加载并复用。多显示器分别提供遮罩，一次框选限于一块显示器；跨屏窗口只截取当前屏幕内的可见部分。

截图快捷键可在设置中修改；新组合被占用时会提示，并保留原快捷键。

## 编辑与水印

| 工具 | 能力 |
| --- | --- |
| 文字 | 多行批注，可再次选择、移动、修改字体、字号和颜色，或删除。 |
| 序号 | 支持数字、字母和中文大写，可添加说明；序号头大小与说明字号独立设置。 |
| 箭头 | 拖动绘制，选中后移动整体或调整两端，设置颜色、线宽和箭头大小。 |
| 方框 / 圆形 | 绘制矩形或椭圆，按住 `Shift` 约束为正方形或正圆；支持实线、虚线、点线及边框粗细、颜色。 |
| 马赛克 | 框选区域并调整强度，可重新移动、修改或删除。 |
| 水印 | 文字或 PNG / JPEG 图片，支持九宫格位置、全图平铺、透明度、旋转、边距与间距，可命名存档。 |

字体列表读取系统与当前用户安装的字体，支持搜索和刷新。标注与水印支持撤销、重做；导出前的马赛克可删除并恢复原始画面。水印存档保存在本机，最多 30 个、合计 64 MB。

右键图片可进入编辑、复制或保存；右键标注可选中并修改、删除。按住 `Ctrl` 滚动鼠标滚轮可缩放画面，也可恢复 100% 或适应窗口；查看比例不改变导出尺寸。

## OCR 与中英翻译

“识别文字”在右侧按段落显示结果，在图片对应位置绘制虚线框和轻微遮罩。点击识别区域或段落可双向定位，可修正原文并复制单段或全部文字。

OCR 只读取本次打开的原图或 PDF 当前页，不识别之后添加的标注、水印或马赛克。因此本次打码覆盖的原始文字仍可识别；重新打开已经导出的图片时，合成的标注已经属于图片像素，无法自动分离。

翻译支持英文 → 简体中文、中文 → 英文，可处理全部段落或单段。译文显示在右侧，并在原识别位置覆盖显示；区域过小时可在右侧查看全文。**识别框和译文均为虚拟显示，不进入保存、复制或共享的图片。**

OCR 优先使用 Windows 本地能力，安装包附带 Tesseract 简体中文和英文模型作为回退。翻译使用随包提供的 OPUS-MT Q8 模型在本机 CPU 上运行，无需 Python、API Key 或额外模型服务，不上传图片或文字。模型按需加载，空闲一分钟后释放；识别和翻译效果受图片清晰度、排版、术语及上下文影响。

翻译实现与限制见 [本地翻译说明](docs/LOCAL_TRANSLATION.md)，模型来源、固定版本和许可证见 [翻译模型说明](resources/translation/README.md)。

## PDF

从托盘打开 PDF 后，在同一预览窗口切换页面。每页独立保留标注、水印、撤销记录和保存状态。OCR、翻译、复制和共享作用于当前页；翻页后识别面板会处理最新停留的页面，不沿用旧页结果。

保存图片格式只输出当前页；保存 PDF 可选择当前页或全部页面。普通图片也可保存为单页 PDF。PDF 输出保留原页面尺寸与朝向，但会合成为静态图片，**不保留可选文字、链接或交互表单**。导出合成阶段可取消，最后写入阶段等待保存完成；编辑本身不改写源文件。

支持最多 200 页、96 MB 的输入 PDF，暂不支持需要密码的文件。默认按 144 DPI 渲染，大页按 1600 万像素和 8192 像素单边上限等比缩小。完整限制及实现见 [PDF 支持说明](docs/PDF.md)。

## 保存、复制与共享

点击保存或按 `Ctrl + S`，选择格式后通过系统对话框选择位置。支持 PNG、JPEG、WebP、BMP、PDF；JPEG / WebP 质量可选 10%～100%。PNG / WebP 保留透明背景，JPEG / BMP 的透明区域填白。保存会合并当前标注与水印，不包含可编辑图层数据。

- **复制到剪贴板**：编辑后的无损 PNG；直接点击“复制”或按 `Ctrl + C` 使用此方式。
- **复制到 DeskFlow 剪贴板**：原尺寸 JPG，质量 60%，透明部分填白。提示为“由于DeskFlow传输有限制，会造成质量压缩。”。
- **共享 → 通过LocalSend共享**：将编辑后的 PNG 交给本机 LocalSend，并打开其发送界面。用户在 LocalSend 选择接收设备后才会发送。

DeskFlow 使用系统剪贴板，其 Windows 图片转换可能产生未压缩位图，JPG 文件变小不保证同步数据量变小或绕过大小限制。本工具不修改 DeskFlow 配置，详见 [DeskFlow 剪贴板说明](docs/DESKFLOW.md)。

LocalSend 需单独安装。程序支持自动查找，也可在“设置 → 共享”指定主程序或恢复自动。共享临时 PNG 保留供 LocalSend 读取，应用启动或再次共享时清理超过 7 天的本应用共享文件。详见 [LocalSend 集成说明](docs/LOCALSEND.md)。

## 设置

设置按当前 Windows 用户保存，分为常规、编辑默认、保存与识别、共享：

- 常规：开机启动、启动通知、资源管理器右键菜单、截图后直接编辑、自定义截图快捷键。
- 编辑默认：系统字体、字号、颜色、序号、箭头、边框和马赛克参数。
- 保存与识别：默认格式、质量、PDF 导出范围、OCR 语言及中英翻译方向。
- 共享：管理 LocalSend 程序位置。

自定义截图快捷键使用修饰键和主键选择器，点击“应用快捷键”立即生效，也可恢复 `Alt + A`。字母、数字和导航键需包含 Ctrl、Alt 或 Win；F1～F24、PrintScreen 可使用单键，Esc 保留用于取消截图。组合被占用或保存失败时保留原快捷键与已保存配置。

资源管理器右键菜单默认关闭，需在设置中主动开启，菜单名称为“使用繁花有图编辑”。支持 PNG、JPEG、静态 WebP、未压缩 BMP 和 PDF；Windows 11 通常需选择“显示更多选项”。只注册到当前用户，不修改默认打开软件，源码开发模式不可注册。

编辑、保存与识别默认值只应用于之后新打开的图片 / PDF 窗口，不改动当前编辑。PDF 原稿仍默认保存为 PDF。偏好、LocalSend 路径与水印存档分别位于应用用户数据目录的 `settings.json`、`localsend.json`、`watermarks.json`。

## 开发与构建

需要 **Windows x64、Git、Node.js 22.13 或更高版本，以及 npm**。源码与文档使用 UTF-8。首次安装依赖和准备翻译模型需要联网；完整程序运行时使用本地模型。

```powershell
git clone https://github.com/zhizi01/Fanhua-Screenshot.git
cd Fanhua-Screenshot
npm ci
npm run models:prepare
npm run dev
```

`dev` 同时启动 Vite 和 Electron，并打开设置窗口。`npm run dev:web` 仅用于浏览器端界面开发，不提供截图、托盘、全局快捷键或其他桌面能力；调试完整功能请使用 `npm run dev`。

两个翻译方向的模型合计约 **239 MB**，准备脚本从固定版本下载并校验 SHA-256，已有完整文件会复用。权重不纳入 Git，源码压缩包也不包含这些文件。下载失败后可重新执行 `npm run models:prepare`。

构建前端并运行桌面应用：

```powershell
npm run typecheck
npm run build
npm start
```

源码启动前须先运行 `npm run build`。`npm start` 默认驻留托盘；`npm start -- --show-settings` 直接打开设置。开发与构建入口自动执行 `pdf:prepare`，从固定依赖复制 PDF.js 本地资源。根目录的 `dist/` 与 `public/pdf-assets/` 为可重新生成的构建文件，不作为源码交付内容保留。

生成 Windows 发布产物：

```powershell
npm run models:check
npm run pack
npm run dist
```

- `models:prepare` 下载并校验固定版本的翻译模型；`models:check` 只检查本地文件大小与 SHA-256，不联网。
- `pack` 生成 `release/0.26.1/win-unpacked/`；`dist` 生成 `release/0.26.1/Fanhua-Screenshot-0.26.1-Setup.exe`。两者在打包前检查模型完整性。
- 仅发布 Windows x64；开发、启动、构建与打包均检查目标平台。未配置代码签名证书。
- OCR 与翻译资源分别位于 `resources/ocr/`、`resources/translation/`，随完整程序分发。请保留模型来源、署名和许可证文件；可重复下载的翻译权重不纳入 Git。

本地发布产物位于：

```text
release/0.26.1/
├── Fanhua-Screenshot-0.26.1-Setup.exe
└── win-unpacked/
    ├── 繁花有图.exe
    └── …运行所需的完整资源与依赖
```

向 GitHub Releases 上传安装包时，`win-unpacked/` 可整体压缩后作为另一个附件提供。构建产物和 `node_modules/` 已被 Git 忽略，无需提交到源码仓库。

## 常用快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Alt + A` | 全局截图，默认值，可在设置中修改。 |
| `Esc` | 取消截图；在编辑器内取消当前操作或退出当前选择。 |
| `Ctrl + S` | 打开保存选项。 |
| `Ctrl + C` | 将编辑后的图片以 PNG 复制到剪贴板。 |
| `Ctrl + Z` | 撤销标注或水印修改。 |
| `Ctrl + Y` / `Ctrl + Shift + Z` | 重做。 |
| `Delete` / `Backspace` | 删除选中的标注。 |
| `Ctrl + 鼠标滚轮` | 缩放画面。 |
| `V` / `T` / `N` / `A` / `R` / `O` / `M` | 编辑模式中切换选择、文字、序号、箭头、方框、圆形、马赛克。 |

除全局截图外，上述快捷键在对应窗口和模式中使用；输入框内保留文字输入、复制等操作。

## 本地数据与功能边界

- 截图、图片编辑、PDF 处理、OCR 和翻译在本机运行；识别与翻译不会上传图片或文字。
- 设置、水印存档和 LocalSend 路径保存在当前用户的应用数据目录；应用没有截图历史或自动保存功能。
- LocalSend 仅在主动共享时接收导出的图片，接收设备选择和传输由 LocalSend 完成。复制到剪贴板后的内容可被 DeskFlow 等剪贴板软件读取和同步。
- 识别框和译文不写入导出文件；OCR 读取原图，编辑过程中添加的马赛克不会阻止 OCR 读取该处的原始文字。
- PDF 导出为静态合成页面，不保留可选文字、链接、交互表单或可再次编辑的标注图层。
- 当前不支持跨屏连续框选、其他翻译语言、密码保护 PDF 或可编辑项目文件。OCR 和翻译结果仍需按用途核对。

## 项目结构

```text
electron/              Electron 主进程、预加载与 Windows 原生能力
src/                   Vue 界面、截图交互、编辑器和 PDF 页面状态
scripts/               开发启动、资源准备与 Windows 构建工具
resources/ocr/         OCR 语言数据、来源与许可证
resources/translation/ 翻译模型清单、来源、许可证和本地权重
build/                 应用图标与 Windows 安装脚本
docs/                  架构与功能说明
LICENSE                项目 MIT 许可证
THIRD_PARTY_NOTICES.md  第三方组件与模型许可索引
```

## 参与贡献

欢迎通过 [Issues](https://github.com/zhizi01/Fanhua-Screenshot/issues) 反馈问题或提出建议，通过 [Pull Requests](https://github.com/zhizi01/Fanhua-Screenshot/pulls) 提交改进。

- 反馈问题时请提供应用版本、Windows 版本、复现步骤、预期与实际表现；涉及截图位置时，可补充显示器数量与缩放比例。示例图片请先移除私人信息。
- 较大改动建议先开 Issue 讨论。提交 PR 时说明改动目的、影响范围和实际验证结果，新增功能同步更新文档。
- 提交前运行 `npm run typecheck` 和 `npm run build`，并在 Windows 桌面版确认相关操作。不要提交依赖目录、构建产物或模型权重；源码保持 UTF-8。
- 提交原创代码时，请确认你有权提供该贡献，并同意按本项目 MIT 许可证分发。引入第三方代码、素材或模型时，保留其来源和原有许可。

## 更多文档

| 文档 | 内容 |
| --- | --- |
| [架构说明](docs/ARCHITECTURE.md) | 进程职责、截图坐标、编辑模型与系统集成。 |
| [PDF 支持](docs/PDF.md) | 页面处理、导出行为和输入限制。 |
| [本地翻译](docs/LOCAL_TRANSLATION.md) | CPU 推理、任务管理和语言限制。 |
| [翻译模型](resources/translation/README.md) | 固定版本、模型来源、署名与许可证。 |
| [LocalSend 集成](docs/LOCALSEND.md) | 程序发现、文件交接与临时文件管理。 |
| [DeskFlow 剪贴板](docs/DESKFLOW.md) | JPG 60% 复制方式与传输限制。 |

## 开源许可

繁花有图的原创源码和文档采用 [MIT License](LICENSE)，版权归 **© 2026 zhizi01 and contributors**。在保留版权声明和许可文本的前提下，允许使用、修改、分发及商业使用；软件按原样提供，完整条款以许可证文件为准。MIT 标准文本见 [Open Source Initiative](https://opensource.org/license/mit)。

**MIT 仅适用于本项目原创内容，不替代第三方依赖、模型、字体及运行库的许可证。** 例如：

| 内容 | 适用许可 |
| --- | --- |
| 本项目原创源码和文档 | [MIT](LICENSE) |
| Tesseract 中英文 OCR 数据 | [Apache-2.0](resources/ocr/LICENSE.txt) |
| OPUS-MT 英文 → 中文模型 | [Apache-2.0](resources/translation/LICENSE-APACHE-2.0.txt) |
| OPUS-MT 中文 → 英文模型 | [CC BY 4.0](resources/translation/LICENSE-CC-BY-4.0.txt) |
| Sharp 的 Windows 原生组件 | Apache-2.0 及 LGPL-3.0-or-later；底层库还有各自许可。 |
| PDF 字体、解码器及其他依赖 | 分别遵循上游许可，详见[第三方许可索引](THIRD_PARTY_NOTICES.md)。 |

第三方项目的署名、来源及许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；模型的固定版本与转换说明见[翻译资源文档](resources/translation/README.md)。重新分发时请保留对应的版权、许可证和第三方声明。
