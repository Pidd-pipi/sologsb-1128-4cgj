import { db } from '../db';
import type { FishingPort } from '../types/port';
import type { FishingVessel } from '../types/vessel';
import type { PortCall } from '../types/call';
import type { Berth } from '../types/berth';
import type { ReconcileTodo, TodoType } from '../types/todo';
import { uid, toPlain } from '../utils/format';
import {
  buildKnownIntervals,
  conflictsOnBerth,
  occupiedBerthsAt,
  FAR_FUTURE,
  type OccupancyInterval,
} from './occupancy';
import { syncBus } from './syncBus';
import { BerthConflictError } from './berthService';
import type { ReviewItem } from '../utils/reconcile';

export { BerthConflictError };

export interface ApplyResult {
  inserted: number;
  updated: number;
  rejected: number;
  rejectedItems: ReviewItem[];
  /** 成功写入（插入或更新）的台账行 key */
  appliedKeys: number[];
  todosCreated: number;
}

/**
 * 台账应用前预检单条记录：
 * 1) 行数据完整性
 * 2) 泊位是否存在
 * 3) 靠泊时刻渔港容量是否已满
 * 4) 指定泊位时段是否与其他船冲突
 * @param baseIntervals 已知占用时段（在库流水 + 实时泊位），由调用方统一构建
 */
export function precheckItem(
  item: ReviewItem,
  ports: FishingPort[],
  berths: Berth[],
  baseIntervals: OccupancyInterval[],
): ReviewItem['precheck'] {
  const { entry } = item;
  if (entry.issues.length > 0) {
    return { type: '泊位缺失', message: entry.issues.join('；') };
  }
  const port = ports.find((p) => p.id === item.portId);
  if (!port) {
    return { type: '泊位缺失', message: `渔港「${entry.portName}」未建档` };
  }
  const target = berths.find((b) => b.portId === item.portId && b.berthNo === entry.berthNo);
  if (!target) {
    return { type: '泊位缺失', message: `渔港「${port.name}」不存在泊位 ${entry.berthNo}` };
  }
  if (target.status === '维修') {
    return { type: '泊位缺失', message: `泊位 ${entry.berthNo} 正在维修，台账停靠时段不能安排在该泊位` };
  }

  const start = new Date(entry.startTime as string).getTime();
  const end = entry.endTime ? new Date(entry.endTime).getTime() : FAR_FUTURE;

  const berthConflicts = conflictsOnBerth(
    baseIntervals,
    item.portId,
    entry.berthNo,
    item.vesselId,
    start,
    end,
  );
  if (berthConflicts.length > 0) {
    const other = berthConflicts[0];
    return {
      type: '时段冲突',
      message: `泊位 ${entry.berthNo} 在该时段已由 ${other.vesselName || '其他船舶'} 占用（${new Date(
        other.start,
      ).toLocaleString()} ~ ${
        Number.isFinite(other.end) ? new Date(other.end).toLocaleString() : '离泊时间未知'
      }）`,
    };
  }

  // 容量检查：靠泊时刻在港船数达到可用泊位数即拒绝
  const usable = berths.filter((b) => b.portId === item.portId && b.status !== '维修').length;
  const occupiedAtStart = occupiedBerthsAt(baseIntervals, item.portId, start);
  if (occupiedAtStart.size >= usable) {
    return {
      type: '容量不足',
      message: `「${port.name}」在靠泊时刻已无空闲泊位（在港 ${occupiedAtStart.size} / 可用 ${usable}）`,
    };
  }
  return null;
}

/** 待办去重键：同类型同渔船同泊位同时段未关闭的待办只留一条 */
function todoDedupKey(todo: ReconcileTodo): string {
  return [todo.type, todo.vesselNo ?? '', todo.portId ?? '', todo.berthNo ?? '', todo.startTime ?? ''].join('|');
}

