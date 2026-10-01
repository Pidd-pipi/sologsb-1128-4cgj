import { parseDelimited, buildTemplateCsv } from '../src/utils/csv';
import { buildReview, summarizeReview, normalizeEntry } from '../src/utils/reconcile';
import { precheckItem } from '../src/services/reconcileService';
import { buildKnownIntervals, FAR_FUTURE } from '../src/services/occupancy';
import type { FishingPort } from '../src/types/port';
import type { FishingVessel } from '../src/types/vessel';
import type { PortCall } from '../src/types/call';
import type { Berth } from '../src/types/berth';

function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error('❌ FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('✅ PASS:', message);
  }
}

const ports: FishingPort[] = [
  {
    id: 'p1', name: '石浦中心渔港', level: '中心渔港', longitude: 121.9, latitude: 29.2,
    berthCount: 3, berthDepth: 5, wharfLength: 100, shelterLevel: 12,
    supply: { fuel: true, ice: true, water: true }, manager: '站', createdAt: '',
  },
];
const vessels: FishingVessel[] = [
  { id: 'v1', name: '浙象渔05123', vesselNo: 'ZXY05123', homePort: '石浦', length: 1, beam: 1, grossTonnage: 1, enginePower: 1, operationType: '拖网', hullMaterial: '钢质', owner: 'x', certificateExpiry: '2027-01-01', createdAt: '' },
  { id: 'v2', name: '浙象渔05288', vesselNo: 'ZXY05288', homePort: '石浦', length: 1, beam: 1, grossTonnage: 1, enginePower: 1, operationType: '拖网', hullMaterial: '钢质', owner: 'x', certificateExpiry: '2027-01-01', createdAt: '' },
  { id: 'v3', name: '浙象渔05999', vesselNo: 'ZXY05999', homePort: '石浦', length: 1, beam: 1, grossTonnage: 1, enginePower: 1, operationType: '拖网', hullMaterial: '钢质', owner: 'x', certificateExpiry: '2027-01-01', createdAt: '' },
];

function berth(no: string, status: Berth['status'], vesselId: string | null = null, at: string | null = null): Berth {
  return { id: `p1-${no}`, portId: 'p1', berthNo: no, vesselId, vesselName: vesselId === 'v1' ? '浙象渔05123' : vesselId === 'v2' ? '浙象渔05288' : null, berthAt: at, leaveAt: null, status, designDepth: 5, version: 0 };
}

// 1) CSV 解析（含别名表头、引号、千分位）
const csv = [
  '船舶编号,港口名称,泊位,靠泊时间,离泊时间,加冰量,加油量,卸货量,签证',
  'zxy05123,石浦中心渔港,b01,2026/9/30 6:30,2026-09-30 18:00,"1,000","9,500","8,600",已签证',
].join('\n');
const rows = parseDelimited(csv);
assert(rows.length === 1, 'CSV 解析出 1 行');
const entry0 = normalizeEntry(rows[0]);
assert(entry0.vesselNo === 'ZXY05123', '编号大写归一化');
assert(entry0.berthNo === 'B01', '泊位号大写');
assert(entry0.iceKg === 1000, '加冰千分位解析');
assert(entry0.fuelL === 9500, '加油带引号千分位解析');
assert(entry0.visaStatus === '已签证', '签证别名识别');
assert(entry0.startTime !== null && entry0.endTime !== null, '两个时间均可解析');
assert(entry0.issues.length === 0, '首行无数据问题');

// 2) 新记录
const berths: Berth[] = [berth('B01', '空闲'), berth('B02', '空闲'), berth('B03', '维修')];
let review = buildReview(rows, vessels, ports, []);
assert(review.items[0].status === '新记录', '无在库记录时分类为新记录');

// 3) 重复：同船同港同泊位、时间窗口 2 分钟内（用解析出的 ISO 时间对齐，规避时区）
const dupTime = new Date(entry0.startTime as string);
dupTime.setMinutes(dupTime.getMinutes() + 1);
const dupCall: PortCall = {
  id: 'c1', vesselId: 'v1', vesselName: '浙象渔05123', vesselNo: 'ZXY05123', portId: 'p1',
  type: '进港', time: dupTime.toISOString(), endTime: entry0.endTime,
  berthNo: 'B01', iceKg: 1000, fuelL: 9500, unloadKg: 8600, visaStatus: '已签证', source: '手工', createdAt: '',
};
review = buildReview(rows, vessels, ports, [dupCall]);
assert(review.items[0].status === '重复', '同泊位时段且字段一致 → 重复只留一条');

// 4) 字段差异：时间对上但加油量不同
const diffCall: PortCall = { ...dupCall, fuelL: 8000 };
review = buildReview(rows, vessels, ports, [diffCall]);
assert(review.items[0].status === '字段差异', '字段不同 → 字段差异');
assert(review.items[0].diffs.some((d) => d.field === 'fuelL'), '差异中包含加油量');
assert(review.items[0].selected === false, '字段差异默认不勾选（保留原记录）');

