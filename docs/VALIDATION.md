# 验证记录

## 1.6.0：PDF 分页编辑与图片／PDF 导出

日期：2026-11-04。环境继续为 Windows 11 x64 / Electron 45.2.1。使用隔离用户数据目录和本地生成的测试 PDF；保留原有 `tests/` 文件删除，未恢复或提交这些删除，未运行安装程序或修改系统注册表。

- `npm run dist` 通过：类型检查、Vite、PDF.js 6.5.438 的本地资源准备、14 个离线翻译模型校验、Windows x64 与 NSIS 打包均成功。PDF 解析代码按需加载，本地 PDF 资源 200 个文件、约 4 MB；无需 CDN。
- `verify-pdf-service.cjs` 通过：实际 pdf-lib 生成两页 PDF 并检查页尺寸、顺序、像素与透明度；覆盖 96 MB 输入、200 页、1600 万像素、128 MB 限制、窗口归属、保存路径互斥、取消对话框不加载依赖、取消/关闭/退出清理，以及写入/rename 失败时旧文件保持。
- 服务自审补充拒绝 APNG、重复 IHDR、截断 PNG 块、损坏 IDAT；PNG 在交给 pdf-lib 前由 Sharp 限像素解码与规范化。新增真实临时文件碰撞回归，验证 `wx` 创建失败不会删除原有同名文件。服务报告无临时文件遗留。
- `verify-pdf-renderer.cjs` 使用真实 Electron `file://`：标准字体与 Symbol/PFB、非嵌入 GB1 中文/CMap、CMYK、Rotate/CropBox/UserUnit、大页自动限幅均通过。确认使用实际 worker、本地字体文件且没有远程请求；中文页面已人工检查。201 页、损坏、密码 PDF 提示、嵌入脚本不执行、替换渲染取消、取消后重试和销毁中断均通过。
- `verify-pdf-assets.cjs` 验证最终 ASAR 中 200 项 PDF 资源及 manifest（201 文件）逐项 SHA-256 与构建输入一致；最终 EXE 实际从 ASAR 读取中文 `UniGB-UCS2-H`、`Adobe-GB1-UCS2` 和 `FoxitSymbol`，响应字节与原资源一致。中文“繁花有图 中文测试”及 ΣπΩ 字形和真实 worker 通过，截图人工检查正常，无远程请求或页面错误。
- `verify-pdf-ui.cjs` **源码与最终打包程序均通过**：逐页文字、水印和撤销记录独立；持有旧 OCR 任务时连续切到第 2/3/2 页，旧任务结束后仅追加最新第 2 页识别，无旧结果串页。OCR 接收的原始页面像素不含文字批注和水印。
- 界面实际保存全部三页 PDF，逐页重新打开并与导出前合成 PNG 比较像素；页面尺寸依次为 500×300、360×480、420×280 PDF 点，原顺序和旋转后的显示尺寸正确。另验证当前页 PNG、单页 PDF、普通图片转 PDF（96 DPI）及输入文件 SHA-256 未改变。没有页面错误或远程请求。
- 导出取消实测：逐页添加期间锁定编辑和翻页，取消后恢复；已存在的目标文件内容完全保留，当前页仍标记未保存，没有 `.fanhua-*.pdf.tmp` 遗留。损坏 PDF 显示可恢复错误。
- 最终 EXE 的 `verify-windows-integration.cjs` 通过：PNG 首启及 JPG/JPEG/WebP/BMP/PDF 五次真实 second-instance 转发，PDF 首次启动与二次启动均直接进入编辑；页导航与实际画布可用、先前编辑保留、不打开设置。普通启动只驻留托盘，三次正常退出成功，无页面错误。PDF 注册宏已随 NSIS 编译，未执行安装器实测资源管理器菜单。
- 普通图片的源码 `verify-sharing-ui.cjs`、`verify-context-menu.cjs`、`verify-translation.cjs` 全部通过：PNG/DeskFlow 实际剪贴板、LocalSend 启动替身交接、共享与右键菜单、窄窗布局、OCR/双向翻译/译文覆盖与导出隔离、取消及子进程恢复均无回归。本轮没有实际向设备发送文件。
- 源码 UTF-8 严格解码与 Git 空白检查通过；没有将测试生成的 PDF 或截图加入源码提交。

