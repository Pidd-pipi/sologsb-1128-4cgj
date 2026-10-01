import Dexie, { type Table } from 'dexie';
import type { FishingPort } from '../types/port';
import type { FishingVessel } from '../types/vessel';
import type { PortCall } from '../types/call';
import type { Berth } from '../types/berth';
import type { ReconcileTodo } from '../types/todo';
import { buildBerthRecords } from './berth';

/**
 * gbfishport-db：库名固定为 gbfishport-db
 * v1 建 ports / vessels；v2 新增 calls 表与 vesselId 索引；v3 新增 berths 表并按泊位数生成初始记录；
 * v4 新增 todos 表，calls 增加 portId / [portId+berthNo] / batchId 索引（台账对账），
 * berths 增加 version 乐观锁字段，并回填历史记录。
 */
export class FishPortDatabase extends Dexie {
  ports!: Table<FishingPort, string>;
  vessels!: Table<FishingVessel, string>;
  calls!: Table<PortCall, string>;
  berths!: Table<Berth, string>;
  todos!: Table<ReconcileTodo, string>;

  constructor() {
    super('gbfishport-db');

    this.version(1).stores({
      ports: 'id, name, level, shelterLevel',
      vessels: 'id, vesselNo, homePort, operationType, enginePower, grossTonnage',
    });

    this.version(2)
      .stores({
        calls: 'id, vesselId, type, time',
      })
      .upgrade(async (tx) => {
        // v2 迁移：新增 calls 表与 vesselId 索引，回填历史记录的冗余字段
        await tx
          .table<PortCall, string>('calls')
          .toCollection()
          .modify((call) => {
            if (!call.vesselName) call.vesselName = '';
            if (!call.visaStatus) call.visaStatus = '待签证';
          });
      });

    this.version(3)
      .stores({
        berths: 'id, portId, berthNo, status, vesselId',
      })
      .upgrade(async (tx) => {
        // v3 迁移：新增 berths 表，并按每个渔港登记的泊位数生成初始泊位记录
        const ports = await tx.table<FishingPort, string>('ports').toArray();
        const berthTable = tx.table<Berth, string>('berths');
        for (const port of ports) {
          const existing = await berthTable.where('portId').equals(port.id).count();
          if (existing === 0) {
            await berthTable.bulkPut(buildBerthRecords(port));
          }
        }
      });

    this.version(4)
      .stores({
        calls: 'id, vesselId, type, time, portId, [portId+berthNo], batchId',
        berths: 'id, portId, berthNo, status, vesselId, version',
        todos: 'id, type, status, portId, batchId, createdAt',
      })
      .upgrade(async (tx) => {
        // v4 迁移：泊位补乐观锁版本；流水补渔船编号与渔港归属；新增待办表
        const vessels = await tx.table<FishingVessel, string>('vessels').toArray();
        const vesselsById = new Map(vessels.map((v) => [v.id, v]));
        const berths = await tx.table<Berth, string>('berths').toArray();

        await tx
          .table<Berth, string>('berths')
          .toCollection()
          .modify((berth) => {
            if (typeof berth.version !== 'number') berth.version = 0;
          });

        await tx
          .table<PortCall, string>('calls')
          .toCollection()
          .modify((call) => {
            const vessel = vesselsById.get(call.vesselId);
            if (vessel && !call.vesselNo) call.vesselNo = vessel.vesselNo;
            if (!call.source) call.source = '手工';
            if (call.portId) return;
            // 历史流水没有渔港字段：同泊位号唯一则直接归属；多港同号时优先匹配占用该泊位的渔船
            const candidates = berths.filter((b) => b.berthNo === call.berthNo);
            const matched =
              candidates.find((b) => b.vesselId === call.vesselId && b.status === '占用') ??
              (candidates.length === 1 ? candidates[0] : undefined);
            if (matched) call.portId = matched.portId;
          });
      });
  }
}

export const db = new FishPortDatabase();
