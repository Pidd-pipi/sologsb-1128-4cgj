/**
 * 停靠台账导入解析：支持 CSV / TSV / JSON 三种导出格式。
 * 表头兼容港调室常见中文列名与英文键名。
 */

export interface RawLedgerRow {
  /** 原始字段（保留表头原样，便于差异展示与重试） */
  fields: Record<string, string>;
  /** 行号（含表头，从 1 开始） */
  rowNumber: number;
}

/** 列名候选（小写去空格后匹配） */
const HEADER_ALIASES: Record<string, string[]> = {
  vesselNo: ['渔船编号', '船舶编号', '编号', '船名号', 'vesselno', 'vessel_no'],
  vesselName: ['船名', '船舶名称', '渔船名', 'vesselname', 'vessel_name'],
  portName: ['渔港', '渔港名称', '港口', '港口名称', 'portname', 'port_name', 'port'],
  berthNo: ['泊位号', '泊位', '泊位编号', 'berthno', 'berth_no', 'berth'],
  startTime: ['靠泊时间', '进港时间', '开始时间', '停靠开始', 'starttime', 'start_time', 'start'],
  endTime: ['离泊时间', '出港时间', '结束时间', '停靠结束', 'endtime', 'end_time', 'end'],
  iceKg: ['加冰kg', '加冰量kg', '加冰量', '加冰', 'icekg', 'ice_kg', 'ice'],
  fuelL: ['加油l', '加油量l', '加油量', '加油', 'fuell', 'fuel_l', 'fuel'],
  unloadKg: ['卸货量kg', '卸货kg', '卸货量', '卸货', 'unloadkg', 'unload_kg', 'unload'],
  visaStatus: ['签证状态', '签证', 'visastatus', 'visa_status', 'visa'],
};

export const LEDGER_TEMPLATE_HEADERS = [
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
];

/** 模板示例行（与演示数据对应，可直接导入验证） */
export const LEDGER_TEMPLATE_ROWS: string[][] = [
  ['ZXY05123', '浙象渔05123', '石浦中心渔港', 'B03', '2026-09-30 06:30', '2026-09-30 18:00', '1000', '900', '7200', '待签证'],
  ['ZLY09342', '浙岭渔09342', '温岭石塘渔港', 'B01', '2026-09-30 09:00', '', '200', '0', '0', '免签'],
];

function normalizeHeader(name: string): string {
  return name.trim().replace(/^﻿/, '').toLowerCase().replace(/[\s_\-（）()]/g, '');
}

/** 建立 表头列名 → 标准字段 的映射 */
function buildHeaderMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of headers) {
    const key = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((alias) => normalizeHeader(alias) === key)) {
        map[header] = field;
        break;
      }
    }
  }
  return map;
}

/** 解析一行 CSV（支持引号包裹、逗号转义 ""） */
function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/** 带引号字段的整表切分（引号内允许出现换行） */
function splitRecords(text: string, delimiter: string): string[] {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      // 成对引号视为转义
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      if (current.length > 0 || records.length === 0) records.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) records.push(current);
  return records;
}

/** 解析 CSV / TSV 文本为原始台账行 */
export function parseDelimited(text: string): RawLedgerRow[] {
  const cleaned = text.replace(/^﻿/, '');
  if (!cleaned.trim()) return [];
  const firstLine = cleaned.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const lines = splitRecords(cleaned, delimiter);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.trim());
  const headerMap = buildHeaderMap(headers);

  const rows: RawLedgerRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const cells = parseCsvLine(lines[i], delimiter);
    const fields: Record<string, string> = {};
    let touched = false;
    headers.forEach((header, index) => {
      const value = (cells[index] ?? '').trim();
      fields[header] = value;
      if (value) touched = true;
    });
    if (touched) rows.push({ fields, rowNumber: i + 1 });
  }
  return rows;
}

/** 解析 JSON 文本（对象数组）为原始台账行 */
export function parseJsonRows(text: string): RawLedgerRow[] {
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) throw new Error('JSON 台账必须是对象数组');
  return data
    .map((item, index) => {
      if (typeof item !== 'object' || item === null) throw new Error(`第 ${index + 1} 行不是对象`);
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        fields[key] = value === null || value === undefined ? '' : String(value).trim();
      }
      return { fields, rowNumber: index + 2 };
    })
    .filter((row) => Object.values(row.fields).some((v) => v));
}

/** 按文件内容自动识别格式并解析 */
export function parseLedgerText(text: string, fileName = ''): RawLedgerRow[] {
  const lower = fileName.toLowerCase();
  const looksJson = lower.endsWith('.json') || text.trim().startsWith('[');
  if (looksJson) return parseJsonRows(text);
  return parseDelimited(text);
}

/** 取标准字段值（兼容别名表头） */
export function pickField(fields: Record<string, string>, field: keyof typeof HEADER_ALIASES): string {
  for (const [header, mapped] of Object.entries(buildHeaderMap(Object.keys(fields)))) {
    if (mapped === field) return fields[header] ?? '';
  }
  return '';
}

/** 宽松时间解析：YYYY-MM-DD HH:mm(:ss) / YYYY/M/D H:M / ISO / YYYY-MM-DD */
export function parseFlexibleDateTime(value: string): string | null {
  const text = value.trim().replace(/[年月]/g, '-').replace(/[日号]/g, '');
  if (!text) return null;
  // 已经是 ISO 或可被 Date 识别的格式
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime()) && /[-/]/.test(text)) return direct.toISOString();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!match) {
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    h ? Number(h) : 0,
    mi ? Number(mi) : 0,
    s ? Number(s) : 0,
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 数字解析：去掉千分位、空格与单位 */
export function parseFlexibleNumber(value: string): number {
  const text = value.replace(/[,，\s]/g, '').replace(/(kg|l|升|公斤)$/i, '');
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/** 归一化签证状态（非法值回落为"待签证"） */
export function normalizeVisaStatus(value: string): '已签证' | '待签证' | '免签' {
  if (value.includes('免')) return '免签';
  if (value.includes('已') || value.includes('办结')) return '已签证';
  return '待签证';
}

/** 生成模板 CSV 文本 */
export function buildTemplateCsv(): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [LEDGER_TEMPLATE_HEADERS, ...LEDGER_TEMPLATE_ROWS].map((line) => line.map(escape).join(',')).join('\r\n');
}
