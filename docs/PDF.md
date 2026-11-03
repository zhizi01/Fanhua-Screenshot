# PDF 支持

1.6.0 在原有图片编辑器内增加 PDF 分页操作，不引入文档库或账户流程。

## 使用

托盘的“打开图片 / PDF”同时接受图片与 PDF；1.7.0 起，安装程序默认不添加右键菜单，可在设置中启用 PDF 的“使用繁花有图编辑”入口。程序已驻留时打开独立预览，不替换已有编辑窗口。

页栏支持上一页、下一页和跳转。每页独立保留标注、水印、历史和保存状态；关闭预览会丢弃未保存编辑。OCR、翻译、复制和 LocalSend 作用于当前页。翻页清空旧识别结果，识别面板开启时自动处理最新页面。

保存格式为 PNG/JPEG/WebP/BMP 时，仅保存当前页；选择 PDF 时可选当前页或全部页面。普通截图或图片也可以转为单页 PDF。PDF 保留输入页面的物理尺寸和显示朝向，普通图片以 96 DPI 换算尺寸。

输出 PDF 为逐页静态合成图片，包含标注、打码和水印；不保留原文件的可选文字、链接、交互表单或嵌入脚本。OCR/翻译是虚拟显示，仍不进入图片或 PDF。需要保留可搜索文字、编辑原 PDF 正文或填写表单的场景不属于当前实现范围。

## 本地实现

- PDF.js **6.5.438** 用于解析和渲染，按需加载；本地 worker、CMap、标准字体、解码 WASM 与许可证由 `scripts/prepare-pdf-assets.mjs` 从固定 npm 依赖复制。开发和构建入口自动执行，无运行时下载。实现依据：[PDF.js 示例](https://mozilla.github.io/pdf.js/examples/)及安装版本的类型定义和源代码。
- pdf-lib **1.17.1** 在主进程延迟加载，用来建立指定页面尺寸并嵌入合成 PNG，不导入原文件对象、隐藏文字或脚本。API 依据：[PDFDocument](https://pdf-lib.js.org/docs/api/classes/pdfdocument)、[PDFPage](https://pdf-lib.js.org/docs/api/classes/pdfpage)。
- 文件只从系统选择器或明确的本地编辑启动参数读取，PDF 操作不发起远程请求。渲染资源使用受约束的本地二进制工厂，兼容 Electron `file://` 与 ASAR；普通截图启动不加载 PDF 解析器。
- PDF.js 渲染器检查 Rotate、CropBox 和 UserUnit，默认 144 DPI；超限页面等比降低分辨率，预览缩放不影响导出尺寸。
- 图像分次渲染与添加，避免将全部页面的未压缩画布同时留在内存。保存开始后锁定编辑和翻页，合成时可以取消，最后写入阶段等待保存结束。
- 保存目标必须由原生对话框选择。服务校验任务归属、输入结构、PNG 解码与累积资源限制，同一目标不能由不同窗口同时写入。临时文件完成并同步后才原子替换目标；取消、失败与正常退出都会清理，未完成导出不先破坏目标原文件。

## 当前边界

| 项目 | 限制 |
| --- | --- |
| 输入 PDF | 最多 96 MB、200 页 |
| 加密文件 | 暂不支持需要密码的 PDF，显示解密后再打开的提示 |
| 页面栅格 | 默认 144 DPI，上限 1600 万像素、8192 像素单边 |
| PDF 输出 | 1～200 页，页面 PNG 原始与规范化总量分别不超过 128 MB |
| 输出物理尺寸 | 每边不超过 14400 PDF 点（200 英寸） |
| 色彩与特殊格式 | 使用 PDF.js 渲染和颜色转换；XFA 交互、脚本不启用 |
| 保存状态 | 仅标记实际成功导出的页；单页图片不会把其他页标为已保存 |

## 验证入口

```powershell
npm run test:pdf:service
npm run test:pdf:renderer
npm run build
npm run test:pdf
node scripts/verify-pdf-ui.cjs "release/1.8.0/win-unpacked/繁花有图.exe"
node scripts/verify-windows-integration.cjs "release/1.8.0/win-unpacked/繁花有图.exe"
node scripts/verify-pdf-assets.cjs
```

服务验证实际生成及重新读取 PDF，覆盖输入边界、隔离、取消、写入失败和旧文件保留。渲染验证使用真实 Electron，本地生成中文、标准字体、CMYK、旋转/裁剪、大页及损坏/加密样例，检查离线资源与取消。界面验证逐页编辑、OCR 最新页队列、两种导出范围、图片转 PDF，并重新打开导出文件比对像素。

`verify-pdf-assets.cjs` 默认使用当前版本的打包 EXE，逐项核对 ASAR 资源与源资源，再实际打开中文 PDF，验证从 ASAR 读取字体和 CMap；`--hash-only` 仅核对资源，不启动窗口。

这些测试产物位于忽略的 `artifacts/` 目录，不作为用户文档交付。实际执行结果见 [验证记录](VALIDATION.md)。
