/** 待办类型：容量不足 / 时段冲突 / 档案不匹配 / 其他 */
export type TodoKind = 'capacity' | 'conflict' | 'unmatched' | 'info';

/** 待办状态 */
export type TodoStatus = 'open' | 'done' | 'dismissed';

/** 对账待办：容量不足或时段冲突被拒绝后留下，需人工跟进 */
export interface Todo {
  id: string;
  kind: TodoKind;
  status: TodoStatus;
  title: string;
  detail: string;
  vesselNo: string;
  portName: string;
  berthNo: string;
  /** 关联的台账批次号 */
  batchId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}
