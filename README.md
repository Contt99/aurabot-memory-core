# Aurabot Memory Core

Aurabot 用户模块的统一记忆与对话连续性项目。把实际收到、实际说过和实际做过的事情连到可追溯的来源，再按聊天对象与用途提供有界上下文。

## 从这里开始

- **查看一条消息去了哪里**：[`history-vault`](modules/history-vault/) 保存授权聊天的原文，[`life-core`](modules/life-core/) 按聊天和用途编排记忆；[`memory`](modules/memory/) 提供精选事实，[`impression-card`](modules/impression-card/) 提供有归属的主观印象。
- **接入模块**：从[宿主扩展接口](modules/API.md)和对应模块的 `module.json` 开始。宿主接口快照为 Aurabot 1.2.1、扩展 API 1；运行时以实际安装版本为准。
- **验证或升级**：见[维护与部署](MAINTENANCE.md)。[第三方清单](THIRD_PARTY.md)记录模块来源、许可和 npm 依赖。

这是 Aurabot 的模块集合，需要 DeepSeek Harness / Aurabot 宿主；不是独立聊天服务，也不包含 QQ 登录组件、宿主安装包或运行数据库。

## 记忆规则

实际发送成功才属于“说过”，实际调用结果才属于“做过”；草稿、意向和未知结果保留各自状态。消息原始时间、观察时间与检索时间分别处理。原文、精选事实、反思和派生摘要保留不同含义。

聊天、主动联系、私人日记和公开分享使用各自授权范围。撤权、纠错和显式忘记必须作用到相关派生上下文；恢复旧备份前也要先应用仍有效的忘记状态。

## 使用与更新

在仓库根目录用 Node.js 24 运行合成回归，不需要 QQ 登录：

```sh
node --test "tests/core/*.test.mjs" "tests/history/*.test.mjs" "tests/adapters/*.test.mjs" "tests/semantics/*.test.mjs" "tests/ui/*.test.mjs"
```

将通过验收的模块按原 ID 安装到宿主用户模块目录。不要把整个仓库覆盖到运行目录；原有设置、数据库和权限留在宿主。同名市场更新可能覆盖本地分叉，更新前先比较差异。

源码入库、离线测试通过和线上启用是不同状态。部署范围、实际宿主验收结果及尚未接通入口，应由对应交付记录说明。

## 许可

各模块保留原有 `LICENSE`、源码署名和第三方通知。本仓库没有统一重授上游代码许可；具体情况见 `THIRD_PARTY.md`。运行数据、凭据和私人日记不随源码分发。
