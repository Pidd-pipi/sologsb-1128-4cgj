import type { Berth } from '../types/berth';
import type { PortCall } from '../types/call';

/** 已知占用时段（毫秒时间戳，end 为 Infinity 表示尚未离泊） */
export interface OccupancyInterval {
  portId: string;
  berthNo: string;
  vesselId: string;
  vesselName: string;
  start: number;
  end: number;
  /** 来源类型：在库流水 / 泊位实时状态 / 本次待应用台账 */
  source: 'call' | 'live' | 'batch';
}

const FAR_FUTURE = Number.MAX_SAFE_INTEGER;

/**
 * 汇总本机已知的泊位占用时段：
 * - 带离泊时间的台账进港流水 → [time, endTime)
 * - 当前实时占用的泊位（berths 表）→ [berthAt, leaveAt ?? +∞)
 * 同一泊位同一船的实时时段与台账时段重叠时只保留一条，避免重复计数。
 */
export function buildKnownIntervals(calls: PortCall[], berths: Berth[]): OccupancyInterval[] {
  const intervals: OccupancyInterval[] = [];

  for (const call of calls) {
    if (call.type !== '进港' || !call.portId || !call.time) continue;
    const start = new Date(call.time).getTime();
    if (Number.isNaN(start)) continue;
    const endTs = call.endTime ? new Date(call.endTime).getTime() : NaN;
    intervals.push({
      portId: call.portId,
      berthNo: call.berthNo,
      vesselId: call.vesselId,
      vesselName: call.vesselName,
      start,
      end: Number.isNaN(endTs) ? FAR_FUTURE : endTs,
      source: 'call',
    });
  }

  for (const berth of berths) {
    if (berth.status !== '占用' || !berth.berthAt) continue;
    const start = new Date(berth.berthAt).getTime();
    if (Number.isNaN(start)) continue;
    const endTs = berth.leaveAt ? new Date(berth.leaveAt).getTime() : NaN;
    // 与台账时段同船同泊位且覆盖实时起点的，视为同一停靠，跳过
    const duplicated = intervals.some(
      (it) =>
        it.portId === berth.portId &&
        it.berthNo === berth.berthNo &&
        it.vesselId === berth.vesselId &&
        start >= it.start &&
        start < it.end,
    );
    if (duplicated) continue;
    intervals.push({
      portId: berth.portId,
      berthNo: berth.berthNo,
      vesselId: berth.vesselId ?? '',
      vesselName: berth.vesselName ?? '',
      start,
      end: Number.isNaN(endTs) ? FAR_FUTURE : endTs,
      source: 'live',
    });
  }

  return intervals;
}

export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** 某渔港在指定时刻被占用的泊位（按泊位号去重，取最晚靠泊的一条） */
export function occupiedBerthsAt(
  intervals: OccupancyInterval[],
  portId: string,
  ts: number,
): Map<string, OccupancyInterval> {
  const result = new Map<string, OccupancyInterval>();
  for (const it of intervals) {
    if (it.portId !== portId || ts < it.start || ts >= it.end) continue;
    const prev = result.get(it.berthNo);
    if (!prev || it.start > prev.start) result.set(it.berthNo, it);
  }
  return result;
}

/** 同一泊位与目标时段冲突（不同船）的占用时段 */
export function conflictsOnBerth(
  intervals: OccupancyInterval[],
  portId: string,
  berthNo: string,
  vesselId: string,
  start: number,
  end: number,
): OccupancyInterval[] {
  return intervals.filter(
    (it) =>
      it.portId === portId &&
      it.berthNo === berthNo &&
      it.vesselId !== vesselId &&
      intervalsOverlap(start, end, it.start, it.end),
  );
}

export { FAR_FUTURE };
