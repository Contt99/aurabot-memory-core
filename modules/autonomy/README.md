# 自主生活 · 真实探索与本地私人日记

版本 `0.7.0-life.2`，同 ID `autonomy` 的自包含本地分叉；基于 `0.6.1-local.4`，保留 MIT 许可。仅模块替换，无需改宿主源码。

## 在面板查看私人日记

打开「自主生活」，在顶部 **私人日记 · 本地保存** 选择日期。正文、未完成问题、笔记和来源 ID 分开显示。**预览私人日记（不保存）** 只做写作与核验，不保存日记、不发布空间、不增加醒来次数。预览会调用当前默认模型。

「私人日记群来源」每行一个群号，点击 **保存群来源** 应用。配置为 `ext.autonomy.diarySourceGroups: []`，初始留空；它与公开日记的 `diary.sourceGroups` 互相独立，也不会继承聊天群允许列表。实际可用群必须同时在全局群授权内。撤销来源会阻止在途模型结果写入。

私人日记只写模块数据目录 `private-journal.json`。每篇包含 `id/at/date/text/sourceIds/sourceScopes/sources/unresolvedQuestions/notes`；`sources` 仅保留来源类型、状态和范围，不另存完整原始群消息。日期按服务器本地时区划分。正文是反思，不作为通用事实记忆回灌。既有 QQ 空间内容与空间历史不作删除或迁移。

## 自主探索只使用真正可执行的工具

决策提示实时列出 `life-core.capabilities()` 中 `available:true` 的工具。模型只返回动作 ID 和 JSON 参数；工具结果必须来自 `life-core.execute()`，下一次选择使用其 `value`、状态和经历 ID，而不把模型声称的「搜到了」当结果。

每轮最多执行 **5 次真实工具**，探索与相关决策总预算 **120 秒**，超时中止 AbortSignal。不执行模型生成的 shell；不再向模型宣称手机、桌面、系统应用等未接通的能力。可用搜索、页面抓取、B站、贴吧或保存笔记由 life-core 的实际连接决定。

失败、推迟、模拟和未确认结果不会成为完成记录或推进项目。同一轮相同工具与参数已经失败时，不再原样重试。旧状态中没有可核实标记的“项目”不再提示模型继续推进。成功记录保留 `ok/status`；活动流水中明确区分完成、休息和未完成。

## 原有使用方式

- 保留 `wake/state/activity` 导出、`/state`、`/activity`、`/wake`、`/clear-log`、`/grounding`、`/diary/preview`、`/自主` 主人命令和 `my_schedule` 工具。
- 自主日记 `diary` 动作改为本地私人日记；`/diary/preview` 也改为本地预览。它们不再发布私密空间，也不回退到旧发布器。
- 正常 `speak` 与 `bili` 仍调用原正式模块执行器，门禁和结果记录由对应适配器负责，不再套第二层 QQ 调度。返回值没有实际成功确认时不记为完成。
- `wake` 通过 `life-core.propose(kind:'background')` 检查全局开关和睡眠，不占用 QQ 主动消息额度；自身次数、时段、忙锁仍由自主生活管理。手动预览不经过睡眠门禁。
- 生图保留本地保存及真实结果入账；原默认关闭的 `allowNewMod` 功能与安全扫描保留。手机动作已从调度能力和权限界面移除。
- 新安装默认最多 **8 次/天**；已保存的时段、间隔和额度仍优先。部署不更改现有 18–23 / 30–90 分钟 / 每天 8 次的有效配置。0 次上限也会被正确遵守。
- 默认模型每次调用重新选择，日记沿用宿主能力感知的推理设置；人格与心情动态读取。
- life-core 不可用时，私人日记和探索明确不可用，不回空间；原有执行器保留并写覆盖缺口警告。

## 来源失效与忘记

日记只从 `life-core.diarySources('private')` 取材，写作请求前、核验前及原子保存前检查 `assertSourcesCurrent('private', sources)`。独立核验拒绝虚构行为、失败冒充成功和人物归属错误；不接受不存在的来源 ID。

同步 `onForget` 回调按精确来源 ID 删除派生日记（包括该篇笔记与问题），不因同一群范围而删除无关人的日记。写盘异常上抛给忘记流程；不改独立备份。监听宿主 `module/start` 事件；life-core 首次加载或热重载时立即同步重绑忘记消费者。

## 新增只读接口

相对于 `/aurabot/api/ext/autonomy`（同名替换也支持 `/aurabot/api/autonomy`）：

- `GET /journal/dates` → `{ok,dates:["YYYY-MM-DD"]}`
- `GET /journal/day?date=YYYY-MM-DD` → `{ok,date,items:[...]}`
- `GET /state` 附带当前 `capabilities`，面板只显示可用工具。

这些接口沿用宿主面板认证，读取不触发模型、不对外发布。

## 本地验证

在工作区根目录运行：

```powershell
node --test output/aurabot-life-core-20261115/tests/autonomy.test.mjs output/aurabot-life-core-20261115/tests/autonomy-panel.test.mjs
node --check output/aurabot-life-core-20261115/candidate/autonomy/index.mjs
node --check output/aurabot-life-core-20261115/candidate/autonomy/lib/private-journal.mjs
node --check output/aurabot-life-core-20261115/candidate/autonomy/lib/tool-loop.mjs
```

测试使用候选模块、隔离文件和替代模型/工具，不发真实 QQ、不发空间、不调用付费模型。新接口和工具测试替代旧自主空间发布断言；旧空间发布器未改动。面板测试覆盖日期浏览、正文/笔记/问题、可用工具过滤、白名单保存数组、预览 POST；真实 WebUI 外观由整体部署验收检查。


## 2026-11-15 本地增量
主人social私聊新增受限 start_autonomy，可由模型自行决定现在探索、稍后保存待办或休息，无二次确认。受理不等于完成；与定时轮次共锁、共每日8轮上限及5工具/120秒预算，先落盘再执行，重启中断不重放。原 my_schedule 完整权限合同保留。
