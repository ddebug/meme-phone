# CSS 分层映射说明

## 背景与原则

`meme/meme.css` 原为单文件（拆分前 7389 行，SHA256 `EFE3AC68…C3E`）。本轮按五层做**物理拆分**，原则是：

- **只搬不改**：规则文本、选择器、声明、注释、块间空白与换行全部原样保留，不重排、不顺手优化。
- **保序拼接**：段文件按 `meme/css/order.json` 的顺序加载，顺序与拆分前单文件完全一致。层叠覆盖依赖这个顺序（文件后段的皮肤/夜间规则靠顺序覆盖前面的同名规则），**不要手工调换 import 行或段文件顺序**。
- **字节一致校验**：拆分工具把段文件按顺序拼回，与基线哈希逐字节比对通过后才落盘；`build_preview.py` 同样按 `order.json` 顺序拼接内联进 `preview.html`。

## 五层定义

| 层 | 目录/前缀 | 职责 |
| --- | --- | --- |
| tokens | `tokens-*.css` | 设计变量：颜色、文字层级、线、纸面、玻璃、强调、阴影、圆角、字体、输入框、壁纸 |
| shell | `shell-*.css` | 手机外壳与骨架：overlay/device/screen、壁纸层、状态栏、桌面、资料卡、图标网格、Dock、页面容器、导航栏、返回键、缩放适配 |
| components | `components-*.css` | 通用控件：列表行、头像、圆点、胶囊、计数角标、卡片、按钮、分组、空态、弹层/Toast、开关、下拉框、输入框、引用行、标签、图标磁贴 |
| apps | `apps-*.css` | 业务页：聊天、日记、设置、绘图/接口、预设、记忆、用户、角色、查 TA 手机、音乐、装扮、小剧场、行为消息/钱包 |
| themes | `themes-*.css` | 夜间模式、frost/pixel 皮肤覆盖、皮肤 token、内联色归一、各页主题适配 |

## 段清单（行号为拆分前单文件行号）

| 段文件 | 层 | 原行号 | 归属 |
| --- | --- | --- | --- |
| tokens-01.css | tokens | 1–55 | `.mp-root` 设计变量 |
| themes-02.css | themes | 57–82 | 夜间变量覆写 |
| shell-03.css | shell | 84–747 | 外壳/壁纸/状态栏/桌面/资料卡/图标网格/Dock/页面容器/标题副标题 |
| components-04.css | components | 749–764 | 图标按钮 |
| shell-05.css | shell | 766–780 | 返回栏 |
| components-06.css | components | 782–887 | 列表行/头像/圆点/胶囊/计数角标 |
| apps-07.css | apps | 889–1745 | 聊天设置页头、会话页、气泡、看大图、输入区、调试栏、日记页、设置页 |
| components-08.css | components | 1747–1984 | 通用卡片/按钮、空态、弹层/提示 |
| themes-09.css | themes | 1986–2045 | 夜间模式整段覆写 |
| shell-10.css | shell | 2047–2054 | 缩放适配（减弱动效） |
| components-11.css | components | 2056–2176 | 图标尺寸/层级/快捷动作/引用行/修正二 |
| themes-12.css | themes | 2178–2198 | 修正三：夜间主题快捷条与机身 |
| shell-13.css | shell | 2200–2301 | 透明背景/四种背景/素色底/回桌面操作条/小横条 |
| apps-14.css | apps | 2303–2406 | 外观主题胶囊、会话胶囊、绘图+接口 |
| components-15.css | components | 2408–2467 | iOS 胶囊按钮 |
| apps-16.css | apps | 2468–3401 | 预设行操作、接口/LLM 方案、聊天模型三段式、预设页、酒馆记忆页 |
| components-17.css | components | 3403–3630 | 置灰开关行 |
| themes-18.css | themes | 3632–3674 | 夜间适配 |
| components-19.css | components | 3675–3740 | 图标毛玻璃磁贴 |
| apps-20.css | apps | 3742–4619 | 装扮图标预览、用户管理、查角色、世界书、查 TA 手机、日程表、预设即 API、换 API |
| themes-21.css | themes | 4621–4644 | 壁纸透进页面、白卡变薄 |
| apps-22.css | apps | 4646–5004 | 音乐、装扮字体/灵动岛/图标 |
| components-23.css | components | 5006–5085 | 输入框统一底色、iOS 下拉框 |
| apps-24.css | apps | 5087–5412 | 自定义图标铺图 |
| themes-25.css | themes | 5414–6441 | 白色磨砂气泡、frost/pixel 皮肤全站基座、调试栏主题适配 |
| apps-26.css | apps | 6443–6935 | 小剧场类型与美化页、骨架差异、18+ 门页 |
| themes-27.css | themes | 6937–6976 | 主题适配：纸张/梦境夜间变体 |
| apps-28.css | apps | 6978–7395 | 聊天加号小剧场弹窗、行为消息/钱 |

## 引入链

- 宿主：`style.css` 首行 `@import url("meme/meme.css");`（未改）。
- 聚合入口：`meme/meme.css` 只含按 `order.json` 顺序的 `@import url("css/<段文件>");`。
- 预览打包：`scripts/build_preview.py` 读 `order.json` 顺序拼接段文件，做 `url("../assets/` → `url("assets/` 替换后内联进 `preview.html`；指纹写入 `preview.stamp.json`。

## 离线截图复核流程（已打通，不依赖浏览器自动化后端）

浏览器自动化后端（CDP）不可用时，可用系统 Edge 的 headless 模式直接渲染本地 `preview.html` 做逐页像素比对：

