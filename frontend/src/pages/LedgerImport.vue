<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { usePortStore } from '../stores/portStore';
import { useVesselStore } from '../stores/vesselStore';
import { useLedgerStore } from '../stores/ledgerStore';
import { useTodoStore } from '../stores/todoStore';
import { exampleLedgerCsv, ledgerCsvTemplate } from '../utils/ledger';
import { formatDateTime } from '../utils/format';
import type { LedgerRow, LedgerRowStatus } from '../types/ledger';
import type { Todo, TodoKind } from '../types/todo';

const portStore = usePortStore();
const vesselStore = useVesselStore();
const ledgerStore = useLedgerStore();
const todoStore = useTodoStore();

const csvText = ref('');
const parsed = ref<LedgerRow[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const statusType: Record<LedgerRowStatus, 'primary' | 'success' | 'info' | 'warning' | 'danger'> = {
  pending: 'primary',
  applied: 'success',
  duplicate: 'info',
  conflict: 'warning',
  rejected: 'danger',
};
const statusText: Record<LedgerRowStatus, string> = {
  pending: '可应用',
  applied: '已应用',
  duplicate: '重复',
  conflict: '字段冲突',
  rejected: '已拒绝',
};

const kindTag: Record<TodoKind, { text: string; type: 'danger' | 'warning' | 'info' }> = {
  capacity: { text: '容量不足', type: 'danger' },
  conflict: { text: '时段冲突', type: 'warning' },
  unmatched: { text: '档案不匹配', type: 'info' },
  info: { text: '其他', type: 'info' },
};

const counts = computed(() => ledgerStore.counts);
const openTodos = computed(() => todoStore.openTodos);

async function bootstrap(): Promise<void> {
  if (!portStore.ports.length) await portStore.loadAll();
  if (!vesselStore.vessels.length) await vesselStore.loadAll();
  await ledgerStore.loadAll();
  await todoStore.loadAll();
}

onMounted(bootstrap);

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    csvText.value = String(reader.result ?? '');
    ElMessage.success(`已读取 ${file.name}`);
  };
  reader.readAsText(file);
  input.value = '';
}

