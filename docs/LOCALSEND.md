# LocalSend 共享

预览工具栏的“共享”先展开菜单，选择“通过LocalSend共享”才会把当前编辑完成的图片导出为 PNG，打开本机 LocalSend 并预选该图片。仅展开菜单不会启动共享。用户随后在 LocalSend 中选择接收设备并发送。繁花有图不会自动选择设备，也不会将“已打开 LocalSend”当作“传输成功”。

## 官方桌面程序的调用方式

Windows 版 LocalSend 支持直接接收文件路径参数：

```text
"C:\LocalSend\localsend_app.exe" "C:\图片目录\已编辑图片.png"
```

官方 v1.17.0 的 [`LoadSelectionFromArgsAction`](https://github.com/localsend/localsend/blob/v1.17.0/app/lib/provider/selection/selected_sending_files_provider.dart) 遍历启动参数，忽略选项参数，将存在的文件加入发送列表。官方 [`init.dart`](https://github.com/localsend/localsend/blob/v1.17.0/app/lib/config/init.dart) 处理首个实例和已有实例：启动参数加载成功后切换至发送页，第二个实例将参数交给已有实例后正常退出；[`tray_helper.dart`](https://github.com/localsend/localsend/blob/v1.17.0/app/lib/util/native/tray_helper.dart) 负责从托盘显示并聚焦窗口。

因此本项目使用桌面主程序的文件参数入口，不依赖假定的 URI 协议，也不直接调用 LocalSend 内部的本机 HTTP 接口。新版本是否继续兼容这一参数行为需要随 LocalSend 升级复核。

## 本项目实现

- `electron/localsend.cjs` 提供 `createLocalSendService({ app, dialog, nativeImage })`，主进程在 Electron 就绪后调用 `initialize()`，预览窗口共享时调用 `share(window, composedPngDataUrl)`。
- 共享输入仅接受编辑器合成后的 PNG Data URL，校验格式、尺寸及解码结果。不会接收渲染进程传入的任意本地文件路径。
- 默认查询正在运行的 LocalSend 进程、注册表 App Paths、卸载登记、右键菜单登记及常见安装目录。在“设置 → 共享”可以指定 `localsend_app.exe` 或恢复自动查找；设置时选择取消不产生共享图片。手动路径优先，失效时保留并明确提示修正；共享期间不弹出配置文件选择器，未发现程序时指向设置。
- 手动选中的路径保存在 Electron 用户数据目录的 `localsend.json`。设置专用 IPC 与预览共享 IPC 分离；手动路径变更串行执行，原子保存并报告写入失败。验证绝对路径、预期文件名、普通文件及可执行文件头；这不等同于数字签名验证，用户应选择自己安装的 LocalSend 主程序。
- 使用 `spawn(absoluteExecutable, [absolutePngPath])`，关闭 shell，不拼接命令字符串。含空格、中文或 `&` 的文件路径按单个参数传递。已有实例交接后子进程正常退出视为成功；启动失败则显示错误。
- 共享接口返回 `{ canceled: false, fileName }` 或 `{ canceled: true }`。成功只表示程序已启动或完成实例交接，无法从这个公开入口获得用户是否最终发送、接收方是否确认等结果。
- 当前集成针对 Windows 桌面版，不会自动安装 LocalSend。

## 临时图片生命周期

图片写入系统临时目录下的 `fanhua-localsend`，名称包含“繁花有图”、时间及随机标识。分享后不立即删除，关闭繁花有图时也不删除，避免 LocalSend 尚未读取图片。

应用启动及下一次共享会清理该目录内超过 **7 天**的本应用命名 PNG。清理只处理目录内符合命名规则的普通文件，跳过链接、子目录及其他文件，不递归清理用户文件。新一次启动发生错误时，仅删除本次新建的 PNG。已交给 LocalSend、但长期未发送的图片可能在过期清理后失效，届时重新共享即可。
