# 图片剪贴板与 DeskFlow 模式

调查和实测日期：2026-11-03。当前实现针对 Windows / Electron 45.2.1。

## 两种复制

- 普通“复制到剪贴板”使用合成后的 PNG，包含编辑标注和水印，保持图像尺寸与无损像素。
- “复制到 DeskFlow 剪贴板”先把同一合成场景按 JPEG 质量 60 编码；透明部分按现有 JPEG 导出规则填白。主进程校验 JPEG 文件头、尺寸和解码结果，保留该次编码的原始字节，不再次进行有损编码，也不缩放图片。
- DeskFlow 使用系统剪贴板，没有本应用可单独写入的专属剪贴板。此入口提供适用于该用途的图像表示，实际跨设备同步由用户已运行的 DeskFlow 完成。

鼠标提示按产品要求显示：**由于DeskFlow传输有限制，会造成质量压缩。**

## 为什么同时提供 JPEG 与位图表示

Electron 45 的 `ClipboardItem` 接受 `image/jpeg`，但实现会先解码图像，再交给系统作为通用图片；仅使用此 MIME 并不能保留 60% JPEG 文件字节。读取 `image/jpeg` 的内部路径还可能重新编码到质量 100，因此不能用它来证明原始编码已保留。[Electron ClipboardItem 实现](https://github.com/electron/electron/blob/v45.2.1/shell/browser/api/electron_api_clipboard_item.cc)

本实现一次原子写入三个表示：`image/jpeg` 提供系统图片兼容性，`electron application/osclipboard;format="JFIF"` 与 `electron application/osclipboard;format="image/jpeg"` 保存原始 JPEG 字节。原生 JPEG 格式读回与输入逐字节相同；通用图片像素与该 JPEG 解码结果一致。平台或接收应用仍可选择位图／PNG 表示，这并不等于使用原图无损像素替代压缩图。[Electron 剪贴板格式说明](https://www.electronjs.org/docs/latest/api/clipboard)、[ClipboardItem 原始平台格式](https://www.electronjs.org/docs/latest/api/clipboard-item)

## DeskFlow 传输限制

调查时的 DeskFlow Windows 官方源码从 `CF_DIB` 读取图片，并转换或保留 24/32 位未压缩位图。它没有从 JPEG 注册格式直接传送压缩文件的路径，因此 **JPEG 质量 60 不保证 DeskFlow 的网络数据量等于 JPEG 文件大小，也不保证绕过其剪贴板大小限制**。[Windows 剪贴板转换器](https://github.com/deskflow/deskflow/blob/master/src/lib/platform/MSWindowsClipboardBitmapConverter.cpp)、[通用剪贴板格式](https://github.com/deskflow/deskflow/blob/master/src/lib/deskflow/IClipboard.h)

本次没有更改 DeskFlow 的配置或协议，没有自动降低图片分辨率，也没有对另一台设备进行实际传输。图像质量压缩、原始 JPEG 字节保留和本机图片粘贴表示已经验证；跨设备同步的大小限制和格式选择仍取决于 DeskFlow 版本及接收端应用。

## 验证

运行 `node scripts/verify-image-clipboard.cjs`，会启动独立 Electron 进程，将生成的测试图写入真实系统剪贴板。验证 PNG 像素一致、JPEG 字节与质量 60 编码完全一致、兼容位图来自压缩后的 JPEG、错误输入不会覆盖剪贴板，以及再次普通复制清除旧 JPEG 表示。结果输出到 `artifacts/image-clipboard-regression.json`。
