# 药记 · Android 工程

这是一个独立安装、无需服务器的 Android 应用。前端文件在相邻的 `../web/`，构建时原样加入 APK 的 `assets/www/`。最低支持 Android 8.0（API 26），目标 Android 15（API 35），无原生 CPU 架构限制。

当前版本为 **1.6.0**（`versionCode = 7`），发布的 APK 沿用 `com.medtime.app` 包名与旧版签名，可覆盖安装并保留应用私有存储。“我的药品”卡片只提供设置频率、设置用量及改名；设置内可查看免责声明。支持首页闹钟开关、双列时间滚轮、当次用量、简短设置提示及赞助入口（收款方式暂未配置），以及 90 项药品/补充品、搜索、频率和次数统计。

## 构建

在 Windows PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\prepare-toolchain.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

首个脚本从 Microsoft 与 Google 官方站点下载已固定版本的便携 JDK 17、Android SDK Platform 35 和 Build Tools 35，验证 SHA-256 后解压。不会安装系统软件，不修改系统环境变量。工具、签名密钥及构建中间产物默认在此项目的 `work/android-build/`。第二个脚本无需网络，输出相邻的 `medtime-1.6.0.apk` 和 `.sha256` 校验文件。

脚本默认路径按交付目录结构解析。如将本文件夹移至其他位置，可以显式传入 `-WorkRoot`，以及构建所需的 `-ToolchainRoot`、`-WebRoot`、`-OutputApk`。

保留 `work/android-build/signing/` 中的私有签名文件，后续版本才能覆盖安装并保留应用数据。该文件不在交付源码中；在另一台电脑重新生成的密钥无法覆盖当前 APK。构建采用本地个人签名，不代表应用商店发布版本。为现有安装制作更新时还需提高 Manifest 的 `versionCode`。

## 本地数据与权限

- 应用不申请网络、位置、相机或广泛存储权限；所有界面资源包含在 APK 中。
- 使用 `https://appassets.androidplatform.net/assets/www/` 作为本地安全源，原生代码逐个从应用资源读取文件，拒绝外部资源与导航。
- 开启 DOM storage 保存前端数据；关闭系统自动备份。数据保存在本机此应用的私有存储中。卸载应用或清除应用数据会删除记录，应先导出备份。
- JSON 导入和导出使用 Android 系统文件选择器，仅读取用户选择的文件、写入用户选择的目标。
- 选择导出位置期间，待保存内容暂存在应用私有缓存中，以应对系统回收后台页面；保存完成或取消后会清理。导入选择期间若页面被系统重建，会提示重新选择备份文件。
- 接收系统栏、刘海与软键盘边距，支持 Android 返回按钮及 Android 13 之后的返回手势。

## 前端约定

返回键调用 `window.MedtimeNativeBack()`。函数返回 `true` 表示前端已关闭弹窗或切回首页，返回 `false` 或未定义则退出当前 Activity。

前端导出时可检测 `window.MedtimeAndroid`，然后调用：

```javascript
window.MedtimeAndroid.saveFile(jsonText, 'medtime-backup.json', 'application/json');
```

该调用打开系统“保存到”界面。完成后分发 `medtime-export-result` 自定义事件，`event.detail` 为 `{ ok: boolean, cancelled: boolean }`。原生层同时显示保存成功或失败提示。导入使用普通的 `<input type="file" accept=".json,application/json">`。原生层拦截外部导航与网络请求，不支持任意链接下载。

在 Android 包装内不要注册 Service Worker；本地资源已由 APK 提供。浏览器版本可以独立使用 Service Worker。

## 构建验证范围

构建脚本执行 Android 资源编译、Java 编译、DEX 转换、APK 对齐和签名，并验证 APK 签名、ZIP 对齐、资源路径规范以及每个内嵌网页文件与构建暂存文件的 SHA-256 一致性。签名使用 APK Signature Scheme v2/v3。未在实体 Android 设备或 Android 模拟器上运行，不把构建成功等同于真机测试。

