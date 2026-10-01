/**
 * 总吨位与主机功率分档、渔船编号校验、证书到期天数计算。
 */

export interface Tier {
  label: string;
  min: number;
  max: number;
}

/** 主机功率分档（kW） */
export const POWER_TIERS: Tier[] = [
  { label: '小型（<150kW）', min: 0, max: 150 },
  { label: '中型（150-300kW）', min: 150, max: 300 },
  { label: '大型（≥300kW）', min: 300, max: Number.POSITIVE_INFINITY },
];

/** 总吨位分档（t） */
export const TONNAGE_TIERS: Tier[] = [
  { label: '小型（<60t）', min: 0, max: 60 },
  { label: '中型（60-150t）', min: 60, max: 150 },
  { label: '大型（≥150t）', min: 150, max: Number.POSITIVE_INFINITY },
];

function tierOf(tiers: Tier[], value: number): string {
  const hit = tiers.find((t) => value >= t.min && value < t.max);
  return hit ? hit.label : '未分档';
}

/** 主机功率 → 档次文案 */
export function powerTier(kw: number): string {
  return tierOf(POWER_TIERS, Number(kw) || 0);
}

/** 总吨位 → 档次文案 */
export function tonnageTier(tonnage: number): string {
  return tierOf(TONNAGE_TIERS, Number(tonnage) || 0);
}

/** 渔船编号校验：2-4 位大写字母 + 4-6 位数字，允许中间一个连字符 */
export function validateVesselNo(vesselNo: string): { ok: boolean; message: string } {
  const value = (vesselNo || '').trim();
  if (!value) return { ok: false, message: '渔船编号不能为空' };
  if (!/^[A-Z]{2,4}-?\d{4,6}$/.test(value)) {
    return { ok: false, message: '渔船编号格式应为 2-4 位大写字母 + 4-6 位数字，如 ZXY05123' };
  }
  return { ok: true, message: '' };
}

/** 证书到期剩余天数（已过期返回负数） */
export function daysUntilExpiry(expiry: string): number {
  const target = new Date(`${expiry}T23:59:59`);
  if (Number.isNaN(target.getTime())) return Number.NaN;
  const diff = target.getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

/** 证书有效期文案 */
export function expiryText(expiry: string): string {
  const days = daysUntilExpiry(expiry);
  if (Number.isNaN(days)) return '证书日期无效';
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days <= 90) return `${days} 天后到期`;
  return `有效（剩余 ${days} 天）`;
}
