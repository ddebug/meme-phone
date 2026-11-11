# meme-phone（显示名「meme-phone」）

桌面 + App 图标形态的酒馆小手机前端。整套前端重写：数据单独存在自己的文件里，不写角色卡、不写聊天记录。

## 为什么重做

原来的「独立小手机」把十来个功能压进三个标签页加一个隐藏的加号菜单，功能很多但用不了、入口也找不到。这套换掉的是**外壳与信息架构**：

- 桌面：大字时钟 + 昨日日记卡 + 最近一条会话；下面两行 App 图标，再往下一排快捷动作与 Dock。
- 每个功能是一个 App，进去就是完整一页，回桌面就退出，没有中间层。
- 原来加号菜单里的同步角色、API、预设、分组管理，全部沉到「设置」。

## 目录

```
meme-phone/
├── manifest.json        酒馆扩展清单（display_name: meme-phone）
├── index.js             扩展入口：设置面板、菜单入口、挂载/卸载
├── style.css            宿主侧样式（@import 引入界面 CSS）
├── preview.html         单文件预览页，双击即可看（内含打包后的 JS/CSS/壁纸）
├── meme/
│   ├── index.js         模块入口：存储 + 宿主桥 + 外壳装配
│   ├── data.js          数据模型、演示数据、兼容兜底
│   ├── store.js         存储（酒馆文件 / localStorage）
│   ├── host.js          宿主桥（角色、上下文、模型调用），每处都降级
│   ├── shell.js         外壳：桌面、页面栈、事件分发、弹层
│   ├── icons.js         内联 SVG 图标与马卡龙配色
│   ├── meme.css         界面样式
│   └── apps/            聊天 / 通讯录 / 日记 / 设置 / 其余 App
├── assets/              壁纸（day / night）
└── scripts/
    └── build_preview.py 打包 preview.html
```

## 看界面

双击 `preview.html`。不依赖服务器，壁纸已内联成 data URI，挪到哪都能打开，用的是虚构演示数据（沈砚、江迟、林小满、顾南风、周末局）。

直达某一页：`preview.html#app-chat`、`#app-diary`、`#app-settings`、`#thread`、`#app-contacts`、`#app-wallet`、`#app-extras`、`#app-appearance`；末尾加 `&night` 看夜间主题。

改完 `meme/` 下的源码重新打包：

```
python scripts/build_preview.py
```

## 装进酒馆

把整个 `meme-phone` 文件夹放进 `data/<你的用户>/extensions/`，刷新页面。扩展设置里会多出「meme-phone · 桌面式小手机」，扩展菜单里多一项「meme-phone」。点开就是这台手机。

## 数据

- 位置：`/user/files/meme-phone.json`（酒馆里）/ localStorage（预览页）。
- 写入口只有 `store.flush()`：写完回读校验，失败保留 dirty 并报错，不静默丢数据。
- 备份：手机里「设置 → 数据 → 导出备份」，或扩展设置面板的「导出备份」。

## 这一版有什么、没什么

有：桌面、会话列表、会话页（发送、引用、复制、收藏、重新生成、删除、空输入唤醒主动消息）、通讯录与资料页、日记（日历、手写、让模型代写）、设置（资料、外观与主题、聊天开关、主动消息、提示词、备份、清空）、小剧场、钱包、收藏、表情、会员、计划、装扮、帮助。

没有（明确留白，入口不假装能用）：群聊成员管理、图片消息与查看器、转账流程、调用调试面板、主动消息的定时调度。

## 和旧项目的关系

独立项目，不引用旧项目的代码、命名或存储文件。旧项目保持原样，等这套界面对过之后再谈替换。
