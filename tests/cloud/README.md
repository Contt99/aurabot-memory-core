# 真实宿主的隔离回归

在安装了 Aurabot 和 DSH 的机器上，指定 **Aurabot 的 `src` 目录**和**含 `@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-tools` 的 `node_modules` 目录**，从仓库根目录运行：

```sh
AURABOT_HOST_SRC=/path/to/aurabot/src \
DSH_MODULE_ROOT=/path/to/dsh/node_modules \
node --test tests/cloud/host-memory.test.mjs
```

如果 Windows 桌面版把 SDK 打包在 `app.asar` 中，使用本机 Node.js 与 Python 3：

```powershell
python -B tests/cloud/run-desktop.py 'D:/path/to/aurabot/src' 'D:/path/to/DeepSeek Harness/resources/app.asar'
```

桌面入口只将已安装的 Session、Tools SDK 及依赖复制到临时目录，测试退出后清理。测试使用真实的 Aurabot Hub、提示词捕获、Session、Tools 回执边界和 life-core 数据库；DSH 模型边界、OneBot 网关及授权原文提供方由合成夹具代替。宿主数据、DSH 主目录和工作区均指向临时目录，不连接在线服务。

| 用例 | 通过条件 |
| --- | --- |
| 正式 Session 表面替换 | 旧事件保留；替换事件指向原序号；冻结请求中的原文只出现一次，流观察后请求不变。 |
| 拆条后显式忘记 | 已观察的请求含原文；真实 `turn/end` 触发投递后，发送钩子拦住回复，网关零次；独立手工确认仍可发送。 |
| 拆条后原文不再可读 | 原文提供方不再验证该条来源，无需忘记通知；同样拦住当轮回复，独立发送不继承其限制。 |
| 主动联系后重启 | 第一个 Node 进程经 purpose 投递适配器、真实 Hub 和模拟 ACK 发出一句话；第二个进程重新打开同一数据库。两天后的目标聊天请求中该句只出现一次，带原始北京时间，未再次投递。 |
| 私人日记群授权变化 | 撤去来源群授权后，下一次独立的日记模型请求不再携带上轮提示或上轮生成的正文。 |
| 桌宠显示回执 | 使用现有桌宠路由；公告不含正文；领取和确认分开，只有对应确认产生显示回执。 |
| DSH 工具最终回执 | 正式 Tools SDK 发出冻结结果，产物证据只能被发起调用的聊天检索，不进入日记。 |

不传 `AURABOT_HOST_SRC` 会显示跳过，不能作为宿主验收通过的证据。

2026-11-21：最终候选在云端 Node.js 24 上的 229 项测试全部通过，无跳过，其中包括上述 5 项宿主隔离测试。
