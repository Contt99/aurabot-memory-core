# 记忆：统一经历忘记联动

这是正式的同 ID `memory` 替换模块。基于本次 baseline 的最新隐私/提炼修复本体，按宿主 `core/modules.fork` 的 `rewriteImports` 规则复制 `index`、`memory`、`memory-store`、`memory-vector`，内部四文件互相引用本地版本，宿主核心工具通过公开 `globalThis.aurabot.lib` 依赖接口读取。没有运行时猴补丁。

## 使用与数据

把本目录作为数据目录的 `modules/memory` 安装。模块 ID、所有原导出、工具/面板路由和 `core/store.dataDir` 路径保持原合同；继续读写原 `memory.sqlite`、向量/旧 JSON 迁移数据，而不是创建 `modules-data/memory` 下的新库。`files` 定义保留原内置声明以便追溯复制来源。

- 自然语言忘记：原 `handleCommand` 完成主记忆持久化与聊天流水处理后，同步调用当前启用的 `life-core.forgetPerson(qq, query, {commandChatId,commandMessageId})`。原 host 的 history-vault 联动仍照常运行。
- 管理删除单条记忆：只传播 `sourceIds:['memory:<id>'], exactSources:true`，不把正文关键词扩成全人物删除。没有这条记忆时不传播。
- 记住命令、群聊中的未接受命令和关闭的即时命令不会触发联动。
- life-core 缺失、抛错、返回失败或异步结果时，保留已接受的本地处理结果，同时附 `lifeCoreForgetErrors` 并记录 error。面板删除返回 message 可见。不会伪称派生日记已全部清除。

`createMemoryStore` 新增可选同步 `onForget` 参数；直接使用该工厂的既有调用方不要求配置新参数。

## 验证

从工作区运行：

```powershell
node --test tests/history/memory.test.mjs tests/history/vault.test.mjs tests/history/managed-vector.test.mjs
```

测试使用隔离合成 SQLite 数据和模型桩，不连接生产、不发送真实 QQ/Qzone、不产生模型费用。

## 边界

管理删除传播的精确关联只有 `memory:<id>`；历史记忆没有来源 ID 时不猜测对应群原文。自然语言忘记仍按本人真实 QQ 和原词匹配。独立备份、既有 DSH 会话、其他人的数据不扩大到本次删除范围。全局经历消费方需要实现同步 `forgetPerson` 及 `exactSources` 合同；自然语言忘记错误可从返回字段和日志检查，旧 host 的原历史库通知不会代表 life-core 消费者成功。


## 1.0.3-local.life：同步精选记忆出口

`contextForCore({chat,sessionId,query,prevText,speakers,maxChars=900})` 返回 `{text,sourceIds}`，只做本地同步读取，不调用向量或聊天模型、不计作已经想起。`contextCurrent(ids,{chatId})` 按当前来源权限及内容版本复核。`list()` 新增只读 `contextSourceId`，供印象生成固定输入版本。

来源ID为 `memory:<原id>@<20位内容版本>`；版本覆盖正文、归属、来源、原时间及有效期，不受召回计数影响。已知原日期与记录日期分别显示；手工资料和压缩印象原事时间不明时明确留空。

新核心管理聊天时，旧prompt回忆及常驻事实/档案不再重复注入；人物关系、相处经验与说话方式保留。原工具、手工记事/删除、存储路径不要求新核心能力。

就地更正/删除会按原ID通知核心。`abstractOf`原文撤回会联动撤回既存改写摘要；原文更正/删除会撤回同源聊天的旧无血缘摘要；显式忘记时，无逐行血缘的本人摘要和有真实本人匹配原文的聊天摘要整段失效，避免换一种说法绕过忘记；不删无关聊天原文。自然语言忘记仍只做一次同步传播，返回原有联动错误字段。

旧无血缘摘要与旧综合卡在更正、忘记或来源撤权时必须撤回或刷新；这是隔离所需的派生视图失效，不改变原文保留合同。

## 1.0.3-local.life.1：普通 QQ 聊天语义回忆

在 life-core 接管的普通 QQ 对话里，已启用向量检索且有获准的已索引事实时，`contextForCoreRecall` 用本轮原始消息（至多最后 600 字符）查一次现有 embedding 服务；命中后与关键词结果一起排序。上一句只在本地参加关键词匹配。既有触发词、查询缓存和 2 秒超时仍有效；忘记命令不做语义查询。

语义回忆仍用同一批精选事实、来源权限和内容版本，查询结束后重新核对。同步 `contextForCore`、后台调用、手工 `recall_memory` 和未接管聊天的旧入口保持原合同。