证据：`artifacts/pdf-service/service-regression.json`、`pdf-renderer-regression.json`、`pdf-assets-packaged.json`、`pdf-regression-{source,packaged}.json`、`windows-integration-packaged.json` 及对应界面 PNG。导出的多页 PDF 和当前页图片保存在忽略的 `artifacts/`，仅用于回归验证。

安装包：`release/1.6.0/Fanhua-Screenshot-1.6.0-Setup.exe`，340,996,843 字节。未配置代码签名。

SHA-256：`e29ae9d26ca759ca1f2cbcdd58683cc8208d6f0d7fd1677807b339813ee2f101`。

## 1.5.0：原位译文、图片右键编辑、共享菜单与 Windows 构建

日期：2026-11-03。环境：Windows 11 x64、Node.js 24.16.0、Electron 45.2.1。保留工作区原有 `tests/` 文件删除，没有恢复或提交这些删除；本轮使用 `scripts/verify-*.cjs` 独立脚本与隔离用户数据目录，未关闭用户的旧版程序。

- `npm run dist` 成功：类型检查、Vite、14 个离线模型文件 SHA-256 校验、Windows x64 目录打包及包含中文自定义宏的 NSIS 编译均通过。模型共 238,991,573 字节。
- `npm run test:windows-target` 通过：Windows x64 被接受，非 Windows 主机与 macOS/Linux/ARM64/ia32 目标被拒绝；构建命令和实际 hook 配置一致。
- `verify-windows-integration.cjs` 源码与最终打包版均通过：PNG 首启直接进入编辑，JPG/JPEG/WebP/BMP 四次真实 second-instance 转发正常；原图窗口的文字编辑保留，不打开设置窗口。无参数重启只驻留后台，页面错误为空。WebP 使用打包内 Sharp 成功解码。
- 首轮实测发现 Chromium 会重排二次启动参数，现改用单实例锁 additionalData 携带原始参数，避免 `--edit-image` 与图片路径错位。图片文件名测试包含中文、空格和 `&`。
- 解码回归通过：PNG/JPEG/WebP/BMP、24 位 BMP 补齐行和上下方向、32 位 BI_RGB 保留字节不透明、损坏头/压缩 BMP/超大尺寸/超大文件/缺失文件拒绝、Sharp 仅在 WebP 路径加载。
- `verify-translation.cjs` 源码与最终打包版均通过：真实 OCR 和双向本地模型，图上遮罩译文与右侧段落一致；Ctrl+滚轮缩放及实际滚动后仍对齐，点击联动与悬停全文正常，指针穿透不妨碍编辑。关闭翻译、改原文、换方向和重新 OCR 均正确隐藏或使旧译文失效。
- 译文与 OCR DOM 不进入导出：无编辑的 PNG 导出与原图解码像素完全一致。原有翻译取消、多窗口互斥、翻译期间截图、子进程退出恢复亦通过，无页面错误；已目视检查原位译文截图。
- `verify-sharing-ui.cjs` 与 `verify-context-menu.cjs` 源码和最终打包版均通过，页面错误为空：共享必须先展开并选定唯一“通过LocalSend共享”项，展开或 Esc 不触发共享；菜单键盘操作、互斥及忙态正常。真实 PNG 剪贴板包含标注/水印且保留透明度，DeskFlow JPEG 字节与质量 0.6 编码完全一致，Ctrl+C 仍为 PNG；LocalSend 交接的 PNG 与导出一致。修复了 Ant Dropdown 初次挂载时 ArrowDown 未聚焦菜单项的问题。
- 画布右键覆盖预览进入编辑、命中已有标注并修改、空白处清除旧选择防止误删、删除及撤销/重做、Esc 回到画布；六种绘制工具下右键均不创建标注。共享及右键菜单在 420/360 像素窄窗内无溢出，截图已目视检查。
- 注册表宏静态检查与 NSIS 编译通过：用 SHCTX 跟随当前用户／所有用户安装范围，避免提升到另一管理员账户后误写 HKCU；不改变默认图片关联，卸载只删除仍指向本安装的菜单键。检查了 builder 模板在安装与卸载宏前设置 ShellVarContext。**本轮未执行安装程序或修改系统注册表**，菜单在真实资源管理器中的注册／卸载效果未作为实测通过项；Windows 11 通常在“显示更多选项”中显示传统菜单。
- LocalSend 界面回归使用启动替身，不向设备实际传输；1.4.0 的真实 LocalSend 唤起记录仍保留。源码 UTF-8 严格解码及 Git 空白检查通过。

