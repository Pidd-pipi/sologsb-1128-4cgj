import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import { emptyPortFilter, type FishingPort, type PortFilter, type SupplyCapability } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';
import type { CallDraft, PortCall } from '../types/call';
import { buildBerthRecords } from '../db/berth';
import { BerthConflictError, changeBerthStatus } from '../services/berthService';
import { syncBus } from '../services/syncBus';

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

  function callsOfPort(portId: string): PortCall[] {
    return callsSorted.value.filter((c) => c.portId === portId);
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
    syncBus.post('data-changed');
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
      version: 0,
    };
    await db.berths.put(toPlain(berth));
    berths.value = [...berths.value, berth];
    const nextCount = berthsOf(portId).length;
    await updatePort(portId, { berthCount: nextCount });
    syncBus.post('data-changed', { berthId: berth.id });
    return berth;
  }

  /** 详情页手工置为维修 / 释放空闲：版本乐观锁，防多标签页互相覆盖 */
  async function setBerthStatus(berthId: string, status: BerthStatus): Promise<Berth> {
    const saved = await changeBerthStatus(berthId, status);
    berths.value = berths.value.map((b) => (b.id === berthId ? saved : b));
    return saved;
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
   * 泊位校验 + 条件写入 + 流水写入在同一事务内完成：
   * 目标泊位已被其他船占用 / 维修 / 被其他标签页改动时抛 BerthConflictError，整体回滚。
   */
  async function registerCall(
    draft: CallDraft,
    vesselName: string,
    portId: string,
    vesselNo = '',
  ): Promise<PortCall> {
    const time = draft.time ? new Date(draft.time).toISOString() : new Date().toISOString();
    const call: PortCall = {
      id: uid('c'),
      vesselId: draft.vesselId,
      vesselName,
      vesselNo,
      portId,
      type: draft.type,
      time,
      endTime: null,
      berthNo: draft.berthNo,
      iceKg: Number(draft.iceKg) || 0,
      fuelL: Number(draft.fuelL) || 0,
      unloadKg: Number(draft.unloadKg) || 0,
      visaStatus: draft.visaStatus,
      source: '手工',
      createdAt: new Date().toISOString(),
    };

    const berthId = `${portId}-${draft.berthNo}`;
    let savedBerth: Berth | null = null;

    await db.transaction('rw', db.calls, db.berths, async () => {
      const expected = await db.berths.get(berthId);
      if (!expected) throw new BerthConflictError(berthId, `泊位 ${draft.berthNo} 不存在`);
      const expectedVersion = expected.version ?? 0;

      let next: Berth;
      if (draft.type === '进港') {
        if (expected.status === '维修') {
          throw new BerthConflictError(berthId, `泊位 ${draft.berthNo} 正在维修，不能停靠`);
        }
        if (expected.status === '占用' && expected.vesselId && expected.vesselId !== draft.vesselId) {
          throw new BerthConflictError(
            berthId,
            `泊位 ${draft.berthNo} 已被 ${expected.vesselName ?? '其他船舶'} 占用，无法重复停靠`,
          );
        }
        next =
          expected.status === '占用' && expected.vesselId === draft.vesselId
            ? { ...expected, version: expectedVersion }
            : {
                ...expected,
                status: '占用' as const,
                vesselId: draft.vesselId,
                vesselName,
                berthAt: time,
                leaveAt: null,
                version: expectedVersion,
              };
      } else {
        if (expected.status !== '占用' || !expected.vesselId) {
          throw new BerthConflictError(berthId, `泊位 ${draft.berthNo} 当前不是占用状态，无需出港`);
        }
        if (expected.vesselId !== draft.vesselId) {
          throw new BerthConflictError(
            berthId,
            `泊位 ${draft.berthNo} 由 ${expected.vesselName ?? '其他船舶'} 占用，不能登记其他船出港`,
          );
        }
        next = {
          ...expected,
          status: '空闲' as const,
          vesselId: null,
          vesselName: null,
          berthAt: null,
          leaveAt: time,
          version: expectedVersion,
        };
      }

      savedBerth = { ...next, version: expectedVersion + 1 };
      await db.berths.put(toPlain(savedBerth));
      await db.calls.put(toPlain(call));
    });

    syncBus.post('data-changed', { berthId });
    calls.value = [...calls.value, call];
    if (savedBerth) {
      berths.value = berths.value.map((b) => (b.id === savedBerth!.id ? savedBerth! : b));
    }
    return call;
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
    callsOfPort,
    callsOfVessel,
    resetFilter,
    loadAll,
    createPort,
    addBerth,
    setBerthStatus,
    updatePort,
    registerCall,
  };
});