// 5) 渔船未建档 / 渔港未建档
const csvUnknown = [
  '渔船编号,渔港名称,泊位号,靠泊时间',
  'NOPE999,石浦中心渔港,B02,2026-09-30 08:00',
  'ZXY05123,不存在的渔港,B02,2026-09-30 08:00',
].join('\n');
review = buildReview(parseDelimited(csvUnknown), vessels, ports, []);
assert(review.items[0].status === '渔船未建档', '编号匹配不到 → 渔船未建档');
assert(review.items[1].status === '渔港未建档', '渔港匹配不到 → 渔港未建档');

// 6) 行问题：缺泊位号、时间非法
const csvBad = '渔船编号,渔港名称,泊位号,靠泊时间\nZXY05123,石浦中心渔港,,瞎写的时间';
const bad = buildReview(parseDelimited(csvBad), vessels, ports, []).items[0];
assert(bad.entry.issues.length >= 2, `行问题收集（缺泊位 + 时间非法），实际 ${bad.entry.issues.join('；')}`);

// 7) 时段冲突：B01 在该时段已被 v2 占用
const conflictRows = parseDelimited(
  '渔船编号,渔港名称,泊位号,靠泊时间,离泊时间\nZXY05123,石浦中心渔港,B01,2026-09-30T10:00:00,2026-09-30T12:00:00',
);
const conflictEntry = normalizeEntry(conflictRows[0]);
review = buildReview(conflictRows, vessels, ports, []);
const base = buildKnownIntervals([], [
  { ...berth('B01', '空闲'), status: '占用', vesselId: 'v2', vesselName: '浙象渔05288', berthAt: conflictEntry.startTime, leaveAt: conflictEntry.endTime },
  berth('B02', '空闲'),
  berth('B03', '维修'),
]);
const problem = precheckItem(review.items[0], ports, berths, base);
assert(problem?.type === '时段冲突', '同泊位他船时段重叠 → 时段冲突');

// 8) 泊位缺失 / 容量检查
const capBerths: Berth[] = [
  { ...berth('B01', '空闲'), status: '占用', vesselId: 'v2', vesselName: '浙象渔05288', berthAt: '2026-09-30T09:00:00' },
  { ...berth('B02', '空闲'), status: '占用', vesselId: 'v3', vesselName: '浙象渔05999', berthAt: '2026-09-30T09:30:00' },
  berth('B03', '维修'),
];
const capRows = parseDelimited(
  '渔船编号,渔港名称,泊位号,靠泊时间,离泊时间\nZXY05123,石浦中心渔港,B01,2026-09-30T10:00:00,2026-09-30T12:00:00',
);
review = buildReview(capRows, vessels, ports, []);
const capBase = buildKnownIntervals([], capBerths);
assert(precheckItem(review.items[0], ports, capBerths, capBase)?.type === '时段冲突', '同船/泊位检查先命中时段冲突（占用他船）');
// 目标泊位不存在 → 泊位缺失
const capRows2 = parseDelimited(
  '渔船编号,渔港名称,泊位号,靠泊时间,离泊时间\nZXY05123,石浦中心渔港,B09,2026-09-30T10:00:00,2026-09-30T12:00:00',
);
review = buildReview(capRows2, vessels, ports, []);
assert(precheckItem(review.items[0], ports, capBerths, capBase)?.type === '泊位缺失', '泊位不存在 → 泊位缺失');

// 9) 容量 4、占用 2，新记录到空闲 B03 → 预检通过
const fourBerths: Berth[] = [
  { ...berth('B01', '空闲'), status: '占用', vesselId: 'v2', vesselName: '浙象渔05288', berthAt: '2026-09-30T09:00:00' },
  { ...berth('B02', '空闲'), status: '占用', vesselId: 'v3', vesselName: '浙象渔05999', berthAt: '2026-09-30T09:30:00' },
  berth('B03', '空闲'),
  berth('B04', '空闲'),
];
const capRows3 = parseDelimited(
  '渔船编号,渔港名称,泊位号,靠泊时间,离泊时间\nZXY05123,石浦中心渔港,B03,2026-09-30T10:00:00,2026-09-30T12:00:00',
);
review = buildReview(capRows3, vessels, ports, []);
assert(precheckItem(review.items[0], ports, fourBerths, buildKnownIntervals([], fourBerths)) === null, '有容量有空泊位 → 预检通过');