证据：`artifacts/windows-integration-{source,packaged}.json`、`windows-image-decoder-regression.json`、`translation-regression-{source,packaged}.json`、`translation-overlay-{source,packaged}.png`、`sharing-regression-{source,packaged}.json`、`context-menu-regression-{source,packaged}.json` 及对应界面截图。

安装包：`release/1.5.0/Fanhua-Screenshot-1.5.0-Setup.exe`，336,581,843 字节。未配置代码签名。

SHA-256：`06808210f80fb4ebcf4cf4dc6b24ef5df1e1ea25cbdad72aa6f2ba62c1e5f495`。

## 1.4.0：LocalSend 共享与两种图片复制

日期：2026-11-03。环境继续为 Windows 11 / Electron 45.2.1。本轮保留工作区既有测试文件删除，新增独立脚本验证；没有恢复或提交这些删除。

- `test:clipboard`：真实系统剪贴板 PNG 像素无损；DeskFlow 的原始 JFIF／image/jpeg 字节与质量 60 JPEG 完全一致，通用图像像素等于该 JPEG 解码结果，尺寸不变。错误输入不覆盖剪贴板，再次普通复制清除旧 JPEG 表示。独立测试图 JPEG 60 为 9265 字节、JPEG 100 为 41225 字节，这不是 DeskFlow 网络负载大小。
- `test:localsend`：隔离夹具验证 PNG 字节保留、中文／空格／特殊字符路径作为一个参数传递、已有实例退出、便携路径记忆、选择取消、启动失败删除当次文件、防止重复请求，以及仅清理过期的自有临时文件。
- `test:sharing` 源码与最终 `release/1.4.0/win-unpacked/繁花有图.exe` 均通过。真实 PNG 复制保留透明及文字、箭头、水印；DeskFlow 输入与同一合成画布白底 JPEG 0.6 编码逐字节相同（16788 字节），没有二次有损编码。`Ctrl+C` 始终恢复普通 PNG 模式。
- 分享界面回归验证 LocalSend 获得的 PNG 与当前编辑合成 PNG 完全相同，OCR 虚拟框不进入输出；验证取消、错误提示、失败后重试、忙状态防重复和非预览窗口 IPC 拒绝。此自动检查使用 LocalSend 启动替身，不向设备发送。
- 360／420 宽度预览、菜单及指定 DeskFlow 悬停提示均可见；源码版与打包版截图已目检，无页面异常。
- 最终 EXE 再次通过 OCR 原图隔离回归：两次识别输入仍与原图字节和像素一致；保存文字、水印、箭头保持，剪贴板图像与保存文件像素一致。
- 类型检查、Vite 构建、模型完整性校验、NSIS 构建、UTF-8 严格解码和 Git 空白检查通过。

### 本机真实 LocalSend

