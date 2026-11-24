# 来源、许可与依赖

本仓库维护 Aurabot 用户模块的本地分叉。模块名相同不代表代码与市场版相同；版本见各模块的 `module.json`。原作者字段、版权署名和第三方通知各自保留。

## 模块许可

| 模块 | 清单作者 | 许可依据 |
| --- | --- | --- |
| `autonomy` | asyncxt | MIT；保留模块内 `LICENSE` |
| `bili` | 未在清单声明 | MIT；保留模块内 `LICENSE` |
| `diary` | 未在清单声明 | MIT；保留模块内 `LICENSE` |
| `diary-sources` | 未在清单声明 | MIT；保留模块内 `LICENSE` |
| `history-vault` | RookieApe-tao | MIT；保留模块内 `LICENSE` |
| `image-familiar` | 未在清单声明 | MIT（仅清单声明，无独立 LICENSE） |
| `impression-card` | cdcp998 | MIT；保留模块内 `LICENSE` |
| `life-core` | 未在清单声明 | MIT（仅清单声明，无独立 LICENSE） |
| `meme-wiki` | Nightc-c | MIT；保留模块内 `LICENSE` |
| `memory` | Aurabot contributors（宿主上游） | 宿主内置模块的同 ID 分叉，见 [Aurabot MIT 许可](licenses/Aurabot-MIT.txt) |
| `moodboard` | RookieApe-tao | MIT；保留模块内 `LICENSE` |
| `night` | zcx1021 | MIT；保留模块内 `LICENSE` |
| `pet` | RookieApe-tao | 市场版 1.0.18 的同 ID 分叉；保留 `LICENSE` 和 `THIRD-PARTY-NOTICES.md`，不分发 CC 动画素材 |
| `purpose` | 未在清单声明 | MIT；保留模块内 `LICENSE` |
| `qwen-tts` | mrnobodynan | MIT；保留模块内 `LICENSE` |
| `qzone-social` | 未在清单声明 | MIT；保留模块内 `LICENSE` |
| `rss-reader` | RookieApe-tao | MIT；保留模块内 `LICENSE` |
| `speakup` | 未在清单声明 | MIT；保留模块内 `LICENSE` |
| `tieba-reader` | accomplish07zrh-eng | MIT；保留模块内 `LICENSE` |

`history-vault` 和 `rss-reader` 的 LICENSE 署名为 aureth-labs contributors，部分清单作者与版权署名不同，均保持原样。`impression-card` 的 LICENSE 同时保留 kes（原 MaiBot 插件）和 dsh-aurabot-qq contributors 的署名。

已在清单提供的来源：

- autonomy：[asyncxt/aurabot-mod-autonomy](https://github.com/asyncxt/aurabot-mod-autonomy)。
- impression-card：[cdcp998/impression-card](https://github.com/cdcp998/impression-card)。
- pet：[原模块](https://github.com/accomplish07zrh-eng/dsh-aurabot-qq)及其移植来源 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)；具体署名见[桌宠第三方通知](modules/pet/THIRD-PARTY-NOTICES.md)。
- purpose：引擎移植自 [Mieksido/surfcore](https://github.com/Mieksido/surfcore)；[目的引擎通知](modules/purpose/THIRD-PARTY-NOTICES.md)包含从宿主上游核回的原始署名及 MIT 许可全文。
- tieba-reader：见[打包依赖通知](modules/tieba-reader/THIRD-PARTY-NOTICES.md)。其中 boolbase 1.0.0 的包元数据声明 ISC；另附[上游许可证正文](licenses/boolbase-ISC.txt)（[来源](https://github.com/fb55/boolbase/blob/master/LICENSE)）。

`modules/API.md` 出自 [Aurabot 的接口模板](https://github.com/aureth-labs/dsh-aurabot-qq/blob/main/src/modules/API.md)；`memory` 的四个实现文件在文件头标明各自的宿主源路径，包括 [src/features/memory.js](https://github.com/aureth-labs/dsh-aurabot-qq/blob/main/src/features/memory.js)。宿主 1.2.1 的包清单声明 MIT，[上游许可](https://github.com/aureth-labs/dsh-aurabot-qq/blob/main/LICENSE)覆盖该软件与相应文档。本仓库保留其许可原文，不将其扩展到其他来源。`image-familiar`、`life-core` 为本地模块，许可按各自清单记录。

## npm 依赖

`impression-card/package.json` 声明唯一 npm 直接依赖 `sharp@0.35.5`，完整解析和平台可选包见同目录 `package-lock.json`。以下为锁文件中的许可声明，不替代包自身的通知；平台二进制依赖仅由包管理器在安装时取得，不随本仓库提交。

| 锁定包 | 版本 | 许可声明 |
| --- | --- | --- |
| `@emnapi/runtime` | 1.11.3 | MIT |
| `@img/colour` | 1.1.0 | MIT |
| `@img/sharp-darwin-arm64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-darwin-x64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-freebsd-wasm32` | 0.35.5 | Apache-2.0 |
| `@img/sharp-libvips-darwin-arm64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-darwin-x64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-arm64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-ppc64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-riscv64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-s390x` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linux-x64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-libvips-linuxmusl-x64` | 1.3.4 | LGPL-3.0-or-later |
| `@img/sharp-linux-arm` | 0.35.5 | Apache-2.0 |
| `@img/sharp-linux-arm64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-linux-ppc64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-linux-riscv64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-linux-s390x` | 0.35.5 | Apache-2.0 |
| `@img/sharp-linux-x64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-linuxmusl-arm64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-linuxmusl-x64` | 0.35.5 | Apache-2.0 |
| `@img/sharp-wasm32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT |
| `@img/sharp-webcontainers-wasm32` | 0.35.5 | Apache-2.0 |
| `@img/sharp-win32-arm64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-ia32` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `semver` | 7.8.6 | ISC |
| `sharp` | 0.35.5 | Apache-2.0 |
| `tslib` | 2.9.1 | 0BSD |

其他 package.json 仅声明模块类型或包信息，没有额外 npm 直接依赖。模块通过宿主提供的 API、工具、平台适配器及 Node.js 标准库工作；宿主与外部服务的授权、许可和数据条款仍各自适用。

