import Dexie, { type Table } from 'dexie';
import type { FishingPort } from '../types/port';
import type { FishingVessel } from '../types/vessel';
import type { PortCall } from '../types/call';
import type { Berth } from '../types/berth';
import type { LedgerRow } from '../types/ledger';
import type { Todo } from '../types/todo';
import { buildBerthRecords } from './berth';

/**
 * gbfishport-db：库名固定为 gbfishport-db
 * v1 建 ports / vessels；v2 新增 calls 表与 vesselId 索引；v3 新增 berths 表并按泊位数生成初始记录；
 * v4 新增 ledger_rows / todos 表，并为既有 berths / calls 补乐观锁版本号。
 */
export class FishPortDatabase extends Dexie {
  ports!: Table<FishingPort, string>;
  vessels!: Table<FishingVessel, string>;
  calls!: Table<PortCall, string>;
  berths!: Table<Berth, string>;
  ledger_rows!: Table<LedgerRow, string>;
  todos!: Table<Todo, string>;

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
        ledger_rows: 'id, batchId, vesselNo, portName, berthNo, status, importedAt',
        todos: 'id, kind, status, createdAt',
      })
      .upgrade(async (tx) => {
        // v4 迁移：台账对账 + 待办；为既有泊位 / 进出港记录补乐观锁版本号（默认 1）
        await tx
          .table<Berth, string>('berths')
          .toCollection()
          .modify((berth) => {
            if (typeof berth.version !== 'number') berth.version = 1;
          });
        await tx
          .table<PortCall, string>('calls')
          .toCollection()
          .modify((call) => {
            if (typeof call.version !== 'number') call.version = 1;
          });
      });
  }
}

export const db = new FishPortDatabase();
