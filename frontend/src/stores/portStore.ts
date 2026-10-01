import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import { emptyPortFilter, type FishingPort, type PortFilter, type SupplyCapability } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';
import type { CallDraft, PortCall } from '../types/call';
import type { LedgerRow } from '../types/ledger';
import { buildBerthRecords } from '../db/berth';
import { ConflictError } from '../utils/conflict';
import { broadcastDataChanged } from '../utils/sync';

export interface PortInput {
  name: string;
  level: FishingPort['level'];
  longitude: number;
  latitude: number;
  berthCount: number;
  berthDepth: number;
  wharfLength: number;
  shelterLevel: number;
  supply: SupplyCapability;
  manager: string;
}

export const usePortStore = defineStore('port', () => {
  const ports = ref<FishingPort[]>([]);
  const berths = ref<Berth[]>([]);
  const calls = ref<PortCall[]>([]);
  const loading = ref(false);
  const filter = ref<PortFilter>(emptyPortFilter());

  const filteredPorts = computed(() => {
    const f = filter.value;
    const keyword = f.keyword.trim();
    return ports.value.filter((p) => {
      if (f.level && p.level !== f.level) return false;
      if (f.minShelterLevel !== null && p.shelterLevel < f.minShelterLevel) return false;
      if (keyword && !p.name.includes(keyword) && !p.manager.includes(keyword)) return false;
      return true;
    });
  });

  const callsSorted = computed(() =>
    [...calls.value].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
  );

  function portById(id: string): FishingPort | undefined {
    return ports.value.find((p) => p.id === id);
  }

  function berthsOf(portId: string): Berth[] {
    return berths.value.filter((b) => b.portId === portId).sort((a, b) => a.berthNo.localeCompare(b.berthNo));
  }

  function callsOfVessel(vesselId: string): PortCall[] {
    return callsSorted.value.filter((c) => c.vesselId === vesselId);
  }

  function resetFilter(): void {
    filter.value = emptyPortFilter();
  }

  async function loadAll(): Promise<void> {
    loading.value = true;
    try {
      const [p, b, c] = await Promise.all([db.ports.toArray(), db.berths.toArray(), db.calls.toArray()]);
      ports.value = p;
      berths.value = b;
      calls.value = c;
    } finally {
      loading.value = false;
    }
  }

  async function createPort(input: PortInput): Promise<FishingPort> {
    const port: FishingPort = {
      id: uid('p'),
      name: input.name.trim(),
      level: input.level,
      longitude: Number(input.longitude),
      latitude: Number(input.latitude),
      berthCount: Number(input.berthCount),
      berthDepth: Number(input.berthDepth),
      wharfLength: Number(input.wharfLength),
      shelterLevel: Number(input.shelterLevel),
      supply: { ...input.supply },
      manager: input.manager.trim(),
      createdAt: new Date().toISOString(),
    };
    // 写库前脱代理，避免 DataCloneError
    await db.ports.put(toPlain(port));
    const records = buildBerthRecords(port, []);
    await db.berths.bulkPut(toPlain(records));
    ports.value = [...ports.value, port];
    berths.value = [...berths.value, ...records];
    return port;
  }

  async function addBerth(portId: string, berthNo: string, designDepth: number): Promise<Berth | null> {
    const port = portById(portId);
    if (!port) return null;
    const no = berthNo.trim().toUpperCase();
    if (!no) return null;
    if (berthsOf(portId).some((b) => b.berthNo === no)) return null;
    const berth: Berth = {
      id: `${portId}-${no}`,
      portId,
      berthNo: no,
      vesselId: null,
      vesselName: null,
      berthAt: null,
      leaveAt: null,
      status: '空闲',
      designDepth: Number(designDepth) || port.berthDepth,
      version: 1,
    };
    await db.berths.put(toPlain(berth));
    berths.value = [...berths.value, berth];
    const nextCount = berthsOf(portId).length;
    await updatePort(portId, { berthCount: nextCount });
    return berth;
  }

  /**
   * 泊位乐观锁写入：在事务内读取最新记录，比对版本号一致后才写入（版本 +1）。
   * 版本不一致说明其他标签页已修改同一泊位，抛出 ConflictError，绝不覆盖。
   */
  async function writeBerth(
    berthId: string,
    expectedVersion: number | undefined,
    patch: (current: Berth) => Berth,
  ): Promise<Berth> {
    const next = await db.transaction('rw', db.berths, async () => {
      const current = await db.berths.get(berthId);
      if (!current) throw new Error('泊位不存在或已被删除');
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new ConflictError(
          `泊位 ${current.berthNo} 已被其他标签页修改（本地版本 ${expectedVersion} ≠ 最新版本 ${current.version}），请刷新后重试`,
        );
      }
      const merged = patch(current);
      merged.version = current.version + 1;
      await db.berths.put(toPlain(merged));
      return merged;
    });
    return next;
  }

  async function setBerthStatus(berthId: string, status: BerthStatus): Promise<void> {
    const hit = berths.value.find((b) => b.id === berthId);
    if (!hit) return;
    const next = await writeBerth(berthId, hit.version, (current) => ({
      ...current,
      status,
      vesselId: status === '占用' ? current.vesselId : null,
      vesselName: status === '占用' ? current.vesselName : null,
      berthAt:
        status === '占用' ? current.berthAt ?? new Date().toISOString() : current.berthAt,
      leaveAt: status === '空闲' ? new Date().toISOString() : null,
    }));
    berths.value = berths.value.map((b) => (b.id === berthId ? next : b));
    broadcastDataChanged();
  }

  async function updatePort(portId: string, patch: Partial<FishingPort>): Promise<void> {
    const hit = portById(portId);
    if (!hit) return;
    const next: FishingPort = { ...hit, ...patch };
    await db.ports.put(toPlain(next));
    ports.value = ports.value.map((p) => (p.id === portId ? next : p));
  }

  /**
   * 登记一条进出港记录，并同步泊位占用状态（进港 → 占用，出港 → 释放）。
   * 写库在同一事务内完成，并对泊位做乐观锁版本比对：其他标签页改过同一泊位时
   * 抛出 ConflictError，由调用方提示刷新，避免旧数据覆盖新数据。
   */
  async function registerCall(draft: CallDraft, vesselName: string, portId: string): Promise<PortCall> {
    const call: PortCall = {
      id: uid('c'),
      vesselId: draft.vesselId,
      vesselName,
      type: draft.type,
      time: draft.time ? new Date(draft.time).toISOString() : new Date().toISOString(),
      berthNo: draft.berthNo,
      iceKg: Number(draft.iceKg) || 0,
      fuelL: Number(draft.fuelL) || 0,
      unloadKg: Number(draft.unloadKg) || 0,
      visaStatus: draft.visaStatus,
      createdAt: new Date().toISOString(),
      version: 1,
    };
    const berthId = `${portId}-${draft.berthNo}`;
    let nextBerth: Berth | null = null;
    await db.transaction('rw', [db.calls, db.berths], async () => {
      await db.calls.put(toPlain(call));
      const current = await db.berths.get(berthId);
      if (current) {
        const expected = berths.value.find((b) => b.id === berthId)?.version;
        if (expected !== undefined && current.version !== expected) {
          throw new ConflictError(
            `泊位 ${current.berthNo} 已被其他标签页修改（本地版本 ${expected} ≠ 最新版本 ${current.version}），请刷新后重试`,
          );
        }
        const merged: Berth =
          draft.type === '进港'
            ? {
                ...current,
                status: '占用',
                vesselId: draft.vesselId,
                vesselName,
                berthAt: call.time,
                leaveAt: null,
              }
            : {
                ...current,
                status: '空闲',
                vesselId: null,
                vesselName: null,
                berthAt: null,
                leaveAt: call.time,
              };
        merged.version = current.version + 1;
        await db.berths.put(toPlain(merged));
        nextBerth = merged;
      }
    });
    calls.value = [...calls.value, call];
    if (nextBerth) {
      berths.value = berths.value.map((b) => (b.id === berthId && nextBerth ? nextBerth : b));
    }
    broadcastDataChanged();
    return call;
  }

  /**
   * 应用一条台账靠泊记录：生成进港（+ 离泊时间存在时的出港）流水，
   * 仅当靠泊时段覆盖当前时刻才回写泊位占用（历史台账只补流水，不动当前泊位）。
   * 泊位写库走乐观锁，避免多标签页互相覆盖。
   */
  async function applyLedgerDocking(
    row: LedgerRow,
    vesselId: string,
    vesselName: string,
    portId: string,
  ): Promise<void> {
    const inCall: PortCall = {
      id: uid('c'),
      vesselId,
      vesselName,
      type: '进港',
      time: row.berthAt,
      berthNo: row.berthNo,
      iceKg: row.iceKg,
      fuelL: row.fuelL,
      unloadKg: row.unloadKg,
      visaStatus: row.visaStatus,
      createdAt: new Date().toISOString(),
      version: 1,
    };
    const outCall: PortCall | null = row.leaveAt
      ? {
          ...inCall,
          id: uid('c'),
          type: '出港',
          time: row.leaveAt,
          iceKg: 0,
          fuelL: 0,
          unloadKg: 0,
        }
      : null;

    const now = Date.now();
    const berthAt = new Date(row.berthAt).getTime();
    const leaveAt = row.leaveAt ? new Date(row.leaveAt).getTime() : null;
    const isCurrent = berthAt <= now && (leaveAt === null || leaveAt > now);

    const berthId = `${portId}-${row.berthNo}`;
    let nextBerth: Berth | null = null;
    await db.transaction('rw', [db.calls, db.berths], async () => {
      await db.calls.put(toPlain(inCall));
      if (outCall) await db.calls.put(toPlain(outCall));
      if (isCurrent) {
        const current = await db.berths.get(berthId);
        if (current) {
          const expected = berths.value.find((b) => b.id === berthId)?.version;
          if (expected !== undefined && current.version !== expected) {
            throw new ConflictError(
              `泊位 ${current.berthNo} 已被其他标签页修改（本地版本 ${expected} ≠ 最新版本 ${current.version}），请刷新后重试`,
            );
          }
          const merged: Berth = {
            ...current,
            status: '占用',
            vesselId: inCall.vesselId,
            vesselName,
            berthAt: row.berthAt,
            leaveAt: null,
          };
          merged.version = current.version + 1;
          await db.berths.put(toPlain(merged));
          nextBerth = merged;
        }
      }
    });
    calls.value = [...calls.value, inCall, ...(outCall ? [outCall] : [])];
    if (nextBerth) {
      berths.value = berths.value.map((b) => (b.id === berthId && nextBerth ? nextBerth : b));
    }
    broadcastDataChanged();
  }

  return {
    ports,
    berths,
    calls,
    loading,
    filter,
    filteredPorts,
    callsSorted,
    portById,
    berthsOf,
    callsOfVessel,
    resetFilter,
    loadAll,
    createPort,
    addBerth,
    setBerthStatus,
    updatePort,
    registerCall,
    applyLedgerDocking,
  };
});