function makeTodoFromItem(item: ReviewItem, batchId: string, reason: string, type: TodoType): ReconcileTodo {
  const { entry } = item;
  return {
    id: uid('t'),
    type,
    status: '待处理',
    title: `${entry.vesselName || entry.vesselNo} 无法接入 ${entry.portName || '未知渔港'} · ${entry.berthNo || '未知泊位'}`,
    reason,
    portId: item.portId || undefined,
    portName: entry.portName || undefined,
    vesselNo: entry.vesselNo || undefined,
    vesselName: entry.vesselName || undefined,
    berthNo: entry.berthNo || undefined,
    startTime: entry.startTime,
    endTime: entry.endTime,
    batchId,
    rawRow: JSON.stringify(entry.raw),
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

export interface ApplyContext {
  items: ReviewItem[];
  ports: FishingPort[];
  vessels: FishingVessel[];
  berths: Berth[];
  batchId: string;
  onItemResolved?: (key: number) => void;
}

/**
 * 应用选中的对账结果：逐条预检 → 拒绝的落待办；通过的在独立事务中
 * 写流水并按台账时段重算相关泊位的实时状态（版本乐观锁，防多标签页覆盖）。
 */
export async function applyReviewItems(ctx: ApplyContext): Promise<ApplyResult> {
  const { items, ports, berths, batchId } = ctx;

  const todosToCreate: ReconcileTodo[] = [];
  const existingTodos = await db.todos.where('status').anyOf(['待处理', '处理中']).toArray();
  const dedupKeys = new Set(existingTodos.map(todoDedupKey));

  // 本批次动态累积的已接受时段与泊位版本快照
  const baseIntervals = buildKnownIntervals(
    await db.calls.toArray(),
    await db.berths.toArray(),
  );
  const acceptedIntervals: OccupancyInterval[] = [];
  const liveVersions = new Map<string, number>(berths.map((b) => [b.id, b.version ?? 0]));

  const targetItems = items
    .filter((i) => i.selected && (i.status === '新记录' || i.status === '字段差异'))
    .sort((a, b) => (a.entry.startTime ?? '').localeCompare(b.entry.startTime ?? ''));

  const rejectedItems: ReviewItem[] = [];
  const appliedKeys: number[] = [];
  let inserted = 0;
  let updated = 0;

  const queueTodo = (item: ReviewItem, reason: string, type: TodoType): void => {
    const todo = makeTodoFromItem(item, batchId, reason, type);
    if (!dedupKeys.has(todoDedupKey(todo))) {
      dedupKeys.add(todoDedupKey(todo));
      todosToCreate.push(todo);
    }
    rejectedItems.push(item);
  };

  for (const item of targetItems) {
    const { entry } = item;

    if (item.status === '新记录') {
      const problem = precheckItem(item, ports, berths, baseIntervals.concat(acceptedIntervals));
      if (problem) {
        queueTodo(item, problem.message, problem.type);
        ctx.onItemResolved?.(item.key);
        continue;
      }
    }

    const vessel = ctx.vessels.find((v) => v.id === item.vesselId);
    if (!vessel) continue;

    try {
      await db.transaction('rw', db.calls, db.berths, async () => {
        if (item.status === '字段差异' && item.matchedCallId) {
          const matched = await db.calls.get(item.matchedCallId);
          if (!matched) throw new Error('原记录已不存在');
          // 字段差异：原记录保留（不新增），仅按勾选采用台账值更新字段
          const next: PortCall = {
            ...matched,
            vesselId: vessel.id,
            vesselName: vessel.name,
            vesselNo: vessel.vesselNo,
            portId: item.portId,
            berthNo: entry.berthNo,
            time: entry.startTime as string,
            endTime: entry.endTime ?? null,
            iceKg: entry.iceKg,
            fuelL: entry.fuelL,
            unloadKg: entry.unloadKg,
            visaStatus: entry.visaStatus,
            source: '台账',
            batchId,
          };
          await db.calls.put(toPlain(next));
          updated += 1;
        } else {
          const call: PortCall = {
            id: uid('c'),
            vesselId: vessel.id,
            vesselName: vessel.name,
            vesselNo: vessel.vesselNo,
            portId: item.portId,
            type: '进港',
            time: entry.startTime as string,
            endTime: entry.endTime ?? null,
            berthNo: entry.berthNo,
            iceKg: entry.iceKg,
            fuelL: entry.fuelL,
            unloadKg: entry.unloadKg,
            visaStatus: entry.visaStatus,
            source: '台账',
            batchId,
            createdAt: new Date().toISOString(),
          };
          await db.calls.put(toPlain(call));
          inserted += 1;
        }

        // 按台账时段重算涉及泊位的实时状态（仅当台账覆盖"现在"才改变实时占用）
        const berthId = `${item.portId}-${entry.berthNo}`;
        const expectedVersion = liveVersions.get(berthId) ?? 0;
        const current = await db.berths.get(berthId);
        if (!current) return;
        if ((current.version ?? 0) !== expectedVersion) {
          throw new BerthConflictError(
            berthId,
            `泊位 ${entry.berthNo} 在应用过程中被其他标签页修改，请刷新后重试本条`,
          );
        }
        const now = Date.now();
        const startTs = new Date(entry.startTime as string).getTime();
        const endTs = entry.endTime ? new Date(entry.endTime).getTime() : FAR_FUTURE;
        const coversNow = startTs <= now && now < endTs;
        if (coversNow && (current.status === '空闲' || current.vesselId === vessel.id)) {
          const nextBerth: Berth = {
            ...current,
            status: '占用',
            vesselId: vessel.id,
            vesselName: vessel.name,
            berthAt: current.vesselId === vessel.id ? current.berthAt : entry.startTime,
            leaveAt: entry.endTime ?? null,
            version: (current.version ?? 0) + 1,
          };
          await db.berths.put(toPlain(nextBerth));
          liveVersions.set(berthId, nextBerth.version ?? 0);
        } else if (entry.endTime && endTs <= now && current.vesselId === vessel.id && current.status === '占用') {
          // 台账记录的是已结束的历史停靠且当前仍是本船 → 释放
          const nextBerth: Berth = {
            ...current,
            status: '空闲',
            vesselId: null,
            vesselName: null,
            berthAt: null,
            leaveAt: entry.endTime,
            version: (current.version ?? 0) + 1,
          };
          await db.berths.put(toPlain(nextBerth));
          liveVersions.set(berthId, nextBerth.version ?? 0);
        }
      });

      acceptedIntervals.push({
        portId: item.portId,
        berthNo: entry.berthNo,
        vesselId: vessel.id,
        vesselName: vessel.name,
        start: new Date(entry.startTime as string).getTime(),
        end: entry.endTime ? new Date(entry.endTime).getTime() : FAR_FUTURE,
        source: 'batch',
      });
      appliedKeys.push(item.key);
      ctx.onItemResolved?.(item.key);
    } catch (error) {
      if (error instanceof BerthConflictError) throw error;
      queueTodo(item, (error as Error).message, '登记冲突');
    }
  }

  if (todosToCreate.length) {
    await db.todos.bulkPut(toPlain(todosToCreate));
  }
  if (inserted || updated) {
    syncBus.post('data-changed');
  }
  if (todosToCreate.length) {
    syncBus.post('todo-changed');
  }

  return {
    inserted,
    updated,
    rejected: rejectedItems.length,
    rejectedItems,
    appliedKeys,
    todosCreated: todosToCreate.length,
  };
}

/** 未建档渔船 / 渔港（或行数据问题）在应用时统一转待办 */
export async function createPendingTodos(items: ReviewItem[], batchId: string): Promise<number> {
  const targets = items.filter(
    (i) => !i.selected && (i.status === '渔船未建档' || i.status === '渔港未建档'),
  );
  if (!targets.length) return 0;
  const existing = await db.todos.where('status').anyOf(['待处理', '处理中']).toArray();
  const keys = new Set(existing.map(todoDedupKey));
  const todos: ReconcileTodo[] = [];
  for (const item of targets) {
    const type: TodoType = item.status === '渔船未建档' ? '渔船未建档' : '其他';
    const reason =
      item.status === '渔船未建档'
        ? `渔船编号 ${item.entry.vesselNo} 未在本机渔船档案中找到，请先建档后重试`
        : `渔港「${item.entry.portName}」未建档或行信息有误：${item.entry.issues.join('；') || '请核对渔港名称'}`;
    const todo = makeTodoFromItem(item, batchId, reason, type);
    if (!keys.has(todoDedupKey(todo))) {
      keys.add(todoDedupKey(todo));
      todos.push(todo);
    }
  }
  if (todos.length) {
    await db.todos.bulkPut(toPlain(todos));
    syncBus.post('todo-changed');
  }
  return todos.length;
}
