<script setup lang="ts">
import { computed } from 'vue';
import { supplyText, type FishingPort } from '../../types/port';
import type { BerthSummary } from '../../types/berth';
import { formatNumber, percentText } from '../../utils/format';

const props = defineProps<{
  port: FishingPort;
  summary: BerthSummary;
  clickable?: boolean;
}>();

const emit = defineEmits<{ (e: 'open', portId: string): void }>();

const levelTagType = computed(() => {
  if (props.port.level === '中心渔港') return 'danger';
  if (props.port.level === '一级渔港') return 'warning';
  return 'info';
});

const supplyTags = computed(() => {
  const s = props.port.supply;
  return [
    { label: '加油', on: s.fuel },
    { label: '加冰', on: s.ice },
    { label: '加水', on: s.water },
  ];
});

const progressColor = computed(() => {
  const rate = props.summary.occupancyRate;
  if (rate >= 0.8) return '#e6a23c';
  if (rate >= 0.5) return '#409eff';
  return '#67c23a';
});

function onClick(): void {
  if (props.clickable !== false) emit('open', props.port.id);
}
</script>

<template>
  <el-card
    class="port-card"
    shadow="hover"
    :class="{ 'port-card--static': clickable === false }"
    :data-testid="`port-card-${port.id}`"
    data-role="port-card"
    @click="onClick"
  >
    <div class="port-card__head">
      <div>
        <h3 class="port-card__name">{{ port.name }}</h3>
        <p class="port-card__manager">{{ port.manager }}</p>
      </div>
      <el-tag :type="levelTagType" size="small" effect="dark">{{ port.level }}</el-tag>
    </div>

    <el-descriptions :column="2" size="small" border class="port-card__desc">
      <el-descriptions-item label="泊位数">{{ port.berthCount }} 个</el-descriptions-item>
      <el-descriptions-item label="泊位水深">{{ formatNumber(port.berthDepth) }} m</el-descriptions-item>
      <el-descriptions-item label="码头长度">{{ formatNumber(port.wharfLength, 0) }} m</el-descriptions-item>
      <el-descriptions-item label="避风能力">{{ port.shelterLevel }} 级</el-descriptions-item>
    </el-descriptions>

    <div class="port-card__rate">
      <span class="port-card__rate-label">泊位占用率</span>
      <el-progress
        :percentage="Number((summary.occupancyRate * 100).toFixed(1))"
        :color="progressColor"
        :stroke-width="12"
        :format="() => percentText(summary.occupancyRate)"
      />
    </div>

    <div class="port-card__stats">
      <span>在港船数 <b>{{ summary.inPortCount }}</b></span>
      <span>空闲泊位 <b>{{ summary.free }}</b></span>
      <span>维修泊位 <b>{{ summary.maintenance }}</b></span>
    </div>

    <div class="port-card__supply">
      <span class="port-card__supply-label">补给能力</span>
      <el-tag
        v-for="t in supplyTags"
        :key="t.label"
        :type="t.on ? 'success' : 'info'"
        size="small"
        :effect="t.on ? 'light' : 'plain'"
      >
        {{ t.on ? t.label : `${t.label}（无）` }}
      </el-tag>
    </div>
    <p class="port-card__supply-text">可提供：{{ supplyText(port.supply) }}</p>
  </el-card>
</template>

<style scoped>
.port-card {
  cursor: pointer;
  border-radius: 10px;
}
.port-card--static {
  cursor: default;
}
.port-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.port-card__name {
  margin: 0;
  font-size: 17px;
  color: #17324d;
}
.port-card__manager {
  margin: 4px 0 0;
  font-size: 12px;
  color: #7b8a99;
}
.port-card__desc {
  margin-top: 12px;
}
.port-card__rate {
  margin-top: 14px;
}
.port-card__rate-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: #5b6b7b;
}
.port-card__stats {
  display: flex;
  gap: 16px;
  margin-top: 10px;
  font-size: 13px;
  color: #5b6b7b;
}
.port-card__stats b {
  color: #17324d;
}
.port-card__supply {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.port-card__supply-label {
  font-size: 12px;
  color: #5b6b7b;
}
.port-card__supply-text {
  margin: 8px 0 0;
  font-size: 12px;
  color: #8592a0;
}
</style>
