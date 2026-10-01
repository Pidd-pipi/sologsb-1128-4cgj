import type { VisaStatus } from './call';

/** 台账行对账结果状态 */
export type LedgerRowStatus =
  | 'pending' // 检查通过，可应用
  | 'applied' // 已应用进出港登记
  | 'duplicate' // 重复导入，仅保留一条
  | 'conflict' // 字段不一致，保留原记录
  | 'rejected'; // 容量 / 时段冲突 / 档案不匹配，拒绝并留下待办

/** 字段差异（台账值 vs 系统原值） */
export interface FieldDiff {
  field: string;
  ledger: string;
  system: string;
}

/** 港调室停靠台账行（跨系统对账的外部记录） */
export interface LedgerRow {
  id: string;
  /** 导入批次号 */
  batchId: string;
  /** 渔船编号（跨系统配对主键） */
  vesselNo: string;
  /** 船名（仅展示） */
  vesselName: string;
  /** 渔港名称 */
  portName: string;
  /** 泊位号 */
  berthNo: string;
  /** 靠泊时间（ISO 字符串） */
  berthAt: string;
  /** 离泊时间（ISO 字符串），空表示仍在港 */
  leaveAt: string | null;
  /** 加冰 kg */
  iceKg: number;
  /** 加油 L */
  fuelL: number;
  /** 卸货 kg */
  unloadKg: number;
  /** 签证状态 */
  visaStatus: VisaStatus;
  status: LedgerRowStatus;
  /** 对账说明 / 拒绝原因 */
  message: string;
  /** 冲突 / 重复时指向的本地进出港记录 id */
  refCallId: string | null;
  /** 字段差异（status=conflict 时有值） */
  diffs: FieldDiff[];
  importedAt: string;
}

/** 台账对账统计 */
export interface LedgerCounts {
  total: number;
  pending: number;
  applied: number;
  duplicate: number;
  conflict: number;
  rejected: number;
}
