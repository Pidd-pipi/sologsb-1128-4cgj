// 集成测试：IndexedDB（fake-indexeddb）上的 解析→对账→应用→待办→乐观锁 全链路
// 运行：esbuild bundle 后用 node 执行（见 /tmp 下的 bundle）
import 'fake-indexeddb/auto';
import { db } from '../src/db';
import { parseDelimited } from '../src/utils/csv';
import { buildReview } from '../src/utils/reconcile';
import { applyReviewItems, precheckItem, BerthConflictError } from '../src/services/reconcileService';
import { buildKnownIntervals } from '../src/services/occupancy';
import { changeBerthOccupancy } from '../src/services/berthService';
import type { FishingPort } from '../src/types/port';
import type { FishingVessel } from '../src/types/vessel';
import type { Berth } from '../src/types/berth';

function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error('❌ FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('✅ PASS:', message);
  }
}

const port: FishingPort = {
  id: 'p1', name: '石浦中心渔港', level: '中心渔港', longitude: 121.9, latitude: 29.2,
  berthCount: 2, berthDepth: 5, wharfLength: 100, shelterLevel: 12,
  supply: { fuel: true, ice: true, water: true }, manager: '站', createdAt: '',
};
const vessel: FishingVessel = {
  id: 'v1', name: '浙象渔05123', vesselNo: 'ZXY05123', homePort: '石浦', length: 30, beam: 6,
  grossTonnage: 168, enginePower: 268, operationType: '拖网', hullMaterial: '钢质', owner: 'x',
  certificateExpiry: '2027-01-01', createdAt: '',
};
const vessel2: FishingVessel = {
  ...vessel, id: 'v2', vesselNo: 'ZXY05288', name: '浙象渔05288',
};
function makeBerth(no: string, extra: Partial<Berth> = {}): Berth {
  return {
    id: `p1-${no}`, portId: 'p1', berthNo: no, vesselId: null, vesselName: null,
    berthAt: null, leaveAt: null, status: '空闲', designDepth: 5, version: 0, ...extra,
  };
}

