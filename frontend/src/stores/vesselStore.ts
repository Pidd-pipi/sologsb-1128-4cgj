import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import { emptyVesselQuery, type FishingVessel, type VesselQuery } from '../types/vessel';

export interface VesselInput {
  name: string;
  vesselNo: string;
  homePort: string;
  length: number;
  beam: number;
  grossTonnage: number;
  enginePower: number;
  operationType: FishingVessel['operationType'];
  hullMaterial: FishingVessel['hullMaterial'];
  owner: string;
  certificateExpiry: string;
}

export const useVesselStore = defineStore('vessel', () => {
  const vessels = ref<FishingVessel[]>([]);
  const loading = ref(false);
  const query = ref<VesselQuery>(emptyVesselQuery());

  /** 组合查询：作业类型 + 主机功率区间 + 总吨位区间 + 船籍港 */
  const results = computed(() => {
    const q = query.value;
    const homePort = q.homePort.trim();
    return vessels.value.filter((v) => {
      if (q.operationType && v.operationType !== q.operationType) return false;
      if (q.powerMin !== null && v.enginePower < q.powerMin) return false;
      if (q.powerMax !== null && v.enginePower > q.powerMax) return false;
      if (q.tonnageMin !== null && v.grossTonnage < q.tonnageMin) return false;
      if (q.tonnageMax !== null && v.grossTonnage > q.tonnageMax) return false;
      if (homePort && !v.homePort.includes(homePort)) return false;
      return true;
    });
  });

  const homePorts = computed(() => Array.from(new Set(vessels.value.map((v) => v.homePort))).sort());

  function vesselById(id: string): FishingVessel | undefined {
    return vessels.value.find((v) => v.id === id);
  }

  function vesselByName(name: string): FishingVessel | undefined {
    return vessels.value.find((v) => v.name === name);
  }

  function resetQuery(): void {
    query.value = emptyVesselQuery();
  }

  async function loadAll(): Promise<void> {
    loading.value = true;
    try {
      vessels.value = await db.vessels.toArray();
    } finally {
      loading.value = false;
    }
  }

  async function createVessel(input: VesselInput): Promise<FishingVessel> {
    const vessel: FishingVessel = {
      id: uid('v'),
      name: input.name.trim(),
      vesselNo: input.vesselNo.trim().toUpperCase(),
      homePort: input.homePort.trim(),
      length: Number(input.length),
      beam: Number(input.beam),
      grossTonnage: Number(input.grossTonnage),
      enginePower: Number(input.enginePower),
      operationType: input.operationType,
      hullMaterial: input.hullMaterial,
      owner: input.owner.trim(),
      certificateExpiry: input.certificateExpiry,
      createdAt: new Date().toISOString(),
    };
    // 写库前脱代理，避免 DataCloneError
    await db.vessels.put(toPlain(vessel));
    vessels.value = [...vessels.value, vessel];
    return vessel;
  }

  async function updateVessel(id: string, patch: Partial<FishingVessel>): Promise<void> {
    const hit = vesselById(id);
    if (!hit) return;
    const next: FishingVessel = { ...hit, ...patch };
    await db.vessels.put(toPlain(next));
    vessels.value = vessels.value.map((v) => (v.id === id ? next : v));
  }

  return {
    vessels,
    loading,
    query,
    results,
    homePorts,
    vesselById,
    vesselByName,
    resetQuery,
    loadAll,
    createVessel,
    updateVessel,
  };
});
