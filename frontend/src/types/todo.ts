/**
 * 待办事项：台账应用前预检不通过（容量不足 / 时段冲突 / 配对失败等）时落库，
 * 供港调室后续人工处理。
 */

/** 待办类型 */
export type TodoType =
  | '容量不足'
  | '时段冲突'
  | '渔船未建档'
  | '泊位缺失'
  | '登记冲突'
  | '其他';

export const TODO_TYPES: TodoType[] = [
  '容量不足',
  '时段冲突',
  '渔船未建档',
  '泊位缺失',
  '登记冲突',
  '其他',
];

/** 待办状态 */
export type TodoStatus = '待处理' | '处理中' | '已完成' | '已忽略';

export const TODO_STATUSES: TodoStatus[] = ['待处理', '处理中', '已完成', '已忽略'];

export interface ReconcileTodo {
  id: string;
  type: TodoType;
  status: TodoStatus;
  /** 简述 */
  title: string;
  /** 拒绝原因明细 */
  reason: string;
  /** 关联渔港 id / 名称 */
  portId?: string;
  portName?: string;
  /** 关联渔船编号 / 船名 */
  vesselNo?: string;
  vesselName?: string;
  /** 关联泊位号 */
  berthNo?: string;
  /** 计划靠泊 / 离泊时间 */
  startTime?: string | null;
  endTime?: string | null;
  /** 来源批次 id */
  batchId?: string;
  /** 原始台账行（JSON 字符串，便于补建档案后重试） */
  rawRow?: string;
  createdAt: string;
  resolvedAt?: string | null;
}
