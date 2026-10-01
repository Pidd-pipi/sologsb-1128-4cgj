# 渔港与渔船档案地图（sologsb-1128 / gbfishport）

面向渔港管理站、渔业合作社与船东的**纯前端单页应用**：把渔港泊位条件、渔船技术档案与进出港动态集中到一张图上核对。
支持登记泊位与补给能力、建立含主机功率与吨位的渔船档案、记录进出港与泊位占用，并提供**港调室停靠台账每日跨系统对账**（CSV / TSV / JSON 导入）。

## 一键启动（Docker Compose）

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21828>

停止：

```bash
docker compose down
```

## 技术栈

| 分类 | 选型 |
| --- | --- |
| 框架 | Vue 3（`<script setup>` + TypeScript） |
| 构建 | Vite 5 |
| UI | Element Plus 2 |
| 状态 | Pinia |
| 路由 | Vue Router 4（history 模式，nginx `try_files` 兜底） |
| 本地存储 | IndexedDB（Dexie 4，库名 `gbfishport-db`）+ localStorage（表单草稿） |
| 跨标签页 | BroadcastChannel（降级 storage 事件）+ 泊位 version 乐观锁 |
| 地图 | 高德地图 JS API（`VITE_AMAP_KEY`），未配置 key 时降级为本地 SVG 网格视图 |
| 托管 | nginx:alpine（gzip + 前端路由回退） |

## 目录结构

```
sologsb-1128/
├── docker-compose.yml          # 无 version 字段；顶层 name: gbfishport
├── .env / .env.example         # COMPOSE_PROJECT_NAME / FRONTEND_PORT / VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile              # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf              # try_files $uri $uri/ /index.html + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # port.ts / vessel.ts / call.ts / berth.ts / todo.ts（5 个数据模型）
│       ├── stores/             # portStore.ts / vesselStore.ts / uiStore.ts / todoStore.ts
│       ├── db/                 # index.ts（Dexie v1→v4 迁移）/ berth.ts / seed.ts
│       ├── services/           # reconcileService（对账应用/预检）/ berthService（乐观锁）/ occupancy（时段占用）/ syncBus（跨标签页）
│       ├── components/common/  # PortCard / BerthGrid / VesselSpecTable / MapPanel / EmptyState
│       ├── hooks/              # useAmapLoader / useBerthStatus / useLocalDraft / useCrossTabSync
│       ├── pages/              # PortList / PortDetail / VesselList / VesselDetail / CallBoard / ReconcileBoard / TodoBoard / MapView
│       ├── router/index.ts
│       └── utils/              # tonnage.ts / geo.ts / format.ts
└── README.md
```

## 页面与路由

| 路由 | 说明 | 消费模型 |
| --- | --- | --- |
| `/` | 渔港一览：卡片展示等级、泊位数、在港船数与占用率，支持按等级与避风能力筛选 | FishingPort、Berth、PortCall |
| `/ports/:id` | 渔港详情：基本信息与补给能力、SVG 泊位网格（点击查看占用船舶）、在港船舶与近日流水 | 四个模型 |
| `/vessels` | 渔船检索：按作业类型、主机功率区间、总吨位与船籍港组合查询 | FishingVessel |
| `/vessels/:id` | 渔船档案详情：主尺度、主机功率、作业类型、证书有效期与进出港时间线 | FishingVessel、PortCall |
| `/calls` | 进出港登记：选择渔船与类型，填写泊位号、加冰量、加油量、卸货量并同步泊位状态 | PortCall、Berth、FishingVessel |
| `/reconcile` | 停靠台账对账：导入每日台账（CSV/TSV/JSON），按渔船编号 + 渔港 + 泊位时段配对，重复只留一条、字段差异先列差异并保留原记录；应用前检查容量与时段冲突，拒绝项自动落待办 | 四个模型、ReconcileTodo |
| `/todos` | 待办事项：容量不足 / 时段冲突 / 渔船未建档等预检拒绝项跟进处理 | ReconcileTodo |
| `/map` | 渔港与在港渔船分布：高德 JS API 标记，未配置 key 时为 SVG 网格视图，点选弹出泊位占用摘要 | FishingPort、Berth |

## 数据存储说明

