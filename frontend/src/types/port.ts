/** 渔港等级 */
export type PortLevel = '中心渔港' | '一级渔港' | '二级渔港';

export const PORT_LEVELS: PortLevel[] = ['中心渔港', '一级渔港', '二级渔港'];

/** 补给能力（加油 / 加冰 / 加水） */
export interface SupplyCapability {
  fuel: boolean;
  ice: boolean;
  water: boolean;
}

/** 渔港档案 */
export interface FishingPort {
  id: string;
  /** 渔港名称 */
  name: string;
  /** 等级 */
  level: PortLevel;
  /** 经度 */
  longitude: number;
  /** 纬度 */
  latitude: number;
  /** 泊位数 */
  berthCount: number;
  /** 泊位水深 m */
  berthDepth: number;
  /** 码头长度 m */
  wharfLength: number;
  /** 避风能力（级） */
  shelterLevel: number;
  /** 补给能力 */
  supply: SupplyCapability;
  /** 管理单位 */
  manager: string;
  createdAt: string;
}

/** 渔港一览筛选条件 */
export interface PortFilter {
  level: PortLevel | '';
  minShelterLevel: number | null;
  keyword: string;
}

export function emptyPortFilter(): PortFilter {
  return { level: '', minShelterLevel: null, keyword: '' };
}

/** 补给能力文案 */
export function supplyText(supply: SupplyCapability): string {
  const parts: string[] = [];
  if (supply.fuel) parts.push('加油');
  if (supply.ice) parts.push('加冰');
  if (supply.water) parts.push('加水');
  return parts.length ? parts.join(' / ') : '无补给能力';
}
