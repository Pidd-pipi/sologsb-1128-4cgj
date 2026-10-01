import type { VisaStatus } from '../types/call';
import type { FieldDiff, LedgerRow } from '../types/ledger';
import type { PortCall } from '../types/call';
import { isSameDay, uid } from './format';

/** 台账 CSV 表头（中文，与页面文案一致） */
export const LEDGER_HEADERS = [
  '渔船编号',
  '船名',
  '渔港名称',
  '泊位号',
  '靠泊时间',
  '离泊时间',
  '加冰kg',
  '加油L',
  '卸货kg',
  '签证状态',
] as const;

const VISA_VALUES: VisaStatus[] = ['已签证', '待签证', '免签'];

function num(raw: string): number {
  const n = Number(String(raw).replace(/[,，\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeVisa(raw: string): VisaStatus {
  const v = raw.trim();
  return (VISA_VALUES as string[]).includes(v) ? (v as VisaStatus) : '待签证';
}

/** 把 'YYYY-MM-DD HH:mm' / 'YYYY-MM-DDTHH:mm' / 'YYYY-MM-DD' 转成 ISO；无法解析返回 null */
function normalizeTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** 解析单行 CSV（支持双引号包裹与引号内逗号） */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** 解析台账 CSV 文本为台账行；无效行（缺主键或时间）跳过 */
export function parseLedgerCsv(text: string): LedgerRow[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const col = (...names: string[]): number => header.findIndex((h) => names.includes(h));
  const idx = {
    vesselNo: col('渔船编号', 'vesselNo', '船号'),
    vesselName: col('船名', 'vesselName', '船名号'),
    portName: col('渔港名称', '渔港', 'portName'),
    berthNo: col('泊位号', 'berthNo', '泊位'),
    berthAt: col('靠泊时间', '靠泊', 'berthAt'),
    leaveAt: col('离泊时间', '离泊', 'leaveAt'),
    iceKg: col('加冰kg', '加冰量', 'iceKg'),
    fuelL: col('加油L', '加油量', 'fuelL'),
    unloadKg: col('卸货kg', '卸货量', 'unloadKg'),
    visaStatus: col('签证状态', '签证', 'visaStatus'),
  };

  const rows: LedgerRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const get = (j: number): string => (j >= 0 && j < c.length ? c[j] : '');
    const vesselNo = get(idx.vesselNo);
    const portName = get(idx.portName);
    const berthNo = get(idx.berthNo).toUpperCase();
    const berthAt = normalizeTime(get(idx.berthAt));
    if (!vesselNo || !portName || !berthNo || !berthAt) continue;
    const leaveRaw = get(idx.leaveAt);
    rows.push({
      id: uid('lr'),
      batchId: '',
      vesselNo: vesselNo.trim(),
      vesselName: get(idx.vesselName),
      portName: portName.trim(),
      berthNo,
      berthAt,
      leaveAt: leaveRaw ? normalizeTime(leaveRaw) : null,
      iceKg: num(get(idx.iceKg)),
      fuelL: num(get(idx.fuelL)),
      unloadKg: num(get(idx.unloadKg)),
      visaStatus: normalizeVisa(get(idx.visaStatus)),
      status: 'pending',
      message: '',
      refCallId: null,
      diffs: [],
      importedAt: new Date().toISOString(),
    });
  }
  return rows;
}

/** 台账配对主键：渔船编号 + 渔港 + 泊位 + 靠泊时段（精确到 ISO 时间） */
export function ledgerKey(row: LedgerRow): string {
  return [
    row.vesselNo.trim().toUpperCase(),
    row.portName.trim(),
    row.berthNo.trim().toUpperCase(),
    row.berthAt,
  ].join('|');
}

/** 判断台账行与本地进出港记录是否为同一靠泊时段（同船 + 同泊位 + 同一天） */
export function isSameDockingSlot(row: LedgerRow, call: PortCall): boolean {
  return (
    call.type === '进港' &&
    call.berthNo === row.berthNo &&
    isSameDay(call.time, row.berthAt)
  );
}

/** 台账行与系统原记录的字段差异（保留原记录，仅列出差异） */
export function diffAgainstCall(row: LedgerRow, call: PortCall): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  if (row.berthNo !== call.berthNo) {
    diffs.push({ field: '泊位号', ledger: row.berthNo, system: call.berthNo });
  }
  if (row.iceKg !== call.iceKg) {
    diffs.push({ field: '加冰量', ledger: `${row.iceKg} kg`, system: `${call.iceKg} kg` });
  }
  if (row.fuelL !== call.fuelL) {
    diffs.push({ field: '加油量', ledger: `${row.fuelL} L`, system: `${call.fuelL} L` });
  }
  if (row.unloadKg !== call.unloadKg) {
    diffs.push({ field: '卸货量', ledger: `${row.unloadKg} kg`, system: `${call.unloadKg} kg` });
  }
  if (row.visaStatus !== call.visaStatus) {
    diffs.push({ field: '签证状态', ledger: row.visaStatus, system: call.visaStatus });
  }
  return diffs;
}

/** 空白模板 CSV（供下载） */
export function ledgerCsvTemplate(): string {
  return `${LEDGER_HEADERS.join(',')}\n`;
}

function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:${p(minute)}`;
}

/**
 * 示例台账：覆盖 重复 / 冲突 / 可应用 / 容量不足 / 档案不匹配 五种结果。
 * 时间取当天，便于与演示数据的进出港流水配对。
 */
export function exampleLedgerCsv(): string {
  const rows: string[][] = [
    [...LEDGER_HEADERS],
    // 与 c-3001 完全一致 → 重复
    ['ZXY05123', '浙象渔05123', '石浦中心渔港', 'B01', todayAt(8), '', '1200', '800', '8600', '已签证'],
    // 与 c-3002 同船同泊位同时段，但加冰量不同 → 冲突，保留原记录
    ['ZXY05288', '浙象渔05288', '石浦中心渔港', 'B02', todayAt(9), '', '950', '1200', '12400', '已签证'],
    // 新记录：浙岭渔09342 不在港 + 温岭石塘渔港 B01 空闲 → 可应用
    ['ZLY09342', '浙岭渔09342', '温岭石塘渔港', 'B01', todayAt(10), '', '600', '200', '1500', '待签证'],
    // 浙象渔05123 仍在港，且 B02 被占 → 容量不足 / 时段冲突，拒绝 + 待办
    ['ZXY05123', '浙象渔05123', '石浦中心渔港', 'B02', todayAt(11), '', '0', '0', '0', '待签证'],
    // 渔船编号不存在 → 档案不匹配，拒绝 + 待办
    ['ZZ99999', '浙虚渔99999', '石浦中心渔港', 'B03', todayAt(14), '', '0', '0', '0', '待签证'],
  ];
  return rows.map((r) => r.join(',')).join('\n');
}
