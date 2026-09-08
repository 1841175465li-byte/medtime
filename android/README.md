# 药记 · Android 工程

当前版本 **1.7.1**（versionCode 9），包名 com.medtime.app。最低 Android 8.0（API 26），目标 Android 15（API 35），无原生 CPU 架构限制。前端来自相邻 web 目录，构建时加入 APK 的 assets/www。

本版将独立时间改为点击打开的小时／分钟双列滑动弹窗，保留整份安排草稿；移除稍后提醒，通知仅保留停止和打开应用。继续支持空列表引导、药品信息、独立时间、睡前、疗程、暂停／归档和锁屏试响。发布包沿用原签名，可覆盖此前版本并保留私有存储。

## 构建

在本目录使用 Windows PowerShell：

    powershell -NoProfile -ExecutionPolicy Bypass -File .\prepare-toolchain.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1

准备脚本从 Microsoft 和 Google 官方站点下载固定版本的便携 JDK 17、Android Platform 35、Build Tools 35，校验 SHA-256，不改变系统环境变量。默认工具链、中间产物和私有签名位于项目的 work/android-build。构建脚本无需网络，输出 ../medtime-1.7.1.apk 和校验文件。

目录可通过 -WorkRoot、-ToolchainRoot、-WebRoot、-OutputApk 显式指定。保留 signing 目录内的原密钥及密码文件，它们不包含在公开源码中。另一台电脑新生成的密钥无法覆盖已发布 APK；制作更新还需递增 versionCode。

构建执行资源／Java 编译、DEX 转换、ZIP 对齐、v2/v3 签名验证，以及每个内嵌网页资源的 SHA-256 核对。构建成功不代表已完成真机测试。

## 离线资源、数据与权限

- 无网络、位置、相机或广泛存储权限。WebView 只接受应用资源，拒绝外部资源和导航。
- 本地安全源为 https://appassets.androidplatform.net/assets/www/，使用 DOM storage，关闭系统自动备份。卸载或清除数据会删除本地记录。
- 导入／导出使用 Android 系统文件选择器。选择导出位置期间，内容暂存于应用私有缓存，保存完成或取消后清理。
- 保留系统栏、刘海、软键盘边距，以及 Android 返回按钮和返回手势处理。

| 权限 | 用途 |
| --- | --- |
| POST_NOTIFICATIONS | Android 13+ 提醒通知与操作按钮 |
| SCHEDULE_EXACT_ALARM | Android 12+ 用户授权精确提醒 |
| RECEIVE_BOOT_COMPLETED | 重启解锁后恢复排程 |
| FOREGROUND_SERVICE / FOREGROUND_SERVICE_MEDIA_PLAYBACK | 响铃期间维持音频服务 |
| WAKE_LOCK | 接收交接和响铃期间有超时限制的唤醒锁 |
| VIBRATE | 响铃时振动 |

## 数据兼容

medtime.data.v1 存储键不变，内容结构升级到 v4。v1／v2／v3 在读取时迁移，保存时才写入新版。新安装不预置药品或记录，已有数据不删减，也不猜测历史规格和剂量。

药品新增 strength、form、status（active／paused／archived）；安排新增 times（所选时段到 HH:MM 的映射）、endDate（含结束当天）。记录新增 medicationStrength、medicationForm 快照。修改默认信息不回写旧记录。

medtime.alarms.v1 键保持不变，其设置结构升级到 v2。旧三个时段的时间与开关保留，睡前默认 22:00 且关闭。时段总开关同时控制该时段内使用独立时间的药品。

导入按稳定 ID 合并，不覆盖本地已设置的信息、状态和已有记录。药品备份不含设备闹钟开关、系统授权或试响结果。

## 原生排程

AlarmPlan 是纯 Java 日历规则，计算每天、日历日间隔、每周日期、起止日期、四个时段及每药独立时间。暂停或归档药品不参与排程；按药品、当地日期和明确时段的记录判断完成状态。

AlarmScheduler 使用 AlarmManager.setAlarmClock，每个时段维护一个最近的待触发时间。接收后继续安排该时段中其他药品的后续时间；同一时刻的药品合并提醒。去重使用实际本地日期时间，时区与夏令时由 java.time 处理。

