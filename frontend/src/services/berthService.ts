import { db } from '../db';
import type { Berth, BerthStatus } from '../types/berth';
import { toPlain } from '../utils/format';
import { syncBus } from './syncBus';

/** 乐观锁冲突（泊位已被其他标签页 / 页面修改） */
export class BerthConflictError extends Error {
  berthId: string;
  constructor(berthId: string, message: string) {
    super(message);
    this.name = 'BerthConflictError';
    this.berthId = berthId;
  }
}

/**
 * 条件更新泊位：版本号必须与读取时一致，否则说明已被其他标签页修改，拒绝覆盖。
 */
export async function conditionalPutBerth(expectedVersion: number, next: Berth): Promise<Berth> {
  return db.transaction('rw', db.berths, async () => {
    const current = await db.berths.get(next.id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== expectedVersion) {
      throw new BerthConflictError(
        next.id,
        `泊位 ${next.berthNo} 已被其他标签页修改（版本 ${expectedVersion} → ${currentVersion}），已自动刷新，请重试`,
      );
    }
    const saved: Berth = { ...next, version: currentVersion + 1 };
    await db.berths.put(toPlain(saved));
    return saved;
  });
}

/**
 * 手工登记 / 台账应用共用的泊位进出占用入口（防覆盖）：
 * - 进港：目标泊位必须空闲（或本船已占用），维修 / 他船占用直接拒绝
 * - 出港：只能释放本船占用的泊位，他船占用不动
 * 均以 version 乐观锁提交，多标签页并发必有一方失败。
 */
export async function changeBerthOccupancy(input: {
  portId: string;
  berthNo: string;
  vesselId: string;
  vesselName: string;
  type: '进港' | '出港';
  at: string;
  leaveAt?: string | null;
}): Promise<Berth> {
  const berthId = `${input.portId}-${input.berthNo}`;
  const expected = await db.berths.get(berthId);
  if (!expected) throw new BerthConflictError(berthId, `泊位 ${input.berthNo} 不存在`);
  const expectedVersion = expected.version ?? 0;

  let next: Berth;
  if (input.type === '进港') {
    if (expected.status === '维修') {
      throw new BerthConflictError(berthId, `泊位 ${input.berthNo} 正在维修，不能停靠`);
    }
    if (expected.status === '占用' && expected.vesselId && expected.vesselId !== input.vesselId) {
      throw new BerthConflictError(
        berthId,
        `泊位 ${input.berthNo} 已被 ${expected.vesselName ?? '其他船舶'} 占用，无法重复停靠`,
      );
    }
    // 本船重复进港：保持原靠泊时间，记录计划离泊时间
    if (expected.status === '占用' && expected.vesselId === input.vesselId) {
      next = { ...expected, leaveAt: input.leaveAt ?? null, version: expectedVersion };
    } else {
      next = {
        ...expected,
        status: '占用',
        vesselId: input.vesselId,
        vesselName: input.vesselName,
        berthAt: input.at,
        leaveAt: input.leaveAt ?? null,
        version: expectedVersion,
      };
    }
  } else {
    if (expected.status !== '占用' || !expected.vesselId) {
      throw new BerthConflictError(berthId, `泊位 ${input.berthNo} 当前不是占用状态，无需出港`);
    }
    if (expected.vesselId !== input.vesselId) {
      throw new BerthConflictError(
        berthId,
        `泊位 ${input.berthNo} 由 ${expected.vesselName ?? '其他船舶'} 占用，不能登记其他船出港`,
      );
    }
    next = {
      ...expected,
      status: '空闲',
      vesselId: null,
      vesselName: null,
      berthAt: null,
      leaveAt: input.at,
      version: expectedVersion,
    };
  }

  const saved = await conditionalPutBerth(expectedVersion, next);
  syncBus.post('data-changed', { berthId });
  return saved;
}

/** 详情页手工置为维修 / 空闲，同样走版本乐观锁 */
export async function changeBerthStatus(berthId: string, status: BerthStatus): Promise<Berth> {
  const expected = await db.berths.get(berthId);
  if (!expected) throw new BerthConflictError(berthId, '泊位不存在');
  const expectedVersion = expected.version ?? 0;
  const next: Berth = {
    ...expected,
    status,
    vesselId: status === '占用' ? expected.vesselId : null,
    vesselName: status === '占用' ? expected.vesselName : null,
    berthAt: status === '占用' ? expected.berthAt ?? new Date().toISOString() : null,
    leaveAt: status === '空闲' ? new Date().toISOString() : expected.leaveAt,
    version: expectedVersion,
  };
  const saved = await conditionalPutBerth(expectedVersion, next);
  syncBus.post('data-changed', { berthId });
  return saved;
}