- **渲染参数**：`--headless --disable-gpu --hide-scrollbars --window-size=430,900 --force-device-scale-factor=1 --force-prefers-reduced-motion --virtual-time-budget=3000 --screenshot=<out.png> <url>`。
  - `--force-prefers-reduced-motion` + `--virtual-time-budget` 用来跳过入场过渡动画，避免截到不同动画帧；固定缩放因子保证两次渲染 DPI 一致。
- **按视图取页**：`preview.html?view=<app-id>`，夜间态追加 `#night`。主页面 app-id：`app-chat / app-contacts / app-diary / app-settings / app-extras / app-music / app-draw / app-plans / app-dress / app-presets / app-api`，桌面页不带 view。子页面（thread / contact / memory-presets / character-card / p-charphone / p-chatphone / user-item / extra-detail / photo-view / app-wallet / thread-settings / thread-diary）需在 URL 里补对应参数，当前基线未覆盖。
- **比对阈值**：同一份代码重截两次，设备右缘抗锯齿有固定抖动，实测每张约 90 px（集中在 x402–410、y50–61）；单张差异 ≤100 px 视为无视觉变化，超出即需人工看图定位。状态栏右上角时钟是动态的，比对时掩码排除。
- **门禁顺序**：动 CSS 前先截基线集 → 改规则 → `python scripts/build_preview.py` 重建 `preview.html` 与指纹 → `npm test` 全绿 → 重截比对基线集 → 每张 ≤100 px 才提交。

## 跨层归位（机械判定 + 分批执行）

### 审计现状

按选择器前缀做过一次静态审计，274 条规则的“前缀标准层”与“当前段层”不一致。**这些大多是边界模糊或审计误判，不能据此直接移动规则**，分类如下：

- **可候选归位 components（apps 段里的通用控件）**：`set-row / set-ico / set-name / set-value / switch / quote / msg-meta / msg-more / tag-proactive / avatar-btn / group / chip-btn / glass-ico / mini-btn` 等，主要在 `apps-07/14/20/28`。
- **可候选归位 themes（散落在业务段里的覆写）**：选择器带 `data-mp-theme="night"` / `data-mp-skin="frost"` 的规则，紧跟在对应基础规则后面；它们是否能挪到 themes 末尾，要逐条确认不被顺序反盖。
- **边界模糊（暂不动）**：`components-17` 里的 `preset-item / api-use / item-mini` 等是预设/接口页业务组件，归 components 或 apps 都说得通；复合选择器（`.mp-set-row.is-danger .mp-set-name`）按首段类名推断会误判归属。
- **审计误判**：`.mp-root` 前缀、状态修饰符、`@media`/`@keyframes` 块不代表业务归属。

### 判定脚本

`node scripts/analyze-css-layers.mjs`（只读，`npm run css-layers`）。按 `order.json` 逐段解析规则，筛出非 themes 段里带 `data-mp-theme=` / `data-mp-skin=` 的覆写，再把选择器的主题/皮肤属性与 `.mp-root` 前缀剥掉得到“归一化键”：

- 若**目标 themes 段及其之后**（含该段自身、含 `@media` 内部规则）存在同键规则，移动会让两条同特异性规则先后反转 → 保留；
- 否则移动不改变层叠结果 → 可移动；
- `@media` 内的覆写单独归类，不自动移动（移动要重建条件块）。

判据的前提：night/skin 覆写特异性高于同元素基础规则，与基础规则的先后无关紧要；只有**同键同特异性**才顺序敏感。

### 当前结论

28 个段里散落覆写 **54 条**：**30 条可移动**、**19 条因同键冲突保留**、**5 条在 `apps-28`（末段）之后已无 themes 段**。剩余可移批次：`components-19`（→ `themes-21`，桌面磁贴）、`apps-22`（→ `themes-25`，音乐页）。保留主因是 `themes-25` 里的 frost 同键规则（`.mp-switch`、`.mp-switch.on`、`[frost][night] .mp-switch:not(.on)`、`is-danger` 的 name/ico）。

### 已完成批次

- `apps-16` → `themes-18`：聊天模型页 6 条 `.mp-api-*` 夜间语义色，整块含注释搬移，声明与选择器未改。重建 + `npm test` 105 项全绿 + 昼夜 22 张 app 页比对全部 90 px。
- `apps-20` → `themes-21`：12 条夜间覆写（`glass-ico`、`user-tag`、`roles-radio`、`wi-scan/wi-retry`、`char-query`、`char-tag`、`cp-badge/comment/bubble`、`api-clone`、`api-card-swap`），相邻块合并后 7 块整搬。比对 12 张白天全 0 px、夜间 11 张全 0 px（桌面夜间页见"已知不稳定"）。
- `shell-13` → `themes-18`：3 条 `[data-mp-wall="none"][night]` 外壳/屏幕/页面深色背景，整块搬移。为此给预览加了 `wall` / `skin` 参数（`preview.html?view=x#night&wall=none`），`wall=none` 夜间三张图比对 0 px。

### 已知不稳定

夜间桌面页（`preview.html#night`）在 headless 下渲染非确定：同一份代码连截三次得到三种结果（约 222k / 224k / 238k 字节，两图差异 37.8 万像素）。该页**不纳入像素门禁**，改人工目检；其余 11 个 app 页与白天桌面稳定在 90 px。

### 归位纪律

1. 一次只移一小类规则，移完重建 `preview.html` → `npm test` 全绿 → 逐页截图与拆分前基线比对，确认像素级无变化再继续。
2. 同一组相邻规则（基础 + night + `.on` 变体）尽量整块移动；拆散会让同一控件样式散落两处，比留在原层更糟。
3. 任何移动都不允许顺手改声明、改选择器或合并规则；只改文件归属。
4. 移动前先跑判定脚本，`@media` 内或同键冲突的规则一律不动。