新后端实际找到 `D:\AppFile\LocalSend\localsend_app.exe`，版本 1.17.0+58。使用自制 800 × 400 测试 PNG，首次启动和已有实例转交均成功；真实发送界面预选 1 张 16.6 KB 图片，视觉确认了文件名和缩略图。没有点击接收设备或执行传输，未关闭用户的 LocalSend。测试后将窗口最小化，保留预选文件供其读取。

结果文件：`artifacts/image-clipboard-regression.json`、`localsend-verification.json`、`localsend-real-check/launch.json`、`sharing-regression-source.json`、`sharing-regression-packaged.json`、`ocr-source-regression-packaged.json`，界面截图亦位于 `artifacts/`。

### 安装包与边界

安装包：`release/1.4.0/Fanhua-Screenshot-1.4.0-Setup.exe`，336,577,370 字节，保留已有离线 OCR 与翻译模型。

SHA-256：`a4532f2a7921ce34fa43fdae560fbc8fad32944d7bdf06309e83e0368f4aa4ef`。

验证运行打包目录中的 EXE，未执行安装向导。LocalSend 的发现、设备选择、确认与传输由其自身处理，本轮只实测唤起和文件预选。DeskFlow 没有独立于系统的专属剪贴板；官方 Windows 实现读取未压缩位图，JPEG 质量 60 不保证网络数据量等于 JPEG 文件大小，也不保证绕过剪贴板大小限制，未做真实跨设备同步验证。调用依据分别见 [LocalSend 说明](LOCALSEND.md) 和 [DeskFlow 说明](DESKFLOW.md)。

## 1.3.0：中英离线翻译

日期：2026-11-03。Windows 11、Node.js 24.16.0、Electron 45.2.1。本轮保留工作区既有测试文件删除，使用新增的独立脚本验证，不把下方 1.2.0 历史测试计入本轮结果。

- `models:check` 校验两个方向的 14 个文件，合计 238,991,573 字节，所有文件大小和 SHA-256 一致。模型固定 revision，许可与署名随包保留。
- `build` 包含类型检查与 Vite 构建，通过。
- `test:translation:service` 验证输入与长度限制、真实 tokenizer 长文切分、非空白字符完整保留、任务互斥、窗口归属、初始化中取消、运行中取消、重试、空闲释放、模型缺失及服务退出。
- `test:translation:offline` 在翻译子进程中禁止 fetch、HTTP/HTTPS、TCP/TLS 连接，仍完成真实英译中、中译英和方向切换。连续两次中断推理、owner 关闭、直接结束推理进程后，后续请求均恢复成功；结束时没有残留测试翻译进程。
- `test:translation` 在真实 Electron 中从图片 OCR 开始，覆盖双向全部／单段翻译、修改原文使对应译文失效、文字剪贴板、关闭识别栏后恢复结果、取消后重试。保存 PNG 与原图逐像素相同，OCR 修正文字、虚拟框及译文均未进入图片。
- 界面回归同时验证非预览窗口的翻译 IPC 被拒绝、其他预览不能取消发起窗口任务、并发翻译被明确拒绝、翻译期间开始并取消真实截图、关闭任务所属窗口后其他窗口继续翻译，以及实际终止测试翻译子进程后的恢复。源码版完整流程约 9.2 秒，无页面异常，截图已目检。
- 最终 `release/1.3.0/win-unpacked/繁花有图.exe` 重跑同一完整翻译流程，通过（约 9.0 秒）；两段英译中约 924 ms、两段中译英约 803 ms，翻译未完成时开始并取消截图约 698 ms。连续取消、owner 关闭和实际子进程异常退出恢复均通过，无页面异常。
- 同一最终打包 EXE 顺序重跑 OCR 原图隔离回归，通过：两次 OCR 的实际输入字节及像素仍与原图一致；保存保留文字、水印和箭头，系统剪贴板图片与保存文件逐像素一致。
- 打包目录的 14 个模型文件再次独立校验 SHA-256，全通过；仅包含 Windows x64 ONNX 原生运行库，未混入 macOS／Linux／ARM64 文件。UTF-8 严格解码与 Git 空白检查通过。