AlarmReceiver 校验待触发时间、最新安排与已完成状态。正常广播允许一小时内的迟到窗口，其间同一时段的后续独立时间继续排程。过期、完成或修改失效的提醒被跳过。

移除延后提醒的创建、消费、桥接和界面入口。clearLegacySnoozes 在重新排程／升级时取消 1.7.0 已存在的 PendingIntent 并清理队列；Receiver 忽略遗留延后动作。该清理不改变正常用药安排。正式提醒仍优先于试响。

AlarmSoundService 是有通知的前台音频服务，正常最多响铃 60 秒、试响 5 秒，播放系统闹钟铃声并振动。通知仅提供“停止响铃”和“打开药记”两个操作，停止不写用药记录。权限就绪或播放器启动不等于实际听到，需用户确认。

AlarmRestoreReceiver 在重启解锁、升级、时钟／时区变化及精确闹钟授权后恢复排程，启动广播不直接启动音频服务。用户强行停止应用后需重新打开。

## 前端桥接

桥接只对应用内网页开放。

| 方法 | 用途 |
| --- | --- |
| syncAlarms(json) | 保存最小原生镜像并重排，返回状态 |
| getAlarmStatus() | 权限、音量、后台限制、排程、响铃与试响状态 |
| suspendAlarms() | 数据异常时停止原生提醒 |
| requestAlarmAccess(kind) | notifications／exact／sound／app 系统设置 |
| testAlarm()／stopAlarm() | 立即试听／停止，不写记录 |
| scheduleAlarmTest()／cancelAlarmTest() | 1 分钟后独立锁屏测试／取消待触发测试 |
| confirmAlarmTest(heard) | 用户确认已触发测试的实际听到结果 |
| saveFile(text, name, mime) | 打开系统保存界面 |

镜像 v2 包含时段设置、药品状态和扩展安排、最近 48 小时与未来的明确时段记录。兼容 v1 镜像，不复制备注、规格／剂型或完整备份。数据损坏时暂停提醒。

testScheduled 表示排队，testTriggered 表示系统实际触发时间，testAudioStarted 表示播放程序已启动。只有用户确认才保存 heard／unheard；不把调用成功当作实机测试通过。

medtime-alarm-status 通知前端刷新，无变化时保留按钮焦点。window.MedtimeNativeBack() 处理返回。导出完成事件 medtime-export-result 包含 ok／cancelled。

## 测试

仓库根目录：

    node --test tests/store.test.cjs tests/catalog-stats.test.cjs tests/reminders.test.cjs tests/dose.test.cjs tests/management.test.cjs

本 android 目录：

    javac -encoding UTF-8 -d ../work/alarm-plan-tests src/com/medtime/app/AlarmPlan.java ../tests/java/com/medtime/app/AlarmPlanTest.java ../tests/java/com/medtime/app/AlarmManagementTest.java
    java -cp ../work/alarm-plan-tests com.medtime.app.AlarmPlanTest
    java -cp ../work/alarm-plan-tests com.medtime.app.AlarmManagementTest

本版 57 项 Node 测试、53 项纯 Java 断言、13 组针对性浏览器检查通过。数据和日历测试覆盖迁移、独立时间、疗程、暂停归档、快照、备份、去重、闰日、夏令时和时区。浏览器在 320／360／432／1280 像素宽度检查弹窗、真实触摸上下滑动、分列独立变化、吸附、焦点、确认／取消／返回、整份安排草稿保留、四时段边界值保存、默认时间回归及移除延后入口。

浏览器 Android 桥接使用显式模拟，只验证参数和界面状态，不证明真实设备触发、声音、振动或后台兼容性。真机步骤见 [使用说明](../使用说明.md)。

实现依据：[Android 精确闹钟](https://developer.android.com/develop/background-work/services/alarms)、[通知权限](https://developer.android.com/develop/ui/compose/notifications/notification-permission)、[前台服务限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)、[媒体播放服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)、[AAPT2](https://developer.android.com/tools/aapt2)、[apksigner](https://developer.android.com/tools/apksigner)。