- **业务数据走 IndexedDB（Dexie）**，库名 `gbfishport-db`，含版本号与升级迁移：
  - `v1`：建 `ports`、`vessels` 表
  - `v2`：新增 `calls` 表与 `vesselId` 索引
  - `v3`：新增 `berths` 表，并按每个渔港登记的泊位数生成初始泊位记录
  - `v4`：新增 `todos` 表（对账拒绝待办）；`calls` 增加 `portId`、`[portId+berthNo]`、`batchId` 索引与 `vesselNo/endTime/source` 字段；`berths` 增加 `version` 乐观锁字段；迁移时按泊位占用回填历史流水的渔港归属与渔船编号
- **表单草稿走 localStorage**（键前缀 `gbfishport:draft:`），例如进出港登记草稿 `gbfishport:draft:call-board`，提交成功后自动清空。草稿带时间戳与页面标识，多个标签页同时补录时旧页的静默保存会被拦截并提示「采用最新补录 / 以本页为准」，避免手工补录被旧标签页盖掉。

## 停靠台账对账（港调室每日导出）

- **导入格式**：CSV / TSV / JSON，表头兼容常见中文列名（渔船编号、渔港名称、泊位号、靠泊时间、离泊时间、加冰 kg、加油 L、卸货 kg、签证状态）；页面提供「下载台账模板」。
- **跨系统配对**：渔船按**渔船编号**匹配本机渔船档案，渔港按名称匹配渔港档案，泊位按渔港内泊位号匹配。
- **重复导入只留一条**：同渔船 + 同渔港 + 同泊位、靠泊时间相差 2 分钟内且字段一致 → 判为重复，保留在库原记录。
- **字段不同先列差异**：配对命中但加冰 / 加油 / 卸货 / 签证 / 时段等字段不一致 → 列出「原值 → 台账值」对照，默认保留原记录；勾选后仅按台账值更新原记录，不新增流水。
- **应用前检查**：靠泊时刻渔港**容量不足**（在港船数 ≥ 可用泊位数）、目标泊位**时段冲突**（已被其他船占用）、泊位不存在 / 维修 / 行数据异常 → 拒绝接入并自动生成**待办**（保留原始行，建档 / 调度后可重新导入）。
- **并发不互相覆盖**：泊位写入带 `version` 乐观锁，同一泊位被多个标签页同时修改时后写的一方收到冲突错误并自动刷新，不会盖掉先写的结果；业务数据变更通过 BroadcastChannel（不支持时降级 storage 事件）广播，其他标签页重新可见 / 收到广播时自动从 IndexedDB 重新装载。
- **整理结果同步显示**：渔港详情（本港流水按 `portId` 过滤、本港待办卡片、泊位计划离泊时间、台账/手工来源标记）、地图与占用率排行（泊位实时状态）、渔船档案时间线（停靠时段与来源）三处同步。
- 首次打开会自动写入一组演示数据（4 座渔港、6 艘渔船、8 条进出港流水与对应泊位），便于直接查看各页面效果。
- 容器无状态：不使用数据库服务、不挂载命名卷，清空浏览器站点数据即可重置。

## 高德地图 Key（可选）

`VITE_AMAP_KEY` 留空时**不会**请求任何外部地图服务，`useAmapLoader()` 立即返回降级标记，页面渲染本地 SVG 网格视图（可点选查看泊位占用）。需要真实底图时，在 `.env` 中填入 key 后重新构建：

```bash
VITE_AMAP_KEY=your-key docker compose up -d --build
```

## 本地开发（可选）

```bash
cd frontend
npm install
npm run dev
```

构建校验（类型检查 + 打包）：`npm run build`（等价于 `vue-tsc -b && vite build`）。

核心逻辑校验脚本（无浏览器也可运行，需 esbuild；IDB 集成测试另需 `fake-indexeddb`）：

```bash
# 纯函数：CSV 解析、配对判重、字段差异、容量/时段冲突预检
node_modules/.bin/esbuild scripts/check-reconcile.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/check-reconcile.mjs && node /tmp/check-reconcile.mjs

# 全链路（IndexedDB）：导入→对账→应用→待办→重复/差异→乐观锁并发
node_modules/.bin/esbuild scripts/check-idb-apply.ts --bundle --platform=node --format=esm \
  --alias:fake-indexeddb=$(pwd)/node_modules/fake-indexeddb \
  --outfile=/tmp/check-idb-apply.mjs && node /tmp/check-idb-apply.mjs
```