最终架构使用 `utilityProcess` 隔离 ONNX 推理，取消通过结束该子进程完成。验证中发现的 Node 工作线程强制终止导致主程序退出问题已修复，并使用上述连续取消、窗口关闭和进程异常路径复验。

结果记录位于 `artifacts/translation-inference.json`、`artifacts/translation-regression-source.json`、`artifacts/translation-regression-packaged.json`、`artifacts/ocr-source-regression-packaged.json` 及对应界面截图。性能数据仅代表当前机器的小样本运行，未控制操作系统文件缓存，不作为其他电脑的速度或内存保证。

### 安装包与验证范围

安装包：`release/1.3.0/Fanhua-Screenshot-1.3.0-Setup.exe`，336,551,992 字节，内含 OCR 和中英翻译模型。

SHA-256：`8130b4ff18425525161c30a35c5cd7f0d777966b7fe29bffe8fb57f4861218d2`。

构建复用 `node_modules/electron/dist` 中已安装的 Electron 45.2.1，避免重复下载运行库。测试运行打包目录内的 EXE，未执行安装向导或修改开机启动。使用独立测试配置，未关闭用户旧版应用；本轮通过调用截图入口验证并发操作，没有发送实际系统级 Alt+A 按键。安装包尚未签名，真实多显示器与跨平台验证范围沿用下方历史记录。

### 翻译质量边界

这是轻量 OPUS-MT 专用模型，不保证任意文本准确。实测 `Open the image.` → `打开图像。`、`Please save the image.` → `请保存图像。`、`请打开图片。` → `Please open the picture.`；同时 `Close the window.` 被译为 `关上窗户`，缺少桌面上下文。`Hello, world!` 与 `Good morning.` 样例存在明显误译或增译，原始对照保存在 `artifacts/translation-quality-samples.json`。

保留官方简体中文目标标记：移除它虽然改善个别寒暄句，但损坏其他样例中的 PNG 和文字识别用语。没有针对测试句硬编码译文。界面保留原文并提示对照核对；功能回归和少量关键词检查不代表总体翻译准确率，重要内容应人工核对。

## 1.2.1：OCR 原图隔离修复

日期：2026-11-03。环境沿用下方 Windows 11 / Node.js 24.16.0 / Electron 45.2.1。

- `npm run build`：类型检查与 Vite 构建通过；`npm run dist`：Windows NSIS 安装包生成成功。
- 真实 Electron 源码构建与最终 `release/1.2.1/win-unpacked/繁花有图.exe` 分别通过独立 OCR 回归。测试使用隔离用户数据目录，没有关闭用户正在运行的旧版本。
- 原图为 1200 × 700，含 `SOURCE ONLY 2026`；通过界面增加文字批注、水印和箭头，然后调用真实 OCR。首次识别及修改批注后重新识别，两次主进程实际收到的 PNG 均与原图 data URL、解码像素完全一致；结果只含原文，未混入标注或水印。
- 修改批注不再出现“图片已修改”提示；识别区域仍定位于原图文字。
- 保存 PNG 保留编辑内容：文字、水印、箭头对应区域分别有 7780、6066、1471 个像素变化。实际系统剪贴板图片与保存 PNG 逐像素相同，无页面异常。
- 已查看源码版及打包版回归截图，OCR 段落栏可用；UTF-8 与 Git 空白检查通过。

独立脚本为本机忽略产物 `artifacts/validate-ocr-source.cjs`，结果为 `artifacts/ocr-source-regression-source.json`、`artifacts/ocr-source-regression-packaged.json` 及同名 PNG。本轮开始时工作区的既有测试文件已删除，保留该状态，未恢复或提交这些删除；本次没有重跑下方 1.2.0 的整套历史测试。

安装包：`release/1.2.1/Fanhua-Screenshot-1.2.1-Setup.exe`，157,161,534 字节。

SHA-256：`ae3eec908c695a39c1f5816650db1c4ff7c520132a470adea6b23a90a0b5900c`。

