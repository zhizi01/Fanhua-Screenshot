# LocalSend 共享

预览工具栏的“共享”先展开菜单，选择“通过LocalSend共享”才会把当前编辑完成的图片导出为 PNG，打开本机 LocalSend 并预选该图片。仅展开菜单不会启动共享。用户随后在 LocalSend 中选择接收设备并发送。繁花有图不会自动选择设备，也不会将“已打开 LocalSend”当作“传输成功”。

## 官方桌面程序的调用方式

Windows 版 LocalSend 支持直接接收文件路径参数：

```text
"D:\AppFile\LocalSend\localsend_app.exe" "C:\图片目录\已编辑图片.png"
```

官方 v1.17.0 的 [`LoadSelectionFromArgsAction`](https://github.com/localsend/localsend/blob/v1.17.0/app/lib/provider/selection/selected_sending_files_provider.dart) 遍历启动参数，忽略选项参数，将存在的文件加入发送列表。官方 [`init.dart`](https://github.com/localsend/localsend/blob/v1.17.0/app/lib/config/init.dart) 处理首个实例和已有实例：启动参数加载成功后切换至发送页，第二个实例将参数交给已有实例后正常退出；[`tray_helper.dart`](https://github.com/localsend/localsend/blob/v1.17.0/app/lib/util/native/tray_helper.dart) 负责从托盘显示并聚焦窗口。

因此本项目使用桌面主程序的文件参数入口，不依赖假定的 URI 协议，也不直接调用 LocalSend 内部的本机 HTTP 接口。新版本是否继续兼容这一参数行为需要随 LocalSend 升级复核。

## 本项目实现

- `electron/localsend.cjs` 提供 `createLocalSendService({ app, dialog, nativeImage })`，主进程在 Electron 就绪后调用 `initialize()`，预览窗口共享时调用 `share(window, composedPngDataUrl)`。
- 共享输入仅接受编辑器合成后的 PNG Data URL，校验格式、尺寸及解码结果。不会接收渲染进程传入的任意本地文件路径。
- 优先复用用户手动指定并仍有效的程序路径，再查询正在运行的 LocalSend 进程、注册表 App Paths、卸载登记、右键菜单登记及常见安装目录。路径识别失败时，提示选择 `localsend_app.exe`；便携版可以手动选择，取消即返回，不创建共享图片。
- 手动选中的路径保存在 Electron 用户数据目录的 `localsend.json`。验证绝对路径、预期文件名、普通文件及可执行文件头；这不等同于数字签名验证，用户应选择自己安装的 LocalSend 主程序。
- 使用 `spawn(absoluteExecutable, [absolutePngPath])`，关闭 shell，不拼接命令字符串。含空格、中文或 `&` 的文件路径按单个参数传递。已有实例交接后子进程正常退出视为成功；启动失败则显示错误。
- 共享接口返回 `{ canceled: false, fileName }` 或 `{ canceled: true }`。成功只表示程序已启动或完成实例交接，无法从这个公开入口获得用户是否最终发送、接收方是否确认等结果。
- 当前集成针对 Windows 桌面版，不会自动安装 LocalSend。

## 临时图片生命周期

图片写入系统临时目录下的 `fanhua-localsend`，名称包含“繁花有图”、时间及随机标识。分享后不立即删除，关闭繁花有图时也不删除，避免 LocalSend 尚未读取图片。

应用启动及下一次共享会清理该目录内超过 **7 天**的本应用命名 PNG。清理只处理目录内符合命名规则的普通文件，跳过链接、子目录及其他文件，不递归清理用户文件。新一次启动发生错误时，仅删除本次新建的 PNG。已交给 LocalSend、但长期未发送的图片可能在过期清理后失效，届时重新共享即可。

## 验证

执行：

```powershell
npm run test:localsend
```

`scripts/verify-localsend.cjs` 使用隔离夹具验证完整 PNG 字节保留、中文/空格/特殊字符路径参数、已有实例退出码、便携路径记忆、取消不导出、启动失败删除新文件、并发防重入，以及只清理过期的本应用文件。报告写入 `artifacts/localsend-verification.json`。这个自动检查模拟了子进程，不能替代 LocalSend GUI 验证。

2026-11-03 在本机实际验证了 `D:\AppFile\LocalSend\localsend_app.exe`，产品版本 **1.17.0+58**。使用不含用户截图的 800×400 合成测试 PNG：

1. 自动检测到现有安装，启动新实例后进入发送页。
2. GUI 显示已选择 1 张图片、16.6 KB；进入选择编辑页确认文件名与缩略图对应测试图片。
3. 再次通过文件参数启动时，已有实例正常接收，未多开常驻实例。
4. 未选择接收设备、未执行图片传输。测试完成后将窗口最小化，保留测试图片供 LocalSend 读取。

实机记录在 `artifacts/localsend-real-check/launch.json`。已验证的范围是启动及文件预选；网络发现、跨设备传输与接收端行为由 LocalSend 处理，未在本次测试中执行。