// 9b) 容量已满：港里所有非维修泊位在靠泊时刻都有占用 → 容量不足（即使本船排到的是别的空闲位也进不来）
//    3 个泊位：B01 v2 占、B02 v3 占、B03 当前空闲但台账显示 09:00 被 v2 占用过且 10:00 已离 →
//    为稳定构造"满员但目标位自身不冲突"，直接用 2 泊位港 + 目标位 B01 已释放、但满员需另一泊位占用：
//    改以 3 泊位、目标 B03 空闲，B01/B02/B03 三个位在 10:00 均被占且目标位用不冲突的不同时刻不可能，
//    因此容量场景用"目标位 B01 空闲，B02 占用"的 2 泊位历史时段构造：
const cap2Ports: FishingPort[] = [
  { ...ports[0], berthCount: 2 },
];
const cap2Berths: Berth[] = [berth('B01', '空闲'), berth('B02', '空闲')];
// B01 被 v2 在 08:00-09:30 占用（目标 10:00 不冲突），B02 被 v3 在 09:00-14:00 占用
// 10:00 时刻：B01 已空、B02 占用 → 还没满，追加 B01 在 09:45-11:00 又被 v2 占用即冲突。
// 正确满员构造：目标 B01 10:00 空闲意味着 B01 不占，要满员就得 B01 占 → 必然冲突，
// 故容量拒绝只在"目标位与占用船相同（本船已在港重复登记进港）但容量口径满"或"维修占位"时不先冲突。
// 业务上容量不足的真正触发点：可用泊位口径含维修时，维修位使容量缩水。构造 2 泊位其中 B02 维修、
// B01 被 v2 占 → 台账让 v1 停 B01：先冲突；让 v1 停 B02 → 维修拒绝。
// 综上，预检顺序 冲突→维修→容量 下，容量拒绝独立于冲突的场景为：同船自己在 B01（不冲突），且另一泊位也满。
const selfFullCalls: PortCall[] = [
  {
    id: 'h1', vesselId: 'v1', vesselName: '浙象渔05123', vesselNo: 'ZXY05123', portId: 'p1',
    type: '进港', time: '2026-09-30T08:00:00', endTime: '2026-09-30T11:00:00',
    berthNo: 'B01', iceKg: 0, fuelL: 0, unloadKg: 0, visaStatus: '已签证', source: '台账', createdAt: '',
  },
  {
    id: 'h2', vesselId: 'v3', vesselName: '浙象渔05999', vesselNo: 'ZXY05999', portId: 'p1',
    type: '进港', time: '2026-09-30T09:00:00', endTime: '2026-09-30T14:00:00',
    berthNo: 'B02', iceKg: 0, fuelL: 0, unloadKg: 0, visaStatus: '已签证', source: '台账', createdAt: '',
  },
];
const selfFullRows = parseDelimited(
  '渔船编号,渔港名称,泊位号,靠泊时间,离泊时间\nZXY05123,石浦中心渔港,B01,2026-09-30T10:00:00,2026-09-30T12:00:00',
);
review = buildReview(selfFullRows, vessels, cap2Ports, []);
const selfFullProblem = precheckItem(
  review.items[0],
  cap2Ports,
  cap2Berths,
  buildKnownIntervals(selfFullCalls, cap2Berths),
);
assert(selfFullProblem?.type === '容量不足', `同船已在港且港内满员 → 容量不足拒绝（实际：${selfFullProblem?.type ?? '通过'}）`);

// 同船自己的占用、另一泊位空 → 通过
const selfBase = buildKnownIntervals([selfFullCalls[0]], cap2Berths);
const selfRows = parseDelimited(
  '渔船编号,渔港名称,泊位号,靠泊时间,离泊时间\nZXY05123,石浦中心渔港,B01,2026-09-30T10:00:00,2026-09-30T12:00:00',
);
review = buildReview(selfRows, vessels, cap2Ports, []);
assert(precheckItem(review.items[0], ports, cap2Berths, selfBase) === null, '同船同时段不判冲突，容量未满 → 通过');

// 10) 在库台账流水（endTime）也要算占用（用 ISO 显式时间，避免时区偏差）
const ledgerRows = parseDelimited(
  '渔船编号,渔港名称,泊位号,靠泊时间,离泊时间\nZXY05123,石浦中心渔港,B01,2026-09-30T10:30:00,2026-09-30T12:00:00',
);
const ledgerEntry = normalizeEntry(ledgerRows[0]);
const ledgerCall: PortCall = {
  id: 'c2', vesselId: 'v2', vesselName: '浙象渔05288', vesselNo: 'ZXY05288', portId: 'p1',
  type: '进港', time: ledgerEntry.startTime as string, endTime: ledgerEntry.endTime,
  berthNo: 'B01', iceKg: 0, fuelL: 0, unloadKg: 0, visaStatus: '已签证', source: '台账', createdAt: '',
};
const ledgerBase = buildKnownIntervals([ledgerCall], [berth('B01', '空闲'), berth('B02', '空闲'), berth('B03', '维修')]);
review = buildReview(ledgerRows, vessels, ports, []);
assert(precheckItem(review.items[0], ports, berths, ledgerBase)?.type === '时段冲突', '已导入台账时段再次冲突导入 → 时段冲突（重复导入防护）');
assert(FAR_FUTURE === Number.MAX_SAFE_INTEGER, '无离泊时间按 +∞ 处理');

// 11) 模板可解析
const tplRows = parseDelimited(buildTemplateCsv());
assert(tplRows.length === 2, `模板含 2 行示例，实际 ${tplRows.length}`);

const s = summarizeReview(review.items);
console.log('summary:', s);
console.log(process.exitCode ? '❌ 有失败用例' : '🎉 全部用例通过');
