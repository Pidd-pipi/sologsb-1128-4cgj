import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import {
  diffAgainstCall,
  isSameDockingSlot,
  ledgerKey,
  parseLedgerCsv,
} from '../utils/ledger';
import type { LedgerCounts, LedgerRow } from '../types/ledger';
import type { Todo, TodoKind } from '../types/todo';
import { usePortStore } from './portStore';
import { useVesselStore } from './vesselStore';
import { useTodoStore } from './todoStore';
import { broadcastDataChanged } from '../utils/sync';
import { ConflictError } from '../utils/conflict';

function makeTodo(
  kind: TodoKind,
  row: LedgerRow,
  title: string,
  detail: string,
): Todo {
  return {
    id: uid('todo'),
    kind,
    status: 'open',
    title,
    detail,
    vesselNo: row.vesselNo,
    portName: row.portName,
    berthNo: row.berthNo,
    batchId: row.batchId,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}

/**
 * 台账对账：把港调室停靠台账与本地渔港 / 渔船档案跨系统配对。
 * - 按 渔船编号 + 渔港 + 泊位时段 配对
 * - 重复导入只留一条；字段不同先列差异并保留原记录
 * - 应用前检查容量与时段冲突，容量不足拒绝并留下待办
 */
export const useLedgerStore = defineStore('ledger', () => {
  const rows = ref<LedgerRow[]>([]);
  const batchId = ref('');
  const analyzing = ref(false);
  const applying = ref(false);

  const counts = computed<LedgerCounts>(() => ({
    total: rows.value.length,
    pending: rows.value.filter((r) => r.status === 'pending').length,
    applied: rows.value.filter((r) => r.status === 'applied').length,
    duplicate: rows.value.filter((r) => r.status === 'duplicate').length,
    conflict: rows.value.filter((r) => r.status === 'conflict').length,
    rejected: rows.value.filter((r) => r.status === 'rejected').length,
  }));

  const hasPending = computed(() => counts.value.pending > 0);

  async function loadAll(): Promise<void> {
    rows.value = await db.ledger_rows.orderBy('importedAt').toArray();
  }

  /** 解析 CSV 文本为台账行（不写库） */
  function parseCsv(text: string): LedgerRow[] {
    return parseLedgerCsv(text);
  }

  /**
   * 对账：逐行配对并分类，持久化台账行与待办。
   * 分类：duplicate（重复）/ conflict（字段不一致，保留原记录）/ rejected（拒绝+待办）/ pending（可应用）
   */
  async function analyze(parsed: LedgerRow[]): Promise<LedgerRow[]> {
    analyzing.value = true;
    try {
      const portStore = usePortStore();
      const vesselStore = useVesselStore();
      const todoStore = useTodoStore();
      if (!portStore.ports.length) await portStore.loadAll();
      if (!vesselStore.vessels.length) await vesselStore.loadAll();

      const prior = await db.ledger_rows.toArray();
      // 已应用或已在队列中的台账不再重复处理；被拒绝 / 冲突的允许重新评估
      const handledKeys = new Set(
        prior
          .filter((r) => r.status === 'applied' || r.status === 'pending')
          .map(ledgerKey),
      );
      const batch = uid('batch');
      const todos: Todo[] = [];
      const seenKeys = new Set<string>();
      // 已打开的待办按 船 + 港 + 泊位 + 类型 去重，避免重复导入刷出多条相同待办
      const existingTodos = await db.todos.filter((t) => t.status === 'open').toArray();
      const todoKeys = new Set(
        existingTodos.map((t) => `${t.vesselNo}|${t.portName}|${t.berthNo}|${t.kind}`),
      );

      function pushTodo(kind: TodoKind, row: LedgerRow, title: string, detail: string): void {
        const key = `${row.vesselNo}|${row.portName}|${row.berthNo}|${kind}`;
        if (todoKeys.has(key)) return; // 已有相同待办，不重复生成
        todoKeys.add(key);
        todos.push(makeTodo(kind, row, title, detail));
      }

      const analyzed: LedgerRow[] = parsed.map((row) => {
        row.batchId = batch;
        const key = ledgerKey(row);

        // 历史批次已应用或已在队列中 → 重复导入，仅留一条
        if (handledKeys.has(key)) {
          return {
            ...row,
            status: 'duplicate',
            message: '重复导入：该台账此前已处理，仅保留一条',
            refCallId: null,
            diffs: [],
          };
        }
        // 同一批次内完全重复 → 仅留一条
        if (seenKeys.has(key)) {
          return {
            ...row,
            status: 'duplicate',
            message: '批次内重复：与本批次另一条台账相同，仅保留一条',
            refCallId: null,
            diffs: [],
          };
        }
        seenKeys.add(key);

        const vessel = vesselStore.vessels.find(
          (v) => v.vesselNo.trim().toUpperCase() === row.vesselNo.trim().toUpperCase(),
        );
        if (!vessel) {
          pushTodo(
            'unmatched',
            row,
            '渔船档案不存在',
            `渔船编号 ${row.vesselNo} 在本地渔船档案中不存在，无法配对，请先建档或核对编号。`,
          );
          return {
            ...row,
            status: 'rejected',
            message: '渔船编号不存在，无法与本地档案配对',
            refCallId: null,
            diffs: [],
          };
        }

        const port = portStore.ports.find((p) => p.name === row.portName.trim());
        if (!port) {
          pushTodo(
            'unmatched',
            row,
            '渔港不存在',
            `渔港「${row.portName}」在本地渔港档案中不存在，无法靠泊。`,
          );
          return {
            ...row,
            status: 'rejected',
            message: '渔港不存在，无法配对',
            refCallId: null,
            diffs: [],
          };
        }

        const berth = portStore.berths.find(
          (b) => b.portId === port.id && b.berthNo === row.berthNo,
        );
        if (!berth) {
          pushTodo(
            'unmatched',
            row,
            '泊位不存在',
            `${port.name} 没有泊位 ${row.berthNo}，请核对泊位号或新增泊位。`,
          );
          return {
            ...row,
            status: 'rejected',
            message: `泊位 ${row.berthNo} 不存在`,
            refCallId: null,
            diffs: [],
          };
        }

        // 同船 + 同泊位 + 同一天 的进港记录 → 配对命中
        const match = portStore.calls.find(
          (c) => c.vesselId === vessel.id && isSameDockingSlot(row, c),
        );
        if (match) {
          const diffs = diffAgainstCall(row, match);
          if (diffs.length === 0) {
            return {
              ...row,
              status: 'duplicate',
              message: '与本地进出港记录一致，重复导入仅保留一条',
              refCallId: match.id,
              diffs: [],
            };
          }
          return {
            ...row,
            status: 'conflict',
            message: `字段不一致（${diffs.map((d) => d.field).join('、')}），已保留原记录`,
            refCallId: match.id,
            diffs,
          };
        }

        // 新记录：应用前检查容量与时段冲突
        const now = Date.now();
        const berthAt = new Date(row.berthAt).getTime();
        const leaveAt = row.leaveAt ? new Date(row.leaveAt).getTime() : null;
        const isCurrent = berthAt <= now && (leaveAt === null || leaveAt > now);

        if (isCurrent) {
          if (berth.status === '占用' && berth.vesselId !== vessel.id) {
            pushTodo(
              'capacity',
              row,
              '泊位容量不足',
              `${port.name} ${row.berthNo} 已被占用，${vessel.name} 靠泊被拒，请协调泊位或等待空出。`,
            );
            return {
              ...row,
              status: 'rejected',
              message: `容量不足：${row.berthNo} 已被 ${berth.vesselName ?? '其他船舶'} 占用`,
              refCallId: null,
              diffs: [],
            };
          }
          if (berth.status === '维修') {
            pushTodo(
              'capacity',
              row,
              '泊位维修中',
              `${port.name} ${row.berthNo} 正在维修，无法靠泊，请改泊其他泊位。`,
            );
            return {
              ...row,
              status: 'rejected',
              message: '泊位维修中，无法靠泊',
              refCallId: null,
              diffs: [],
            };
          }
          const vesselBusy = portStore.berths.some(
            (b) => b.vesselId === vessel.id && b.status === '占用',
          );
          if (vesselBusy) {
            pushTodo(
              'conflict',
              row,
              '船舶时段冲突',
              `${vessel.name} 仍在港未离泊，存在时段冲突，重复靠泊被拒。`,
            );
            return {
              ...row,
              status: 'rejected',
              message: '该渔船仍在港，存在时段冲突',
              refCallId: null,
              diffs: [],
            };
          }
        }

        return {
          ...row,
          status: 'pending',
          message: '容量与时段检查通过，可应用',
          refCallId: null,
          diffs: [],
        };
      });

      await db.ledger_rows.bulkPut(toPlain(analyzed));
      if (todos.length) await db.todos.bulkPut(toPlain(todos));
      rows.value = analyzed;
      batchId.value = batch;
      await todoStore.loadAll();
      broadcastDataChanged();
      return analyzed;
    } finally {
      analyzing.value = false;
    }
  }

  /** 应用所有检查通过（pending）的台账行，生成进出港流水并同步泊位 */
  async function applyPending(): Promise<{ applied: number; failed: number }> {
    applying.value = true;
    let applied = 0;
    let failed = 0;
    try {
      const portStore = usePortStore();
      const vesselStore = useVesselStore();
      if (!portStore.ports.length) await portStore.loadAll();
      if (!vesselStore.vessels.length) await vesselStore.loadAll();

      const targets = rows.value.filter((r) => r.status === 'pending');
      for (const row of targets) {
        try {
          const vessel = vesselStore.vessels.find(
            (v) => v.vesselNo.trim().toUpperCase() === row.vesselNo.trim().toUpperCase(),
          );
          const port = portStore.ports.find((p) => p.name === row.portName.trim());
          if (!vessel || !port) {
            failed += 1;
            continue;
          }
          await portStore.applyLedgerDocking(row, vessel.id, vessel.name, port.id);
          row.status = 'applied';
          row.message = '已应用为进出港登记';
          applied += 1;
        } catch (error) {
          if (error instanceof ConflictError) {
            // 乐观锁冲突：泊位被其他标签页改过，保留待人工处理
            row.message = `冲突未覆盖：${error.message}`;
          } else {
            row.message = `应用失败：${(error as Error).message}`;
          }
          row.status = 'rejected';
          failed += 1;
        }
      }
      if (targets.length) {
        await db.ledger_rows.bulkPut(toPlain(targets));
        rows.value = [...rows.value];
        broadcastDataChanged();
      }
      return { applied, failed };
    } finally {
      applying.value = false;
    }
  }

  return {
    rows,
    batchId,
    analyzing,
    applying,
    counts,
    hasPending,
    loadAll,
    parseCsv,
    analyze,
    applyPending,
  };
});