本次验证运行打包目录中的程序，未执行安装向导。翻译仅完成方案调查，未下载模型、接入推理或进行速度／内存基准测试。重新打开已保存的合成图片时，既有标注属于该文件的原始像素，不在本次隔离范围内。

## 1.2.0 历史验证

验证版本：1.2.0。日期：2026-11-03。环境：Windows 11（10.0.26200）、Node.js 24.16.0、Electron 45.2.1，主显示器 2560 × 1440，100% 缩放。

### 自动化结果

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 11 个文件，93 项通过 |
| 浏览器端到端 | 7 条流程分批通过，包含紧凑侧栏、段落联动与形状标注 |
| Electron 源码构建端到端 | 3 条完整流程通过 |
| `npm run dist` | Windows NSIS 安装包构建成功 |
| `npm run test:packaged` | 最终 1.2.0 打包 EXE，3 条原生流程全部通过 |
| UTF-8 与 Git 空白检查 | 通过 |

浏览器流程覆盖窗口命中与反向框选、文字再次选择修改、字号颜色、三种序号方式、独立序号头大小、字体下拉搜索、箭头绘制／端点／移动／删除、Ctrl 滚轮的鼠标锚点、马赛克删除后逐像素恢复、撤销重做、编辑模式切换、文字水印与撤销、图片水印存档跨刷新回读、PNG／JPEG／BMP 导出及文件签名、BMP 原始尺寸。浏览器模式明确提示文字识别需桌面版运行。

本轮新增确定性 OCR 测试图片与 12 段识别结果：每段包含多行文字，点击末段识别框会滚动右侧列表，重复点击同一段仍可重新定位；列表选择反向高亮图片区域，Ctrl 滚轮缩放后识别框保持原图位置。结果可修正、复制，关闭再打开保留结果；识别侧栏开启期间可继续编辑，图片变化后显示重新识别提示。窗口布局变化后选中段落仍保持可见。全过程没有 OCR Dialog，Canvas 原始像素和导出 PNG 字节不受识别框影响。

形状测试覆盖矩形、椭圆、Shift 正圆，实线／虚线／点线、8 px 粗细、自定义颜色、空心区域命中穿透、尺寸控制点、移动、删除、撤销和重做；绘制中按 Esc 取消手势后不产生新图层。复制与导出共用原图尺寸场景，PNG 字节一致。预览 Canvas 与独立导出 Canvas 可能因 GPU/CPU 栅格化路径出现不超过 2/255 的圆边抗锯齿通道差值，测试允许该边缘误差，不把它当成标注丢失。

原生流程覆盖无前台窗口启动、隐藏遮罩预热、再次打开 560 × 460 设置窗口、系统字体及刷新、识别真实测试窗口、单击截窗、真实截图尺寸和已知像素颜色、置顶及取消置顶、中文标注保存、关闭不保存、反向框选、编辑扩展小预览、Esc 取消、同一遮罩窗口连续复用和新的会话编号、旧会话完成／取消请求隔离、模拟无响应后的重建、收起后继续驻留。

第三条原生流程实际识别中英文图片并复制结果，验证翻译按钮禁用；另强制使用内置 Tesseract 引擎，确认打包后的 Worker 和模型路径可用。四种格式均通过界面导出到文件并核对文件签名；图片水印经原生选择、存档、回读和删除。单元测试另覆盖并发存档、覆盖更新、损坏文件保护、存档数量限制、透明 BMP 白底及行对齐、WebP 容器验证、OCR 任务互斥和临时文件清理。

原生 OCR 流程同时验证右侧段落栏、识别区域点击、开启侧栏后的最小窗口宽度、编辑与识别同时打开的布局，以及实际系统剪贴板图片、磁盘 PNG 与原图逐像素一致。Windows OCR 与 Tesseract 分别使用跨栏标题／左右两栏的 1400 × 650 实图验证，均返回按阅读顺序排列的 5 个段落和正确原图坐标。长图分块后的段落坐标也已验证。分段仍属于 OCR 结构和几何推断，不能保证所有复杂版式的语义段落划分完全准确。

