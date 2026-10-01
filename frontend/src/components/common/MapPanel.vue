<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRef, watch } from 'vue';
import type { FishingPort } from '../../types/port';
import type { Berth } from '../../types/berth';
import { useAmapLoader } from '../../hooks/useAmapLoader';
import { useBerthStatus } from '../../hooks/useBerthStatus';
import { boundsOf, gridLines, projectToGrid } from '../../utils/geo';
import { percentText } from '../../utils/format';

const props = withDefaults(
  defineProps<{
    ports: FishingPort[];
    berths: Berth[];
    height?: number;
    focusedPortId?: string;
  }>(),
  { height: 380, focusedPortId: '' },
);

const emit = defineEmits<{
  (e: 'select-port', portId: string): void;
  (e: 'select-berth', berth: Berth): void;
}>();

const loader = useAmapLoader();
const status = loader.status;
const reason = loader.reason;

const containerRef = ref<HTMLDivElement | null>(null);
let map: any = null;
let markers: any[] = [];

const WIDTH = 760;
const HEIGHT = 360;

const berthRef = toRef(props, 'berths');
const { summaryOf } = useBerthStatus(berthRef);

const bounds = computed(() => boundsOf(props.ports));
const lines = computed(() => gridLines(bounds.value, 8, 5));

interface MapNode {
  port: FishingPort;
  x: number;
  y: number;
  rate: number;
  occupied: number;
  total: number;
  focused: boolean;
}

const nodes = computed<MapNode[]>(() =>
  props.ports.map((port) => {
    const pos = projectToGrid(port, bounds.value, { width: WIDTH, height: HEIGHT });
    const summary = summaryOf(port.id);
    return {
      port,
      x: pos.x,
      y: pos.y,
      rate: summary.occupancyRate,
      occupied: summary.occupied,
      total: summary.total,
      focused: port.id === props.focusedPortId,
    };
  }),
);

const modeTag = computed(() => (status.value === 'ready' ? '高德地图模式' : '本地 SVG 网格视图'));
const modeTagType = computed(() => (status.value === 'ready' ? 'success' : 'info'));

function nodeColor(rate: number): string {
  if (rate >= 0.75) return '#e6a23c';
  if (rate >= 0.4) return '#409eff';
  return '#67c23a';
}

async function ensureMap(): Promise<void> {
  const ok = await loader.load();
  if (!ok) return;
  await nextTick();
  initAmap();
}

function initAmap(): void {
  if (!containerRef.value || !window.AMap) {
    status.value = 'fallback';
    reason.value = '高德地图容器不可用，已降级为本地 SVG 网格视图';
    return;
  }
  try {
    const center = props.ports.length
      ? [props.ports[0].longitude, props.ports[0].latitude]
      : [121.9, 29.5];
    map = new window.AMap.Map(containerRef.value, { zoom: 9, center });
    for (const marker of markers) {
      if (marker && typeof marker.setMap === 'function') marker.setMap(null);
    }
    markers = props.ports.map((port) => {
      const marker = new window.AMap.Marker({
        position: [port.longitude, port.latitude],
        title: port.name,
        label: { content: port.name, direction: 'top' },
      });
      marker.on('click', () => emit('select-port', port.id));
      marker.setMap(map);
      return marker;
    });
  } catch {
    status.value = 'fallback';
    reason.value = '高德地图初始化失败，已降级为本地 SVG 网格视图';
  }
}

onMounted(() => {
  if (loader.hasKey) void ensureMap();
});

watch(
  () => props.ports.map((p) => p.id).join(','),
  () => {
    if (status.value === 'ready') initAmap();
  },
);
</script>

<template>
  <div class="map-panel" data-testid="map-panel">
    <div class="map-panel__head">
      <el-tag :type="modeTagType" size="small" effect="dark" data-testid="map-mode">{{ modeTag }}</el-tag>
      <span class="map-panel__reason" data-testid="map-reason">{{ reason }}</span>
      <el-button v-if="loader.hasKey" size="small" text type="primary" @click="ensureMap">重新加载地图</el-button>
    </div>

    <div
      v-if="status === 'ready'"
      ref="containerRef"
      class="map-panel__amap"
      :style="{ height: `${height}px` }"
      data-testid="map-amap-container"
    ></div>

    <svg
      v-else
      class="map-panel__svg"
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      :style="{ height: `${height}px` }"
      role="img"
      aria-label="渔港分布网格视图"
      data-testid="map-svg-fallback"
    >
      <rect x="0" y="0" :width="WIDTH" :height="HEIGHT" fill="#f7fbff" />
      <line
        v-for="(line, index) in lines"
        :key="`grid-${index}`"
        :x1="line.x1"
        :y1="line.y1"
        :x2="line.x2"
        :y2="line.y2"
        stroke="#dce9f4"
        stroke-width="1"
        stroke-dasharray="4 6"
      />
      <g v-for="node in nodes" :key="node.port.id" :data-testid="`map-node-${node.port.id}`" class="map-panel__node" @click="emit('select-port', node.port.id)">
        <circle
          :cx="node.x"
          :cy="node.y"
          :r="node.focused ? 20 : 15"
          :fill="nodeColor(node.rate)"
          fill-opacity="0.22"
          :stroke="nodeColor(node.rate)"
          :stroke-width="node.focused ? 3 : 2"
        />
        <circle :cx="node.x" :cy="node.y" r="4.5" :fill="nodeColor(node.rate)" />
        <text :x="node.x" :y="node.y - 24" text-anchor="middle" class="map-panel__label">{{ node.port.name }}</text>
        <text :x="node.x" :y="node.y + 34" text-anchor="middle" class="map-panel__meta">
          {{ node.occupied }}/{{ node.total }} 占用 {{ percentText(node.rate) }}
        </text>
      </g>
      <text x="14" y="24" class="map-panel__caption">经纬网格（每格约 {{ ((bounds.maxLng - bounds.minLng) / 8).toFixed(2) }}° 经差）</text>
    </svg>
  </div>
</template>

<style scoped>
.map-panel {
  width: 100%;
}
.map-panel__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.map-panel__reason {
  font-size: 12px;
  color: #7b8a99;
}
.map-panel__svg {
  width: 100%;
  border: 1px solid #e4ecf3;
  border-radius: 10px;
}
.map-panel__amap {
  width: 100%;
  border: 1px solid #e4ecf3;
  border-radius: 10px;
}
.map-panel__node {
  cursor: pointer;
}
.map-panel__label {
  font-size: 12px;
  font-weight: 600;
  fill: #17324d;
}
.map-panel__meta {
  font-size: 11px;
  fill: #6b7c8c;
}
.map-panel__caption {
  font-size: 11px;
  fill: #9aa9b6;
}
</style>
