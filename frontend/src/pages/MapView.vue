<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { usePortStore } from '../stores/portStore';
import { useUiStore } from '../stores/uiStore';
import { useAmapLoader } from '../hooks/useAmapLoader';
import { useBerthStatus } from '../hooks/useBerthStatus';
import MapPanel from '../components/common/MapPanel.vue';
import EmptyState from '../components/common/EmptyState.vue';
import type { Berth } from '../types/berth';
import { formatDateTime, percentText } from '../utils/format';
import { haversineKm } from '../utils/geo';

const router = useRouter();
const portStore = usePortStore();
const uiStore = useUiStore();

const loader = useAmapLoader();
const berthsRef = computed(() => portStore.berths);
const { summaryOf } = useBerthStatus(berthsRef);

const dialogVisible = ref(false);
const activePortId = ref('');

const activePort = computed(() => portStore.ports.find((p) => p.id === activePortId.value));
const activeSummary = computed(() => (activePortId.value ? summaryOf(activePortId.value) : null));
const activeBerths = computed<Berth[]>(() => (activePortId.value ? portStore.berthsOf(activePortId.value) : []));

const portRows = computed(() =>
  portStore.ports
    .map((port) => {
      const summary = summaryOf(port.id);
      return { port, summary };
    })
    .sort((a, b) => b.summary.occupancyRate - a.summary.occupancyRate),
);

const averageDistance = computed(() => {
  const list = portStore.ports;
  if (list.length < 2) return 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      total += haversineKm(list[i], list[j]);
      count += 1;
    }
  }
  return count ? total / count : 0;
});

const statusTagType = computed(() => (loader.status.value === 'ready' ? 'success' : 'warning'));

onMounted(async () => {
  if (!portStore.ports.length) await portStore.loadAll();
  if (portStore.ports.length) uiStore.selectPort(portStore.ports[0].id);
});

function onSelectPort(portId: string): void {
  activePortId.value = portId;
  uiStore.selectPort(portId);
  dialogVisible.value = true;
}

function openPortDetail(): void {
  if (!activePortId.value) return;
  dialogVisible.value = false;
  void router.push(`/ports/${activePortId.value}`);
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>渔港与在港渔船分布</h1>
        <p class="page__sub">
          共 {{ portStore.ports.length }} 座渔港 · 平均港间距 {{ averageDistance.toFixed(1) }} km · 点击图上节点查看泊位占用摘要
        </p>
      </div>
      <el-tag :type="statusTagType" effect="dark" data-testid="map-key-status">
        {{ loader.hasKey ? '已配置 AMAP Key' : '未配置 AMAP Key（SVG 网格降级）' }}
      </el-tag>
    </header>

    <el-alert type="info" show-icon :closable="false" data-testid="map-notice">
      <template #title>{{ loader.reason.value }}</template>
      <template #default>
        地图 key 走 <code>VITE_AMAP_KEY</code>（当前为空时使用本地 SVG 网格视图，不请求外部地图服务）。
      </template>
    </el-alert>

    <el-row :gutter="16">
      <el-col :lg="17" :md="24">
        <el-card shadow="never" class="detail-card">
          <template #header><span class="card-title">分布图</span></template>
          <MapPanel
            :ports="portStore.ports"
            :berths="portStore.berths"
            :focused-port-id="uiStore.selectedPortId"
            :height="460"
            @select-port="onSelectPort"
          />
        </el-card>
      </el-col>

      <el-col :lg="7" :md="24">
        <el-card shadow="never" class="detail-card">
          <template #header><span class="card-title">占用率排行</span></template>
          <div v-if="portRows.length" class="rank-list" data-testid="port-rank">
            <div
              v-for="row in portRows"
              :key="row.port.id"
              class="rank-item"
              :class="{ 'rank-item--active': row.port.id === uiStore.selectedPortId }"
              @click="onSelectPort(row.port.id)"
            >
              <div class="rank-item__head">
                <span class="rank-item__name">{{ row.port.name }}</span>
                <span class="rank-item__rate">{{ percentText(row.summary.occupancyRate) }}</span>
              </div>
              <el-progress
                :percentage="Number((row.summary.occupancyRate * 100).toFixed(1))"
                :stroke-width="10"
                :show-text="false"
              />
              <span class="rank-item__meta">
                在港 {{ row.summary.inPortCount }} 艘 · 空闲 {{ row.summary.free }} 个泊位 · {{ row.port.level }}
              </span>
            </div>
          </div>
          <EmptyState v-else title="暂无渔港数据" description="请先在渔港一览页登记渔港。" />
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="dialogVisible" :title="activePort ? `${activePort.name} · 泊位占用摘要` : '泊位占用摘要'" width="620px" data-testid="berth-summary-dialog">
      <template v-if="activePort && activeSummary">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="等级">{{ activePort.level }}</el-descriptions-item>
          <el-descriptions-item label="管理单位">{{ activePort.manager }}</el-descriptions-item>
          <el-descriptions-item label="泊位总数">{{ activeSummary.total }}</el-descriptions-item>
          <el-descriptions-item label="占用率">{{ percentText(activeSummary.occupancyRate) }}</el-descriptions-item>
          <el-descriptions-item label="占用 / 空闲">
            {{ activeSummary.occupied }} / {{ activeSummary.free }}
          </el-descriptions-item>
          <el-descriptions-item label="维修泊位">{{ activeSummary.maintenance }}</el-descriptions-item>
        </el-descriptions>

        <p class="dialog-sub">在港船舶</p>
        <el-table :data="activeSummary.occupiedBerths" size="small" border empty-text="当前无在港船舶" data-testid="summary-inport-table">
          <el-table-column prop="berthNo" label="泊位号" width="90" />
          <el-table-column prop="vesselName" label="船名" min-width="130" />
          <el-table-column label="靠泊时间" min-width="160">
            <template #default="scope">{{ formatDateTime(scope.row.berthAt) }}</template>
          </el-table-column>
        </el-table>

        <p class="dialog-sub">空闲泊位（{{ activeSummary.freeBerths.length }}）</p>
        <div class="free-berths">
          <el-tag v-for="b in activeSummary.freeBerths" :key="b.id" size="small" type="success" effect="plain">
            {{ b.berthNo }}
          </el-tag>
          <span v-if="!activeSummary.freeBerths.length" class="free-berths__empty">暂无空闲泊位</span>
        </div>

        <p class="dialog-sub">全部泊位</p>
        <el-table :data="activeBerths" size="small" border>
          <el-table-column prop="berthNo" label="泊位号" width="90" />
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="vesselName" label="占用船舶" min-width="130" />
        </el-table>
      </template>
      <template #footer>
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button type="primary" data-testid="goto-port-detail" @click="openPortDetail">查看渔港详情</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.page__head h1 {
  margin: 0;
  font-size: 22px;
  color: #17324d;
}
.page__sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: #6b7c8c;
}
.detail-card {
  border-radius: 10px;
  margin-bottom: 16px;
}
.card-title {
  font-weight: 600;
  color: #17324d;
}
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rank-item {
  padding: 8px 10px;
  border: 1px solid #eaf1f7;
  border-radius: 8px;
  cursor: pointer;
}
.rank-item--active {
  border-color: #409eff;
  background: #f5faff;
}
.rank-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.rank-item__name {
  font-size: 14px;
  color: #17324d;
}
.rank-item__rate {
  font-size: 13px;
  color: #409eff;
}
.rank-item__meta {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #7b8a99;
}
.dialog-sub {
  margin: 14px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #17324d;
}
.free-berths {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.free-berths__empty {
  font-size: 12px;
  color: #9aa9b6;
}
</style>
