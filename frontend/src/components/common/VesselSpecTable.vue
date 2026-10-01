<script setup lang="ts">
import type { FishingVessel } from '../../types/vessel';
import { expiryText, powerTier, tonnageTier } from '../../utils/tonnage';
import { formatNumber } from '../../utils/format';

const props = withDefaults(
  defineProps<{
    vessels: FishingVessel[];
    clickable?: boolean;
    emptyText?: string;
  }>(),
  { clickable: true, emptyText: '没有符合条件的渔船' },
);

const emit = defineEmits<{ (e: 'open', vesselId: string): void }>();

function rowClassName(): string {
  return props.clickable ? 'vessel-spec-table__row' : '';
}

function onRowClick(row: FishingVessel): void {
  if (props.clickable) emit('open', row.id);
}
</script>

<template>
  <div class="vessel-spec-table" data-testid="vessel-spec-table">
    <el-table
      :data="vessels"
      size="small"
      border
      stripe
      :empty-text="emptyText"
      :row-class-name="rowClassName"
      @row-click="onRowClick"
    >
      <el-table-column prop="name" label="船名" min-width="120" fixed />
      <el-table-column prop="vesselNo" label="渔船编号" min-width="110" />
      <el-table-column prop="homePort" label="船籍港" min-width="90" />
      <el-table-column label="船长 m" min-width="88">
        <template #default="scope">{{ formatNumber(scope.row.length) }}</template>
      </el-table-column>
      <el-table-column label="型宽 m" min-width="88">
        <template #default="scope">{{ formatNumber(scope.row.beam) }}</template>
      </el-table-column>
      <el-table-column label="总吨位" min-width="140">
        <template #default="scope">
          {{ formatNumber(scope.row.grossTonnage) }} t
          <el-tag size="small" type="info" effect="plain">{{ tonnageTier(scope.row.grossTonnage) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="主机功率 kW" min-width="170">
        <template #default="scope">
          {{ formatNumber(scope.row.enginePower, 0) }} kW
          <el-tag size="small" effect="plain">{{ powerTier(scope.row.enginePower) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="operationType" label="作业类型" min-width="92" />
      <el-table-column prop="hullMaterial" label="船体材质" min-width="96" />
      <el-table-column prop="owner" label="船主" min-width="88" />
      <el-table-column label="证书有效期" min-width="190">
        <template #default="scope">
          {{ scope.row.certificateExpiry }}
          <span class="vessel-spec-table__expiry">{{ expiryText(scope.row.certificateExpiry) }}</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.vessel-spec-table {
  width: 100%;
}
.vessel-spec-table__expiry {
  margin-left: 6px;
  font-size: 12px;
  color: #7b8a99;
}
:deep(.vessel-spec-table__row) {
  cursor: pointer;
}
</style>