function downloadCsv(name: string, content: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function loadTemplate(): void {
  csvText.value = ledgerCsvTemplate();
}

function loadExample(): void {
  csvText.value = exampleLedgerCsv();
}

function doParse(): void {
  const rows = ledgerStore.parseCsv(csvText.value);
  parsed.value = rows;
  if (!rows.length) {
    ElMessage.warning('未解析到有效台账行，请检查 CSV 表头与字段');
    return;
  }
  ElMessage.info(`已解析 ${rows.length} 条台账行`);
}

async function doAnalyze(): Promise<void> {
  if (!parsed.value.length) doParse();
  if (!parsed.value.length) return;
  await ledgerStore.analyze(parsed.value);
  const c = ledgerStore.counts;
  ElMessage.success(
    `对账完成：可应用 ${c.pending} · 重复 ${c.duplicate} · 字段冲突 ${c.conflict} · 拒绝 ${c.rejected}`,
  );
}

async function doApply(): Promise<void> {
  const { applied, failed } = await ledgerStore.applyPending();
  if (failed) {
    ElMessage.warning(`已应用 ${applied} 条，${failed} 条因冲突未覆盖（见待办）`);
  } else {
    ElMessage.success(`已应用 ${applied} 条台账，进出港登记与泊位状态已同步`);
  }
}

async function resolveTodo(todo: Todo): Promise<void> {
  await todoStore.setStatus(todo.id, 'done');
  ElMessage.success('待办已标记完成');
}

async function dismissTodo(todo: Todo): Promise<void> {
  await todoStore.setStatus(todo.id, 'dismissed');
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>台账导入与对账</h1>
        <p class="page__sub">
          导入港调室每日停靠台账，与本地渔港、渔船档案跨系统配对：按渔船编号、渔港与泊位时段核对，重复只留一条，字段不同先列差异并保留原记录
        </p>
      </div>
    </header>

    <el-row :gutter="16">
      <el-col :lg="14" :md="24">
        <el-card shadow="never" class="detail-card">
          <template #header><span class="card-title">导入台账 CSV</span></template>
          <div class="import-actions">
            <el-button type="primary" @click="fileInput?.click()">选择 CSV 文件</el-button>
            <el-button @click="downloadCsv('停靠台账模板.csv', ledgerCsvTemplate())">下载模板</el-button>
            <el-button @click="loadExample()">载入示例台账</el-button>
            <input
              ref="fileInput"
              type="file"
              accept=".csv,text/csv"
              style="display: none"
              @change="onFileChange"
            />
          </div>
          <el-input
            v-model="csvText"
            type="textarea"
            :rows="10"
            placeholder="粘贴台账 CSV，或点击上方按钮选择文件 / 载入示例"
            data-testid="ledger-csv-input"
          />
          <div class="import-actions">
            <el-button @click="doParse()">解析台账</el-button>
            <el-button type="primary" :loading="ledgerStore.analyzing" @click="doAnalyze()">
              开始对账
            </el-button>
            <el-button
              type="success"
              :disabled="!ledgerStore.hasPending"
              :loading="ledgerStore.applying"
              data-testid="apply-ledger"
              @click="doApply()"
            >
              应用可应用记录（{{ counts.pending }}）
            </el-button>
          </div>
          <p class="detail-hint">
            应用前将检查泊位容量与时段冲突：容量不足或船舶仍在港会被拒绝并留下待办；同一泊位被其他标签页修改时会提示冲突，不会覆盖原数据。
          </p>
        </el-card>
      </el-col>

      <el-col :lg="10" :md="24">
        <el-card shadow="never" class="detail-card">
          <template #header><span class="card-title">对账结果</span></template>
          <div class="stat-row">
            <div class="stat"><span class="stat__label">总数</span><b>{{ counts.total }}</b></div>
            <div class="stat"><span class="stat__label">可应用</span><b>{{ counts.pending }}</b></div>
            <div class="stat"><span class="stat__label">已应用</span><b>{{ counts.applied }}</b></div>
            <div class="stat"><span class="stat__label">重复</span><b>{{ counts.duplicate }}</b></div>
            <div class="stat"><span class="stat__label">冲突</span><b>{{ counts.conflict }}</b></div>
            <div class="stat"><span class="stat__label">拒绝</span><b>{{ counts.rejected }}</b></div>
          </div>
        </el-card>

        <el-card shadow="never" class="detail-card">
          <template #header>
            <span class="card-title">对账待办（{{ openTodos.length }}）</span>
          </template>
          <el-table :data="openTodos" size="small" border empty-text="暂无待办" data-testid="todo-list">
            <el-table-column label="类型" width="90">
              <template #default="scope">
                <el-tag
                  size="small"
                  :type="kindTag[(scope.row as Todo).kind].type"
                >
                  {{ kindTag[(scope.row as Todo).kind].text }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="事项" min-width="140" />
            <el-table-column prop="detail" label="说明" min-width="200" />
            <el-table-column label="操作" width="130">
              <template #default="scope">
                <el-button text type="primary" size="small" @click="resolveTodo(scope.row)">完成</el-button>
                <el-button text size="small" @click="dismissTodo(scope.row)">忽略</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="detail-card">
      <template #header><span class="card-title">台账明细（{{ ledgerStore.rows.length }} 条）</span></template>
      <el-table :data="ledgerStore.rows" size="small" border empty-text="尚未导入台账" data-testid="ledger-rows">
        <el-table-column type="expand">
          <template #default="scope">
            <div class="diff-panel">
              <template v-if="scope.row.diffs?.length">
                <p class="diff-panel__title">字段差异（已保留系统原记录）：</p>
                <el-table :data="scope.row.diffs" size="small" border>
                  <el-table-column prop="field" label="字段" width="120" />
                  <el-table-column prop="ledger" label="台账值" min-width="140" />
                  <el-table-column prop="system" label="系统原值" min-width="140" />
                </el-table>
              </template>
              <p v-else class="diff-panel__empty">无字段差异。</p>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag size="small" :type="statusType[(scope.row as LedgerRow).status]">{{ statusText[(scope.row as LedgerRow).status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="vesselNo" label="渔船编号" width="120" />
        <el-table-column prop="vesselName" label="船名" min-width="120" />
        <el-table-column prop="portName" label="渔港" min-width="140" />
        <el-table-column prop="berthNo" label="泊位" width="80" />
        <el-table-column label="靠泊时间" min-width="150">
          <template #default="scope">{{ formatDateTime(scope.row.berthAt) }}</template>
        </el-table-column>
        <el-table-column label="离泊时间" min-width="150">
          <template #default="scope">{{ formatDateTime(scope.row.leaveAt) }}</template>
        </el-table-column>
        <el-table-column prop="iceKg" label="加冰kg" width="90" />
        <el-table-column prop="fuelL" label="加油L" width="80" />
        <el-table-column prop="unloadKg" label="卸货kg" width="90" />
        <el-table-column prop="visaStatus" label="签证" width="90" />
        <el-table-column prop="message" label="对账说明" min-width="200" />
      </el-table>
    </el-card>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
.import-actions {
  display: flex;
  gap: 8px;
  margin: 10px 0;
  flex-wrap: wrap;
}
.stat-row {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat__label {
  font-size: 12px;
  color: #7b8a99;
}
.stat b {
  font-size: 18px;
  color: #17324d;
}
.detail-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #6b7c8c;
}
.diff-panel {
  padding: 8px 16px;
  background: #f7fbff;
}
.diff-panel__title {
  margin: 0 0 8px;
  font-size: 13px;
  color: #b88230;
  font-weight: 600;
}
.diff-panel__empty {
  margin: 0;
  font-size: 12px;
  color: #8592a0;
}
</style>