工具依据：[AAPT2](https://developer.android.com/tools/aapt2)、[apksigner](https://developer.android.com/tools/apksigner)、[Microsoft OpenJDK](https://learn.microsoft.com/java/openjdk/download)。

## 1.3 原生闹钟

`AlarmScheduler` 通过 `AlarmManager.setAlarmClock` 注册三个独立时段的单次精确闹钟，接收后计算下一次日期。`AlarmPlan` 是不依赖 Android 的纯 Java 日历规则，处理每天、日历日间隔、每周、开始日期、已完成的明确时段记录以及已提醒去重。开启页面时恰好到期的旧闹钟保留短暂接收窗口，避免被刷新操作消除。

`AlarmReceiver` 验证当前待触发时间、最新安排和完成状态，拒绝过期/被修改的提醒；超过一小时的延迟广播不再响铃。响铃服务最多运行 60 秒，测试为 5 秒，播放系统闹钟铃声并振动。使用带时限的部分唤醒锁与前台媒体播放服务，通知包含停止与打开应用动作，不需要全屏闹钟或悬浮窗权限。停止提醒和测试操作均不写入服药记录。

`AlarmRestoreReceiver` 在设备启动解锁后、应用升级、时钟/时区变化和准时闹钟权限授予后重新排程。启动广播只安排闹钟，不启动媒体服务。系统强制停止后，需要用户重新打开应用。

权限用途：

| 权限 | 用途 |
| --- | --- |
| POST_NOTIFICATIONS | Android 13+ 请求显示闹钟通知和停止按钮 |
| SCHEDULE_EXACT_ALARM | Android 12+ 用户授权准时提醒 |
| RECEIVE_BOOT_COMPLETED | 重启解锁后恢复排程 |
| FOREGROUND_SERVICE / FOREGROUND_SERVICE_MEDIA_PLAYBACK | 仅在响铃期间维持音频服务 |
| WAKE_LOCK | 响铃与接收交接期间短暂保持 CPU 唤醒，有超时释放 |
| VIBRATE | 响铃时振动 |

新桥接方法为 `syncAlarms(json)`、`getAlarmStatus()`、`suspendAlarms()`、`requestAlarmAccess(kind)`、`testAlarm()`、`stopAlarm()`。状态返回支持情况、通知/精确闹钟授权、系统已排定的各时段下一次时间、响铃状态及错误。授权结果和页面恢复通过 `medtime-alarm-status` 更新前端。WebView 只加载应用内资源，桥接不对外部网页开放。

前端闹钟设置独立保存在 `medtime.alarms.v1`，药品/记录继续使用 `medtime.data.v1` 存储键，数据结构升级到 v3；v1/v2 在读取时迁移，保存时才写入新版结构。每次数据更新将频率和最近 48 小时/未来的明确时段完成记录镜像到应用私有 SharedPreferences；不复制备注。后台使用 UTC 时间和当前时区重新判断日期。备份 JSON 不含设备闹钟开关和系统权限，换机需重新开启。配置损坏时暂停系统闹钟，修复后再排程。

实现依据：[Android 精确闹钟与恢复](https://developer.android.com/develop/background-work/services/alarms)、[通知运行时授权](https://developer.android.com/develop/ui/compose/notifications/notification-permission)、[前台服务后台启动限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)、[媒体播放服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)。

## 1.3 验证

39 项 Node 测试覆盖药品库、补充品、记录、频率与设备闹钟设置。30 项纯 Java 断言覆盖排程、取消条件、已完成跳过、重复提醒防护、闰日、夏令时重叠/缺失时间和时区转换。可在本 android 目录使用 JDK 8+ 运行：

```powershell
javac -encoding UTF-8 -d ../work/alarm-plan-tests src/com/medtime/app/AlarmPlan.java ../tests/java/com/medtime/app/AlarmPlanTest.java
java -cp ../work/alarm-plan-tests com.medtime.app.AlarmPlanTest
```

浏览器验证覆盖 320/360/432px 和桌面，原有记录、搜索、备份与计数流程另做回归检查。安卓授权和响铃按钮的浏览器测试使用桥接替身，只证明参数传递及界面状态；不证明平台是否触发或实际出声。原生源文件通过资源/Java/DEX 编译及 APK 校验。当前没有实体安卓设备或模拟器，系统后台响铃、通知交互、声音/振动、重启恢复及厂商省电行为仍未实机验证。
## 1.4 时间滚轮与用量数据

`web/time-picker.js` 实现 24 小时和 60 分钟独立滚轮，以原生触摸滚动和 CSS scroll-snap 吸附；延迟吸附兼容缺少该 CSS 能力的 WebView。支持相邻数字点选、方向键、Home/End；关闭弹层清理监听和定时器。保存前读取当前居中值并结束滚动，时间仍使用 `HH:MM`。闹钟存储键和 native mirror 协议保持不变。

MedStore v3 在药品及每条记录上增加 `dose: null | {amount: string, unit: string}`。数量保存十进制文本并规范化多余零，允许最多 6 位整数及 6 位小数；必须大于 0。单位最多 12 字符，可自定义；`ml` 规范为 `mL`，不换算数量。原 v1/v2 历史记录迁移后为 `dose: null`，不根据当前药品推断历史用量。

新增 `setDose(data, medicationId, dose)`、`getDoseLabel(dose)` 和 `doseUnits`。快捷记录复制药品默认用量；编辑原记录且未显式传入 dose 时保留原快照。补记/编辑表单传入用户确认的当次用量。药品默认用量变更不追溯改动记录；统计仍按条数计。导入时保留本地已有默认用量与同 ID 记录，仅在本地默认用量未设置时恢复导入值。

验证：46 项 Node 数据测试、10 组新界面检查、10 组原闹钟桥接回归、12 组旧流程回归通过。实际浏览器触摸事件验证两列滑动、吸附与点选，并检查 320、360、432 像素手机视口及桌面。浏览器桥接测试使用显式替身，没有验证 Android 系统权限或实际后台响铃。原生日历代码未改变；新版 APK 仍执行编译、资源、ZIP 对齐和签名检查。

## 1.5 首页开关、提示及赞助入口

首页三个 `role="switch"` 按钮独立写入原 `medtime.alarms.v1` 设置并同步 native mirror；存储成功后才更新状态，失败保持原值。共用保存入口校验并发修改。时间表单只修改时间，闹钟关闭时滚轮也能使用；保存保留当前开关。授权未完成时维持明确提示；时间保存后会显示所需授权区域。原生排程与权限协议不变。

闹钟、频率、用量、药品添加/改名及备份导入不提供撤销，保存反馈约 1 秒。其他普通提示由 3.8 秒缩至 2.2 秒，记录撤销窗口由 6.5 秒缩至 4 秒。提示容器不拦截点击，只有记录撤销按钮可以接收点击；打开新弹层清除旧提示。失败使用明确错误反馈，不伪造成功。

赞助页为本地静态页面，当前明确显示暂未开放，没有支付账户、金额或外部跳转，不需要新增网络/支付权限。配置收款方式须在后续版本补充。导入预览同时检查默认用量变化，修复仅含用量设置的备份被误判为无需导入的问题。

本版 46 项 Node 数据测试和 32 组浏览器检查通过（10 组新增、10 组闹钟桥接回归、12 组既有数据流程回归）。覆盖 320/360/432 像素与桌面。Android 实际响铃/权限仍未在真机或模拟器上验证；浏览器 bridge 使用显式测试替身。

## 1.6 药品操作与免责声明

仅移除 `my-med-actions` 中重复的 `data-record` 按钮与其专用样式；首页时段记录、补记、编辑和计数逻辑保持原有行为。免责声明使用现有本地弹层，分为应用用途、药品信息与用药安排、记录准确性、提醒限制、数据保管五部分；可滚动查看，支持返回设置、关闭与返回键。没有强制勾选、外部导航、新权限或数据结构变更。

文案避免对全部责任作一概排除，并保留依法不能免除、限制的责任；参考 [《中华人民共和国民法典》第五百零六条（最高人民法院）](https://www.court.gov.cn/zixun/xiangqing/233181.html)。此实现不主张该说明具有特定法律效力。

6 组本次界面检查及 12 组既有流程回归通过，覆盖搜索后的药品卡片、库中新增、首页记录与补记、免责声明的完整内容/滚动/返回、旧记录和备份恢复。320×720、360×800、432×936、1280×900 无横向溢出，控制台及页面错误为空。原生返回仅通过前端回调验证，本版未在实体安卓设备或模拟器上运行。APK 通过资源/Java/DEX 编译、内嵌网页哈希、ZIP 对齐与签名校验。
