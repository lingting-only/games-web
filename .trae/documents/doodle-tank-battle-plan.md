# 涂鸦坦克大战（doodletank）开发计划

## Summary

在 `d:\codeup\games-web\doodletank\` 新建一个文件夹，参照 `doodleshooter/` 的完整技术架构，开发一款 90坦克（Battle City）玩法的涂鸦风格坦克大战：

- **单人模式**：经典闯关 —— 守卫基地（老鹰），每关消灭全部敌人后进入下一关，含道具与坦克升级，多关卡布局。
- **联机模式**：双人合作闯关 —— 复用 doodleshooter 的 PeerJS 点对点联机（房主权威），两人一起守基地清怪过关。
- **技术架构与 doodleshooter 完全一致**：纯静态站点（无构建步骤）、vendor 引入 three.js + PeerJS、ES Modules 按职责分文件、程序化"作业本纸面+圆珠笔墨水"渲染（three.js 后处理）、程序化 8-bit 音乐音效、serve.py 本地起服。
- 同时在根目录 `index.html` 游戏合集里新增一张卡片入口。

## Current State Analysis（已探明的现状）

### doodleshooter 架构（要复刻的模板）
```
doodleshooter/
├── index.html          # 极简壳：importmap(three) + peerjs.min.js + <canvas id="c"> + <div id="hud"> + module src/main.js
├── style.css           # 作业本纸面风格 UI
├── serve.py            # python 静态服务器
├── Dockerfile / docker-compose.yml / .gitignore / .dockerignore
├── README.md
├── vendor/
│   ├── three/three.module.js + addons/utils/BufferGeometryUtils.js
│   └── peerjs/peerjs.min.js
└── src/                # main, render, physics, input, level, nav, effects, enemies, player, players, net, hud, audio, util, weapons
```

关键机制（已读源码确认）：
- **render.js**：场景渲染进数据缓冲（shade, inkId, normal.xy + depth），后处理 pass 画轮廓线、排线、纸纹、横格线、红边距；`makeInkMaterial()` + `INK` 色板（蓝圆珠笔/红笔/石墨/橙荧光笔…）。
- **net.js**：PeerJS P2P，无自家服务器；房主浏览器是权威。私房 5 位随机码、公房占 PUB0..PUB15 槽位（quick play 同时敲门探测）、probe/stay 两段入座、房主转发客户端互发消息（`msg.to` / `msg.relay`）、断线重连。本地 localhost 用独立命名空间前缀防止串线。
- **联机职责划分**：每个玩家本地模拟自己的身体并广播状态；房主记分。
- **根 index.html**：`GAMES` 数组加一项 + `art()` 里加一张手绘 SVG 缩略图即可上新游戏。

### 用户已确认的决策
1. 联机玩法 = **双人合作闯关**（不做对战大乱斗）。
2. 单人玩法 = **经典闯关**（不做无尽波次）。

## Game Design（90坦克 玩法 × 涂鸦视觉）

- **视角**：正交相机俯视（top-down），战场 13×13 大格（子弹/移动用 26×26 半格精度），四周砖墙围边。
- **地形块**：砖墙（可被打碎，半格精度破坏）、钢墙（仅满级子弹可毁）、河流（挡坦克不挡子弹）、树丛（遮挡坦克，不挡子弹）、冰面（打滑惯性）。
- **基地**：底部中央老鹰（涂鸦简笔画）。被击毁 = Game Over。
- **玩家坦克**：四方向移动（转向先转车身再走，带半格吸附辅助瞄准）、开火。星数升级：1星双发、2星提速、3星可破钢墙。3 条命，重生 2 秒无敌（头盔闪烁）。
- **敌坦克**：经典 4 种 —— 普通(100分)、快速(200分)、快弹(300分)、装甲(400分,4滴血,受击变色)。每关 20 辆，场上最多 4 辆，顶部 3 个出生点轮换，出生时有闪烁画星动画。随机 4 辆是闪红载具，击毁掉道具。
- **道具**（击毁闪红敌坦掉落）：星（升级）、手雷（全灭场上敌人）、头盔（无敌）、铁锹（基地周围变钢墙,限时）、坦克（+1命）、时钟（冻结敌人,限时）。
- **关卡**：内置 10 张手工布局（字符画地图），打完后循环并提速。过关有得分结算画面。
- **操作**：方向键/WASD 移动，空格/J/鼠标开火；支持手柄（沿用 doodleshooter input 的手柄映射风格）。
- **视觉**：所有坦克、地形、老鹰、道具都是 three.js 程序化几何体（盒子组合+简笔画细节），套用同一套墨水后处理 —— 整体像画在作业本上的坦克大战。墨色分工：蓝=玩家/砖、石墨=钢/敌坦、红=子弹/爆炸/闪红载具、绿=树、橙=道具。

## Proposed Changes

### 1. 新建 `doodletank/` 目录（主体工作）

直接从 doodleshooter 原样复制的文件：
- `vendor/three/**`、`vendor/peerjs/peerjs.min.js`（第三方库不动）
- `serve.py`、`Dockerfile`、`docker-compose.yml`、`.gitignore`、`.dockerignore`

新编写的文件：

| 文件 | 内容 |
| --- | --- |
| `index.html` | 同 doodleshooter 壳：importmap + peerjs + canvas + hud div + module main.js；标题"涂鸦坦克" |
| `style.css` | 作业本风格 UI（菜单、大厅、HUD、结算），从 doodleshooter style.css 改编 |
| `src/main.js` | 引导：菜单状态机（主页/联机/大厅/设置）、solo 与 co-op 流程、关卡推进（stage → 结算 → 下一关）、Game Over/重开、主循环、localStorage（最高分/关卡进度/名字/设置） |
| `src/render.js` | **InkRenderer 改编版**：保留数据缓冲+后处理 pass（轮廓/排线/纸纹/横格线），相机改为正交俯视，光照适配顶视，保留 `makeInkMaterial`/`INK` 色板 |
| `src/physics.js` | 轻量网格物理：半格瓦片地图的 AABB 碰撞（坦克对瓦片/坦克对坦克/子弹对一切）、冰面摩擦；替代 doodleshooter 的 3D World 但保持模块角色 |
| `src/level.js` | 关卡定义（字符串字符画 → 瓦片）+ `buildLevel()` 程序化生成砖/钢/水/树/冰/基地网格体；`LEVELS` 数组（10 关） |
| `src/tank.js` | Tank 类：程序化坦克造型（车体+履带+炮塔炮管，简笔画质感）、四方向转向/移动（半格吸附）、开火冷却、升级星数、受击闪烁、履带动画 |
| `src/player.js` | 本地玩家控制层：输入→Tank 指令、生命/重生/无敌盾、开火逻辑 |
| `src/enemies.js` | EnemyManager：出生队列（20辆/关、3出生点轮换、场上4辆上限）、4 种敌坦属性、简易 AI（朝基地方向 + 随机转向 + 撞墙转向，贴近90坦克）、闪红载具、冻结计时 |
| `src/bullets.js` | 子弹池：直线飞行、瓦片破坏（砖半格、钢满级判定）、坦克命中、基地命中判定、命中特效回调 |
| `src/powerups.js` | 道具生成/拾取/六种效果（含铁锹、时钟的定时回退） |
| `src/effects.js` | 爆炸（墨水迸溅+焦痕）、砖屑、子弹消散、出生画星、道具闪烁，沿用 doodleshooter effects 的 strokeBurst 风格 |
| `src/players.js` | RemoteTank：远端坦克渲染/插值 + 本地状态编码（pos/dir/moving/fire/star/dead），参照 doodleshooter players.js 的 encodeLocal 模式 |
| `src/net.js` | **doodleshooter net.js 改编复制**：大厅机制原样保留（私房码/公房槽/quick play/probe/relay/重连），只改命名空间前缀为 `doodletankdev-` / `doodletank-`，上限 2 人 |
| `src/hud.js` | HUD：关卡数、剩余敌人数（小坦克图标）、生命数、双方分数、道具提示、菜单/大厅/结算面板（复用 doodleshooter hud 的 DOM 面板结构） |
| `src/audio.js` | 程序化 8-bit 音乐（改编 doodleshooter audio 的 chiptune 引擎）+ 音效：引擎嗡嗡、开火、爆炸、砖碎、道具、过关/失败 jingle |
| `src/util.js` | rand/choose/clamp 等小工具（复制） |
| `README.md` | 玩法/运行/联机说明 |

### 2. 联机同步设计（双人合作，房主权威）

- **房主模拟**：所有敌人、敌方子弹、道具生成、瓦片破坏、基地血量、总分。
- **客户端**：本地模拟自己的坦克，20Hz 发送 `input`/`state`（位置、朝向、移动中、星数、开火事件）；房主校验并生成该玩家的子弹入权威模拟。
- **快照**：房主 15Hz 广播 `snap`（敌人数组、子弹数组、瓦片变化、道具、分数、剩余敌人、关卡状态），客户端插值远端实体。
- **消息类型**：`hello/welcome/start/input/state/fire/snap/hit/powerup/tile/stageClear/gameOver/restart/leave`，传输层完全复用 net.js（含 `to` 转发与 `relay`）。
- **流程**：房主在大厅选起始关卡 → 双方就绪 → 同步开局；一人断线则另一方回菜单并提示；通关后自动进下一关，任一方 Game Over（命尽）时若另一方仍在场可继续，双方命尽 = 结束回结算。

### 3. 根目录 `index.html` 新增入口

- `GAMES` 数组追加：`{ title: '涂鸦坦克', en: 'Doodle Tank', desc: '画在作业本上的90坦克…', tags: ['坦克大战','俯视','单人 / 联机'], href: './doodletank/', art: 'tank' }`
- `art()` 增加 `tank` 分支：手绘风坦克简笔画 SVG（蓝线条+红炮弹，风格对齐现有卡片）。

## Assumptions & Decisions

- **渲染路线**：用 three.js 正交俯视 + 同款墨水后处理，而非 2D canvas —— 这样与 doodleshooter 的渲染架构、纸面视觉完全一致（用户明确要求架构一样）。
- **联机上限 2 人**（合作闯关的天然人数），net.js 的 maxPlayers 设为 2。
- **不引入 nav.js / weapons.js / enemies 3D 版**：90坦克的 AI 与武器系统远比 doodleshooter 简单，按新玩法重写，保持每个模块小而清晰。
- **关卡数**：首批 10 张手工关卡，之后循环加速（经典街机做法）。
- **存档**：沿用 localStorage（最高分、单人解锁到的关卡、名字、音乐开关）。
- vendor 与部署文件直接复制 doodleshooter 的，保证两游戏依赖不漂移。

## Verification

1. `python serve.py 8911`（在 doodletank/ 内）→ 打开 http://127.0.0.1:8911 无控制台报错。
2. **单人**：从第 1 关打通到结算 —— 验证：四方向移动+半格吸附、子弹碎砖/钢墙判定、敌人出生上限与 AI、闪红掉道具、六种道具生效（铁锹/时钟的限时回退）、老鹰被毁与命尽都触发 Game Over、过关结算与进入下一关。
3. **联机**：开两个浏览器标签（或两台设备），一方建房（私房码）、另一方输入码加入 → 双方坦克同屏、房主击杀敌人双方一致、客户端开火能打碎砖且房主侧同步、掉道具双方可抢、过关同步推进、断线回菜单提示。
4. **Quick play**：公房槽位创建/加入路径可用。
5. 根 `index.html` 卡片点击能进入新游戏，手绘 SVG 缩略图显示正常。
6. 手柄可选验证：移动/开火映射生效。
