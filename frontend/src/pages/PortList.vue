<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { usePortStore, type PortInput } from '../stores/portStore';
import { useUiStore } from '../stores/uiStore';
import { useBerthStatus } from '../hooks/useBerthStatus';
import { PORT_LEVELS } from '../types/port';
import PortCard from '../components/common/PortCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { percentText } from '../utils/format';

const router = useRouter();
const portStore = usePortStore();
const uiStore = useUiStore();
const berthsRef = computed(() => portStore.berths);
const { summaryOf } = useBerthStatus(berthsRef);

const shelterOptions = [
  { label: '不限', value: null },
  { label: '≥ 9 级', value: 9 },
  { label: '≥ 10 级', value: 10 },
  { label: '≥ 11 级', value: 11 },
  { label: '≥ 12 级', value: 12 },
];

const dialogVisible = ref(false);
const submitting = ref(false);
const formRef = ref<FormInstance>();

function emptyForm(): PortInput {
  return {
    name: '',
    level: '一级渔港',
    longitude: 121.9,
    latitude: 29.5,
    berthCount: 4,
    berthDepth: 4.5,
    wharfLength: 220,
    shelterLevel: 10,
    supply: { fuel: true, ice: true, water: false },
    manager: '',
  };
}

const form = reactive<PortInput>(emptyForm());

const rules: FormRules = {
  name: [{ required: true, message: '请输入渔港名称', trigger: 'blur' }],
  manager: [{ required: true, message: '请输入管理单位', trigger: 'blur' }],
};

const overall = computed(() => {
  const list = portStore.ports;
  const berthTotal = list.reduce((sum, p) => sum + summaryOf(p.id).total, 0);
  const occupied = list.reduce((sum, p) => sum + summaryOf(p.id).occupied, 0);
  return {
    portCount: list.length,
    berthTotal,
    occupied,
    rate: berthTotal === 0 ? 0 : occupied / berthTotal,
  };
});

onMounted(async () => {
  if (!portStore.ports.length) await portStore.loadAll();
});

function openDialog(): void {
  Object.assign(form, emptyForm());
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  submitting.value = true;
  try {
    const port = await portStore.createPort(form);
    dialogVisible.value = false;
    uiStore.notify(`已登记渔港：${port.name}`, 'success');
    portStore.filter.level = '';
    portStore.filter.keyword = '';
  } catch (error) {
    ElMessage.error(`登记失败：${(error as Error).message}`);
  } finally {
    submitting.value = false;
  }
}

function openPort(portId: string): void {
  void router.push(`/ports/${portId}`);
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>渔港一览</h1>
        <p class="page__sub">共 {{ overall.portCount }} 座渔港 · {{ overall.berthTotal }} 个泊位 · 在港船舶 {{ overall.occupied }} 艘 · 平均占用率 {{ percentText(overall.rate) }}</p>
      </div>
      <el-button type="primary" data-testid="open-port-dialog" @click="openDialog">登记渔港</el-button>
    </header>

    <el-card shadow="never" class="filter-card" data-testid="port-filter">
      <div class="filter-row">
        <span class="filter-label">渔港等级</span>
        <el-radio-group v-model="portStore.filter.level" data-testid="level-filter">
          <el-radio-button :value="''">全部</el-radio-button>
          <el-radio-button v-for="level in PORT_LEVELS" :key="level" :value="level">{{ level }}</el-radio-button>
        </el-radio-group>

        <span class="filter-label">避风能力</span>
        <el-select v-model="portStore.filter.minShelterLevel" placeholder="避风能力" style="width: 130px" data-testid="shelter-filter">
          <el-option v-for="opt in shelterOptions" :key="String(opt.value)" :label="opt.label" :value="opt.value" />
        </el-select>

        <el-input
          v-model="portStore.filter.keyword"
          placeholder="搜索渔港名称或管理单位"
          clearable
          style="width: 240px"
          data-testid="keyword-filter"
        />
        <el-button text type="primary" data-testid="reset-filter" @click="portStore.resetFilter()">重置</el-button>
      </div>
    </el-card>

    <div v-if="portStore.filteredPorts.length" class="port-grid" data-testid="port-grid">
      <PortCard
        v-for="port in portStore.filteredPorts"
        :key="port.id"
        :port="port"
        :summary="summaryOf(port.id)"
        @open="openPort"
      />
    </div>
    <EmptyState
      v-else
      title="没有符合条件的渔港"
      description="可调整等级、避风能力或关键字筛选条件，也可以直接登记一座新渔港。"
    >
      <el-button type="primary" @click="openDialog">登记渔港</el-button>
    </EmptyState>

    <el-dialog v-model="dialogVisible" title="登记渔港" width="680px" data-testid="port-dialog">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="渔港名称" prop="name">
          <el-input id="port-name" v-model="form.name" placeholder="如：石浦中心渔港" />
        </el-form-item>
        <el-form-item label="等级" prop="level">
          <el-select id="port-level" v-model="form.level" placeholder="请选择等级" style="width: 100%">
            <el-option v-for="level in PORT_LEVELS" :key="level" :label="level" :value="level" />
          </el-select>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="经度" prop="longitude">
              <el-input-number id="port-longitude" v-model="form.longitude" :min="100" :max="130" :step="0.01" :precision="4" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="纬度" prop="latitude">
              <el-input-number id="port-latitude" v-model="form.latitude" :min="3" :max="45" :step="0.01" :precision="4" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="泊位数" prop="berthCount">
              <el-input-number id="port-berth-count" v-model="form.berthCount" :min="1" :max="40" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="泊位水深 m" prop="berthDepth">
              <el-input-number id="port-berth-depth" v-model="form.berthDepth" :min="1" :max="30" :step="0.1" :precision="1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="码头长度 m" prop="wharfLength">
              <el-input-number id="port-wharf-length" v-model="form.wharfLength" :min="20" :max="5000" :step="10" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="避风能力 级" prop="shelterLevel">
              <el-input-number id="port-shelter-level" v-model="form.shelterLevel" :min="6" :max="17" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="补给能力">
          <el-checkbox v-model="form.supply.fuel">加油</el-checkbox>
          <el-checkbox v-model="form.supply.ice">加冰</el-checkbox>
          <el-checkbox v-model="form.supply.water">加水</el-checkbox>
        </el-form-item>
        <el-form-item label="管理单位" prop="manager">
          <el-input id="port-manager" v-model="form.manager" placeholder="如：象山县渔港管理站" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" data-testid="submit-port" @click="submit">确定登记</el-button>
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
.filter-card {
  border-radius: 10px;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.filter-label {
  font-size: 13px;
  color: #5b6b7b;
}
.port-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}
</style>
