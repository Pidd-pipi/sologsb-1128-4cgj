import type { FishingPort } from '../types/port';
import type { FishingVessel } from '../types/vessel';
import type { PortCall, VisaStatus } from '../types/call';
import {
  parseFlexibleDateTime,
  parseFlexibleNumber,
  normalizeVisaStatus,
  pickField,
  type RawLedgerRow,
} from '../utils/csv';
import { formatDateTime, formatNumber } from '../utils/format';

/** 归一化后的台账行 */
export interface LedgerEntry {
  /** 源文件中的行号（含表头） */
  rowNumber: number;
  /** 原始字段（保留原文，用于待办重试） */
  raw: Record<string, string>;
  vesselNo: string;
  vesselName: string;
  portName: string;
  berthNo: string;
  /** 靠泊时间 ISO（解析失败为 null） */
  startTime: string | null;
  /** 离泊时间 ISO，可空 */
  endTime: string | null;
  iceKg: number;
  fuelL: number;
  unloadKg: number;
  visaStatus: VisaStatus;
  /** 行级数据问题 */
  issues: string[];
}

export type ReviewStatus = '新记录' | '重复' | '字段差异' | '渔船未建档' | '渔港未建档';

export interface FieldDiff {
  field: string;
  label: string;
  old: string;
  next: string;
}

/** 预检问题（应用前检查） */
export interface PrecheckProblem {
  type: '容量不足' | '时段冲突' | '泊位缺失';
  message: string;
}

/** 对账结果中的一行 */
export interface ReviewItem {
  /** 列表 key：源行号 */
  key: number;
  entry: LedgerEntry;
  status: ReviewStatus;
  vesselId: string;
  portId: string;
  /** 重复 / 字段差异时匹配到的在库记录 */
  matchedCallId: string;
  diffs: FieldDiff[];
  /** 是否勾选应用（字段差异默认保留原记录=false；新记录默认=true） */
  selected: boolean;
  precheck: PrecheckProblem | null;
}

export interface ReconcileSummary {
  total: number;
  added: number;
  duplicated: number;
  conflicted: number;
  vesselMissing: number;
  portMissing: number;
  invalid: number;
}

/** 时间重复判定窗口：差值不超过 2 分钟视为同一停靠时段 */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

function normalizeNo(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, '');
}

function normalizePortName(value: string): string {
  return value.trim();
}

/** 原始行 → 标准台账条目 */
export function normalizeEntry(row: RawLedgerRow): LedgerEntry {
  const fields = row.fields;
  const vesselNo = pickField(fields, 'vesselNo').trim().toUpperCase();
  const vesselName = pickField(fields, 'vesselName').trim();
  const portName = normalizePortName(pickField(fields, 'portName'));
  const berthNo = pickField(fields, 'berthNo').trim().toUpperCase();
  const startTimeRaw = pickField(fields, 'startTime');
  const endTimeRaw = pickField(fields, 'endTime');
  const startTime = parseFlexibleDateTime(startTimeRaw);
  const endTime = parseFlexibleDateTime(endTimeRaw);

  const issues: string[] = [];
  if (!vesselNo) issues.push('缺少渔船编号');
  if (!portName) issues.push('缺少渔港名称');
  if (!berthNo) issues.push('缺少泊位号');
  if (startTimeRaw && !startTime) issues.push(`靠泊时间无法识别：${startTimeRaw}`);
  if (!startTime) issues.push('缺少有效靠泊时间');
  if (endTimeRaw && !endTime) issues.push(`离泊时间无法识别：${endTimeRaw}`);
  if (startTime && endTime && new Date(endTime).getTime() <= new Date(startTime).getTime()) {
    issues.push('离泊时间早于或等于靠泊时间');
  }

  return {
    rowNumber: row.rowNumber,
    raw: fields,
    vesselNo,
    vesselName,
    portName,
    berthNo,
    startTime,
    endTime,
    iceKg: parseFlexibleNumber(pickField(fields, 'iceKg')),
    fuelL: parseFlexibleNumber(pickField(fields, 'fuelL')),
    unloadKg: parseFlexibleNumber(pickField(fields, 'unloadKg')),
    visaStatus: normalizeVisaStatus(pickField(fields, 'visaStatus')),
    issues,
  };
}

function findVessel(entry: LedgerEntry, vessels: FishingVessel[]): FishingVessel | undefined {
  return vessels.find((v) => normalizeNo(v.vesselNo) === normalizeNo(entry.vesselNo));
}

function findPort(entry: LedgerEntry, ports: FishingPort[]): FishingPort | undefined {
  const name = entry.portName;
  return (
    ports.find((p) => p.name === name) ??
    ports.find((p) => p.name.includes(name) || name.includes(p.name))
  );
}

function displayValue(field: string, call: PortCall): string {
  switch (field) {
    case 'time':
      return formatDateTime(call.time);
    case 'endTime':
      return formatDateTime(call.endTime ?? '');
    case 'iceKg':
      return `${formatNumber(call.iceKg, 0)} kg`;
    case 'fuelL':
      return `${formatNumber(call.fuelL, 0)} L`;
    case 'unloadKg':
      return `${formatNumber(call.unloadKg, 0)} kg`;
    case 'visaStatus':
      return call.visaStatus;
    default:
      return '';
  }
}