额外本机探测：系统字体枚举得到 181 个字体族／本地化别名；系统 OCR 可用语言为中英文。1200 × 12000 原图超过 Windows OCR 单次尺寸上限，分块识别覆盖顶部、分块接缝与底部，接缝重复文字被去除。OCR 存在字符误识别可能，结果窗口保留直接修改能力，不以某张测试图的通过率承诺识别准确率。

### 界面尺寸检查

- 420 × 260 预览：常用工具、保存和水印弹窗操作可访问；浏览器中的紧凑 OCR 侧栏关闭／复制操作可达。关闭动画后验证布局并保存截图。
- 760 × 500 编辑：工具条和画布可用，较长的序号属性通过侧栏滚动访问；删除和图层选择均已验证。
- 桌面开启 OCR 后至少 720 × 500；编辑和 OCR 同时开启至少 1040 × 540，并限制在屏幕工作区内。关闭侧栏不会强行缩小用户窗口。
- 560 × 460 设置：常用设置和截图入口直接可见，快捷键帮助折叠显示。

### 本轮优化

- OCR 弹窗改为独立段落侧栏，图片上的淡遮罩和虚线框采用独立 DOM 显示层，不进入 Canvas、历史图层或导出。段落位置按原图像素保存，缩放及滚动同步。
- 增加方框与圆形空心标注、三种边框、八个控制点；取消手势统一处理 Esc、工具切换、撤销、失焦和指针捕获丢失。
- 修复当前 Electron 异步剪贴板接口兼容，等待图片／文字真正写入后反馈成功。打包目录改为按版本区分；原生测试使用独立用户数据目录。

以下既有能力继续回归：

- 截图改为按显示器预加载和复用遮罩，背景解码完成后显示，减淡选区外遮罩。快捷键截图不隐藏现有桌面窗口；按钮截图只隐藏来源窗口。
- 挂起或崩溃的遮罩从池中销毁，避免反复等待无响应页面；完成、取消、就绪通知均检查本次会话编号。
- 字体枚举合并 WPF、本地化别名、用户字体目录及 GDI，不截断列表。
- 增加箭头、序号头独立大小、鼠标锚点缩放及水印文档历史，导出前等待字体和水印图片加载。
- 补齐原生 OCR 和内置离线回退，WebP 按容器校验后保存，BMP 自行编码；保存后缀不匹配时明确提示。
- 保持紧凑图片工具窗，没有引入账户、项目管理或工作台导航。

### 安装包

`release/1.2.0/Fanhua-Screenshot-1.2.0-Setup.exe`，157,161,705 字节，包含中英文离线模型。

SHA-256：`dfecb18bbdbe794c2d5b98cffd461749561f85bd90ea17e14bbc6c33613f997f`。

### 验证边界

- 既有版本曾核实无前台窗口时成功注册 `Alt + A`。本轮测试与用户旧版并行运行，允许快捷键被旧实例占用并检查注册状态类型；未发送实际系统级按键，不把跨应用热键触发记为本轮已通过。
- 当前真实桌面测试为单显示器、100% 缩放；不同 DPI 和副屏负坐标有几何单测，尚未完成真实多显示器组合实测。
- 验证运行的是打包目录内的 EXE；没有在开发电脑上执行安装向导或修改开机启动设置。
- 安装包未配置代码签名。macOS 和 Linux 没有完成运行验证。
- Windows 存档原子覆盖测试需要正常用户临时目录；Codex 沙箱重定向的临时目录会拒绝 `rename` 覆盖，完整 93 项单测在沙箱外实际文件系统中通过。
- 原生文字识别和 Tesseract 均在当前 Windows 环境实测，其他电脑的系统字体与可用 OCR 语言取决于实际安装内容。翻译仅预留，不作为已实现功能。
