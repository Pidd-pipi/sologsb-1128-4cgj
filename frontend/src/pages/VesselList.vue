<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useVesselStore, type VesselInput } from '../stores/vesselStore';
import VesselSpecTable from '../components/common/VesselSpecTable.vue';
import EmptyState from '../components/common/EmptyState.vue';
import { HULL_MATERIALS, OPERATION_TYPES } from '../types/vessel';
import { validateVesselNo } from '../utils/tonnage';

const router = useRouter();
const vesselStore = useVesselStore();

const dialogVisible = ref(false);
const submitting = ref(false);
const formRef = ref<FormInstance>();

function emptyForm(): VesselInput {
  return {
    name: '',
    vesselNo: '',
    homePort: '',
    length: 24,
    beam: 5,
    grossTonnage: 80,
    enginePower: 160,
    operationType: '拖网',
    hullMaterial: '钢质',
    owner: '',
    certificateExpiry: '2027-12-31',
  };
}

const form = reactive<VesselInput>(emptyForm());

const rules: FormRules = {
  name: [{ required: true, message: '请输入船名', trigger: 'blur' }],
  vesselNo: [
    { required: true, message: '请输入渔船编号', trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        const result = validateVesselNo(value);
        callback(result.ok ? undefined : new Error(result.message));
      },
      trigger: 'blur',
    },
  ],
  homePort: [{ required: true, message: '请输入船籍港', trigger: 'blur' }],
  owner: [{ required: true, message: '请输入船主', trigger: 'blur' }],
  certificateExpiry: [{ required: true, message: '请选择证书有效期', trigger: 'change' }],
};

const resultCount = computed(() => vesselStore.results.length);

onMounted(async () => {
  if (!vesselStore.vessels.length) await vesselStore.loadAll();
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
    const vessel = await vesselStore.createVessel(form);
    dialogVisible.value = false;
    ElMessage.success(`已建档渔船：${vessel.name}`);
  } catch (error) {
    ElMessage.error(`建档失败：${(error as Error).message}`);
  } finally {
    submitting.value = false;
  }
}

function openVessel(vesselId: string): void {
  void router.push(`/vessels/${vesselId}`);
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>渔船检索</h1>
        <p class="page__sub">按作业类型、主机功率区间、总吨位与船籍港组合查询，命中 {{ resultCount }} 艘</p>
      </div>
      <el-button type="primary" data-testid="open-vessel-dialog" @click="openDialog">渔船建档</el-button>
    </header>

    <el-card shadow="never" class="filter-card" data-testid="vessel-query">
      <el-form label-width="96px" label-position="left">
        <el-row :gutter="12">
          <el-col :lg="8" :md="12" :sm="24">
            <el-form-item label="作业类型">
              <el-select id="query-op-type" v-model="vesselStore.query.operationType" placeholder="全部作业类型" clearable style="width: 100%">
                <el-option v-for="type in OPERATION_TYPES" :key="type" :label="type" :value="type" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :lg="8" :md="12" :sm="24">
            <el-form-item label="主机功率 kW">
              <div class="range-row">
                <el-input-number id="query-power-min" v-model="vesselStore.query.powerMin" :min="0" :max="2000" :step="10" placeholder="最小" controls-position="right" />
                <span class="range-sep">~</span>
                <el-input-number id="query-power-max" v-model="vesselStore.query.powerMax" :min="0" :max="2000" :step="10" placeholder="最大" controls-position="right" />
              </div>
            </el-form-item>
          </el-col>
          <el-col :lg="8" :md="12" :sm="24">
            <el-form-item label="总吨位 t">
              <div class="range-row">
                <el-input-number id="query-tonnage-min" v-model="vesselStore.query.tonnageMin" :min="0" :max="1000" :step="5" placeholder="最小" controls-position="right" />
                <span class="range-sep">~</span>
                <el-input-number id="query-tonnage-max" v-model="vesselStore.query.tonnageMax" :min="0" :max="1000" :step="5" placeholder="最大" controls-position="right" />
              </div>
            </el-form-item>
          </el-col>
          <el-col :lg="8" :md="12" :sm="24">
            <el-form-item label="船籍港">
              <el-select id="query-home-port" v-model="vesselStore.query.homePort" placeholder="全部船籍港" clearable filterable style="width: 100%">
                <el-option v-for="hp in vesselStore.homePorts" :key="hp" :label="hp" :value="hp" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :lg="16" :md="12" :sm="24">
            <el-form-item label="快捷条件">
              <el-button size="small" data-testid="preset-large" @click="vesselStore.query.powerMin = 300; vesselStore.query.powerMax = null">
                大型主机（≥300kW）
              </el-button>
              <el-button size="small" data-testid="preset-trawler" @click="vesselStore.query.operationType = '拖网'">
                只看拖网
              </el-button>
              <el-button size="small" text type="primary" data-testid="reset-vessel-query" @click="vesselStore.resetQuery()">重置条件</el-button>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <VesselSpecTable v-if="resultCount" :vessels="vesselStore.results" @open="openVessel" />
    <EmptyState v-else title="没有匹配的渔船" description="请放宽主机功率或总吨位区间，或清空船籍港条件后重试。">
      <el-button type="primary" @click="vesselStore.resetQuery()">重置查询条件</el-button>
    </EmptyState>

    <el-dialog v-model="dialogVisible" title="渔船建档" width="720px" data-testid="vessel-dialog">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="船名" prop="name">
              <el-input id="vessel-name" v-model="form.name" placeholder="如：浙象渔05123" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="渔船编号" prop="vesselNo">
              <el-input id="vessel-no" v-model="form.vesselNo" placeholder="如：ZXY05123" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="船籍港" prop="homePort">
              <el-input id="vessel-home-port" v-model="form.homePort" placeholder="如：石浦" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="船主" prop="owner">
              <el-input id="vessel-owner" v-model="form.owner" placeholder="如：林海平" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="船长 m" prop="length">
              <el-input-number id="vessel-length" v-model="form.length" :min="3" :max="120" :step="0.1" :precision="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="型宽 m" prop="beam">
              <el-input-number id="vessel-beam" v-model="form.beam" :min="1" :max="30" :step="0.1" :precision="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="总吨位 t" prop="grossTonnage">
              <el-input-number id="vessel-tonnage" v-model="form.grossTonnage" :min="1" :max="2000" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="主机功率 kW" prop="enginePower">
              <el-input-number id="vessel-power" v-model="form.enginePower" :min="10" :max="3000" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="作业类型" prop="operationType">
              <el-select id="vessel-op-type" v-model="form.operationType" style="width: 100%">
                <el-option v-for="type in OPERATION_TYPES" :key="type" :label="type" :value="type" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="船体材质" prop="hullMaterial">
              <el-select id="vessel-material" v-model="form.hullMaterial" style="width: 100%">
                <el-option v-for="m in HULL_MATERIALS" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="证书有效期" prop="certificateExpiry">
          <el-date-picker
            id="vessel-expiry"
            v-model="form.certificateExpiry"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" data-testid="submit-vessel" @click="submit">保存档案</el-button>
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
.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.range-row :deep(.el-input-number) {
  flex: 1;
}
.range-sep {
  color: #97a6b4;
}
</style>