const DIFF_LABELS: Record<string, string> = {
  time: '靠泊时间',
  endTime: '离泊时间',
  iceKg: '加冰量',
  fuelL: '加油量',
  unloadKg: '卸货量',
  visaStatus: '签证状态',
};

/** 找到同渔船编号 + 渔港 + 泊位、时间落在重复窗口内的在库进港记录 */
function findDuplicate(call: PortCall, existing: PortCall[]): PortCall | undefined {
  const t = new Date(call.time).getTime();
  return existing.find((c) => {
    if (c.type !== '进港' || c.vesselId !== call.vesselId || c.portId !== call.portId) return false;
    if (c.berthNo !== call.berthNo) return false;
    return Math.abs(new Date(c.time).getTime() - t) <= DUPLICATE_WINDOW_MS;
  });
}

/** 对比同一条停靠在字段上的差异（靠泊时间落在重复窗口内视为一致） */
function diffCalls(match: PortCall, call: PortCall): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of ['time', 'endTime', 'iceKg', 'fuelL', 'unloadKg', 'visaStatus'] as const) {
    if (field === 'time') {
      const delta = Math.abs(new Date(call.time).getTime() - new Date(match.time).getTime());
      if (delta > DUPLICATE_WINDOW_MS) {
        diffs.push({ field, label: DIFF_LABELS[field], old: displayValue(field, match), next: displayValue(field, call) });
      }
      continue;
    }
    const oldV = displayValue(field, match);
    const nextV = displayValue(field, call);
    // 双方都为空不算差异
    if ((field === 'endTime' && !match.endTime && !call.endTime) || oldV === nextV) continue;
    diffs.push({ field, label: DIFF_LABELS[field], old: oldV || '—', next: nextV || '—' });
  }
  return diffs;
}

/**
 * 跨系统对账：台账行与本机渔船档案（编号）、渔港档案（名称）配对，
 * 再与进出港登记按 渔船 + 渔港 + 泊位 + 时段 判重，分类为
 * 新记录 / 重复 / 字段差异 / 渔船未建档 / 渔港未建档。
 */
export function buildReview(
  rows: RawLedgerRow[],
  vessels: FishingVessel[],
  ports: FishingPort[],
  existingCalls: PortCall[],
): { items: ReviewItem[]; entries: LedgerEntry[] } {
  const entries = rows.map(normalizeEntry);
  const items: ReviewItem[] = [];

  for (const entry of entries) {
    const vessel = findVessel(entry, vessels);
    const port = entry.portName ? findPort(entry, ports) : undefined;

    if (!vessel) {
      items.push(makeItem(entry, '渔船未建档', '', port?.id ?? ''));
      continue;
    }
    if (entry.portName && !port) {
      items.push(makeItem(entry, '渔港未建档', vessel.id, ''));
      continue;
    }

    // 行数据本身不完整（缺时间/泊位等）也无法登记，归入渔港未建档同级提示，用 issues 承载
    const call: PortCall = {
      id: '',
      vesselId: vessel.id,
      vesselName: vessel.name,
      vesselNo: vessel.vesselNo,
      portId: port?.id,
      type: '进港',
      time: entry.startTime ?? '',
      endTime: entry.endTime,
      berthNo: entry.berthNo,
      iceKg: entry.iceKg,
      fuelL: entry.fuelL,
      unloadKg: entry.unloadKg,
      visaStatus: entry.visaStatus,
      source: '台账',
      createdAt: '',
    };

    const matched = entry.startTime ? findDuplicate(call, existingCalls) : undefined;
    if (matched) {
      const diffs = diffCalls(matched, call);
      items.push({
        key: entry.rowNumber,
        entry,
        status: diffs.length ? '字段差异' : '重复',
        vesselId: vessel.id,
        portId: port?.id ?? '',
        matchedCallId: matched.id,
        diffs,
        // 字段差异默认保留原记录（不采用台账值）；重复天然跳过
        selected: false,
        precheck: null,
      });
    } else {
      items.push(makeItem(entry, '新记录', vessel.id, port?.id ?? ''));
    }
  }

  return { items, entries };
}

function makeItem(entry: LedgerEntry, status: ReviewStatus, vesselId: string, portId: string): ReviewItem {
  return {
    key: entry.rowNumber,
    entry,
    status,
    vesselId,
    portId,
    matchedCallId: '',
    diffs: [],
    selected: status === '新记录',
    precheck: null,
  };
}

export function summarizeReview(items: ReviewItem[]): ReconcileSummary {
  return {
    total: items.length,
    added: items.filter((i) => i.status === '新记录').length,
    duplicated: items.filter((i) => i.status === '重复').length,
    conflicted: items.filter((i) => i.status === '字段差异').length,
    vesselMissing: items.filter((i) => i.status === '渔船未建档').length,
    portMissing: items.filter((i) => i.status === '渔港未建档').length,
    invalid: items.filter((i) => i.entry.issues.length > 0).length,
  };
}

export { findVessel, findPort };