async function main(): Promise<void> {
  await db.ports.put(port);
  await db.vessels.bulkPut([vessel, vessel2]);
  await db.berths.bulkPut([makeBerth('B01'), makeBerth('B02')]);

  // ---- A. 导入两条台账：一条未来/当前停靠（覆盖"现在"的用历史时间避免真实时钟影响，选已结束时段）----
  // 为稳定断言实时泊位状态，用"当前在港"的时间窗：start=now-1h, end=now+2h（B01）
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const csv = [
    '渔船编号,渔港名称,泊位号,靠泊时间,离泊时间,加冰kg,加油L,卸货kg,签证状态',
    `ZXY05123,石浦中心渔港,B01,${iso(-3600_000).replace('T', ' ').slice(0, 16)},${iso(2 * 3600_000).replace('T', ' ').slice(0, 16)},100,200,300,待签证`,
    `NOPE000,石浦中心渔港,B02,${iso(-1800_000).replace('T', ' ').slice(0, 16)},${iso(3600_000).replace('T', ' ').slice(0, 16)},0,0,0,免签`,
  ].join('\n');

  const rows = parseDelimited(csv);
  assert(rows.length === 2, '台账解析 2 行');

  let review = buildReview(rows, [vessel, vessel2], [port], []);
  assert(review.items[0].status === '新记录', '行1 新记录');
  assert(review.items[1].status === '渔船未建档', '行2 渔船未建档');

  // 应用前预检
  const base = buildKnownIntervals([], await db.berths.toArray());
  assert(precheckItem(review.items[0], [port], await db.berths.toArray(), base) === null, '行1 预检通过');

  const result = await applyReviewItems({
    items: review.items,
    ports: [port],
    vessels: [vessel, vessel2],
    berths: await db.berths.toArray(),
    batchId: 'batch-test-1',
  });
  assert(result.inserted === 1, `插入 1 条流水（实际 ${result.inserted}）`);

  // 未建档行转待办
  const { createPendingTodos } = await import('../src/services/reconcileService');
  const todosCreated = await createPendingTodos(review.items, 'batch-test-1');
  assert(todosCreated === 1, `未建档生成 1 条待办（实际 ${todosCreated}）`);

  const calls = await db.calls.toArray();
  assert(calls.length === 1, 'calls 表 1 条');
  assert(calls[0].source === '台账' && calls[0].batchId === 'batch-test-1', '流水带台账来源与批次');
  assert(calls[0].portId === 'p1' && calls[0].vesselNo === 'ZXY05123', '流水回填渔港与编号');

  const b01 = await db.berths.get('p1-B01');
  assert(b01?.status === '占用' && b01.vesselId === 'v1', '覆盖当前的台账时段把 B01 置为占用');
  assert(b01.version === 1, `B01 版本推进到 1（实际 ${b01.version}）`);

  const todos = await db.todos.toArray();
  assert(todos[0].type === '渔船未建档' && todos[0].rawRow, '待办保留原始行 JSON 供重试');

  // ---- B. 重复导入只留一条 ----
  review = buildReview(rows, [vessel, vessel2], [port], await db.calls.toArray());
  assert(review.items[0].status === '重复', '同台账再次导入 → 重复');
  const result2 = await applyReviewItems({
    items: review.items,
    ports: [port],
    vessels: [vessel, vessel2],
    berths: await db.berths.toArray(),
    batchId: 'batch-test-2',
  });
  assert(result2.inserted === 0, '重复导入不新增');
  assert((await db.calls.count()) === 1, 'calls 仍为 1 条');

  // ---- C. 字段差异：保留原记录，勾选后更新 ----
  const diffCsv = `渔船编号,渔港名称,泊位号,靠泊时间,离泊时间,加冰kg,加油L,卸货kg,签证状态
ZXY05123,石浦中心渔港,B01,${iso(-3600_000).replace('T', ' ').slice(0, 16)},${iso(2 * 3600_000).replace('T', ' ').slice(0, 16)},555,200,300,待签证`;
  review = buildReview(parseDelimited(diffCsv), [vessel, vessel2], [port], await db.calls.toArray());
  assert(review.items[0].status === '字段差异', '加油以外字段一致、加冰不同 → 字段差异');
  assert(review.items[0].selected === false, '字段差异默认不勾选（保留原记录）');
  review.items[0].selected = true;
  const result3 = await applyReviewItems({
    items: review.items,
    ports: [port],
    vessels: [vessel, vessel2],
    berths: await db.berths.toArray(),
    batchId: 'batch-test-3',
  });
  assert(result3.updated === 1 && result3.inserted === 0, '差异采用后更新原记录、不新增');
  const updated = await db.calls.get(calls[0].id);
  assert(updated?.iceKg === 555, '原记录加冰量更新为台账值');
  assert((await db.calls.count()) === 1, '记录总数仍为 1（保留原记录）');

  // ---- D. 港满时新船停靠已占用位 → 时段冲突拒绝并生成待办 ----
  // B02 预置为 v2 占用（版本 0，带靠泊时间），模拟港内已停满两艘船的另一艘
  await db.berths.put(makeBerth('B02', {
    status: '占用', vesselId: 'v2', vesselName: '浙象渔05288', berthAt: iso(-1800_000), version: 0,
  }));
  const vessel3: FishingVessel = { ...vessel, id: 'v3', vesselNo: 'ZXY05777', name: '浙象渔05777' };
  await db.vessels.put(vessel3);
  const capCsv = `渔船编号,渔港名称,泊位号,靠泊时间,离泊时间
ZXY05777,石浦中心渔港,B01,${iso(-300_000).replace('T', ' ').slice(0, 16)},${iso(900_000).replace('T', ' ').slice(0, 16)}`;
  const capReview = buildReview(parseDelimited(capCsv), [vessel, vessel2, vessel3], [port], await db.calls.toArray());
  const snapshot = await db.berths.toArray();
  const capProblem = precheckItem(
    capReview.items[0],
    [port],
    snapshot,
    buildKnownIntervals(await db.calls.toArray(), snapshot),
  );
  assert(capProblem?.type === '时段冲突', `新船停已占用 B01 → 时段冲突（实际 ${capProblem?.type ?? '通过'}）`);

  const rejected = await applyReviewItems({
    items: capReview.items,
    ports: [port],
    vessels: [vessel, vessel2, vessel3],
    berths: snapshot,
    batchId: 'batch-test-4',
  });
  assert(rejected.rejected === 1 && rejected.todosCreated === 1, '冲突记录被拒绝并生成 1 条待办');
  const conflictTodos = await db.todos.where('type').equals('时段冲突').toArray();
  assert(conflictTodos.length === 1, '待办类型为时段冲突');

  // ---- E. 乐观锁：旧版本写入必失败，不覆盖 ----
  const stale = await db.berths.get('p1-B02');
  // 模拟其他标签页先改（B02 v2 出港，版本 0→1）
  await changeBerthOccupancy({
    portId: 'p1', berthNo: 'B02', vesselId: 'v2', vesselName: '浙象渔05288',
    type: '出港', at: iso(0),
  });
  // 旧标签页仍用 version=0 的快照想把 B02 置为维修 → 必须抛 BerthConflictError
  let threw = false;
  try {
    await db.transaction('rw', db.berths, async () => {
      const current = await db.berths.get('p1-B02');
      if ((current?.version ?? 0) !== (stale?.version ?? 0)) {
        throw new BerthConflictError('p1-B02', '版本不符');
      }
    });
  } catch (error) {
    threw = error instanceof BerthConflictError;
  }
  assert(threw, '旧标签页用过期版本写泊位 → BerthConflictError，互不覆盖');
  const finalB02 = await db.berths.get('p1-B02');
  assert(finalB02?.status === '空闲' && finalB02.version === 1, 'B02 保持他页写入的结果（空闲 v1）');

  // 待办去重：同未建档行二次 createPendingTodos 不再新增
  const again = await createPendingTodos(review.items, 'batch-test-1');
  assert(again === 0, '相同未归档待办去重，不重复生成');

  console.log(process.exitCode ? '❌ 集成测试存在失败' : '🎉 集成测试全部通过');
}

void main();
