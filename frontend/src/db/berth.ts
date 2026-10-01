import type { FishingPort } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

export interface SeedOccupancy {
  berthNo: string;
  vesselId: string;
  vesselName: string;
  status: BerthStatus;
  berthAt: string;
}

/** 演示数据中的初始占用 / 维修泊位 */
export const SEED_OCCUPANCY: Record<string, SeedOccupancy[]> = {
  'p-1001': [
    { berthNo: 'B01', vesselId: 'v-2001', vesselName: '浙象渔05123', status: '占用', berthAt: hoursAgo(5) },
    { berthNo: 'B02', vesselId: 'v-2005', vesselName: '浙象渔05288', status: '占用', berthAt: hoursAgo(3) },
    { berthNo: 'B04', vesselId: '', vesselName: '', status: '维修', berthAt: '' },
  ],
  'p-1002': [
    { berthNo: 'B01', vesselId: 'v-2002', vesselName: '浙普渔13208', status: '占用', berthAt: hoursAgo(2) },
    { berthNo: 'B02', vesselId: 'v-2006', vesselName: '浙普渔13566', status: '占用', berthAt: hoursAgo(26) },
    { berthNo: 'B06', vesselId: '', vesselName: '', status: '维修', berthAt: '' },
  ],
  'p-1003': [
    { berthNo: 'B01', vesselId: 'v-2003', vesselName: '浙岱渔07156', status: '占用', berthAt: hoursAgo(1) },
  ],
  'p-1004': [],
};

/**
 * 按渔港登记的泊位数生成泊位记录（初始播种与 Dexie v3 迁移共用）。
 */
export function buildBerthRecords(
  port: FishingPort,
  occupancy: SeedOccupancy[] = SEED_OCCUPANCY[port.id] ?? [],
): Berth[] {
  const records: Berth[] = [];
  for (let i = 1; i <= port.berthCount; i++) {
    const berthNo = `B${pad2(i)}`;
    const hit = occupancy.find((o) => o.berthNo === berthNo);
    const occupied = hit && hit.status === '占用';
    records.push({
      id: `${port.id}-${berthNo}`,
      portId: port.id,
      berthNo,
      vesselId: occupied ? hit.vesselId : null,
      vesselName: occupied ? hit.vesselName : null,
      berthAt: occupied ? hit.berthAt : null,
      leaveAt: null,
      status: hit ? hit.status : '空闲',
      designDepth: port.berthDepth,
      version: 1,
    });
  }
  return records;
}
