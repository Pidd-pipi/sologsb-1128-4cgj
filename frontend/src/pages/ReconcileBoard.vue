<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { UploadRawFile } from 'element-plus';
import { Right, Tickets } from '@element-plus/icons-vue';
import { usePortStore } from '../stores/portStore';
import { useVesselStore } from '../stores/vesselStore';
import { useTodoStore } from '../stores/todoStore';
import {
  buildReview,
  summarizeReview,
  type ReviewItem,
  type ReviewStatus,
} from '../utils/reconcile';
import { buildTemplateCsv, parseLedgerText } from '../utils/csv';
import { formatDateTime } from '../utils/format';
import { applyReviewItems, createPendingTodos, precheckItem } from '../services/reconcileService';
import { buildKnownIntervals, FAR_FUTURE, type OccupancyInterval } from '../services/occupancy';

const router = useRouter();
const portStore = usePortStore();
const vesselStore = useVesselStore();
const todoStore = useTodoStore();

const fileName = ref('');
const importedAt = ref('');
const items = ref<ReviewItem[]>([]);
const applying = ref(false);
const batchSeq = ref(0);

const STATUS_META: Record<ReviewStatus, { type: 'success' | 'warning' | 'info' | 'danger' | 'primary'; text: string }> = {
  新记录: { type: 'success', text: '新记录' },
  重复: { type: 'info', text: '重复跳过' },
  字段差异: { type: 'warning', text: '字段差异' },
  渔船未建档: { type: 'danger', text: '渔船未建档' },
  渔港未建档: { type: 'danger', text: '渔港未建档' },
};

const PROBLEM_META: Record<NonNullable<ReviewItem['precheck']>['type'], { type: 'danger' | 'warning' | 'info'; text: string }> = {
  容量不足: { type: 'danger', text: '容量不足，拒绝接入' },
  时段冲突: { type: 'warning', text: '泊位时段冲突' },
  泊位缺失: { type: 'info', text: '泊位 / 数据问题' },
};

type ProblemType = NonNullable<ReviewItem['precheck']>['type'];

function problemMeta(precheck: ReviewItem['precheck']): { type: 'danger' | 'warning' | 'info'; text: string } | null {
  return precheck ? PROBLEM_META[precheck.type as ProblemType] : null;
}

const summary = computed(() => summarizeReview(items.value));
const hasReview = computed(() => items.value.length > 0);

const selectableItems = computed(() =>
  items.value.filter((i) => i.status === '新记录' || i.status === '字段差异'),
);

/** 预检已通过的可应用行（容量 / 时段） */
const applicableCount = computed(
  () => selectableItems.value.filter((i) => i.selected && !i.precheck).length,
);
const blockedSelectedCount = computed(
  () => selectableItems.value.filter((i) => i.selected && i.precheck).length,
);

const allSelected = computed({
  get: () => selectableItems.value.length > 0 && selectableItems.value.every((i) => i.selected),
  set: (value: boolean) => {
    for (const item of selectableItems.value) {
      // 预检不通过的行即使全选也不允许应用
      if (value && item.precheck) continue;
      item.selected = value;
    }
  },
});

async function bootstrap(): Promise<void> {
  if (!portStore.ports.length) await portStore.loadAll();
  if (!vesselStore.vessels.length) await vesselStore.loadAll();
  if (!todoStore.todos.length) await todoStore.loadAll();
}

onMounted(bootstrap);

/** 选择导出文件后解析并对账 */
async function onFileChange(uploadFile: { raw: UploadRawFile }): Promise<void> {
  const raw = uploadFile.raw;
  try {
    const text = await raw.text();
    const rows = parseLedgedSafely(text, raw.name);
    if (!rows.length) {
      ElMessage.warning('文件没有可导入的数据行，请检查表头与内容');
      return;
    }
    fileName.value = raw.name;
    importedAt.value = new Date().toISOString();
    const { items: reviewItems } = buildReview(
      rows,
      vesselStore.vessels,
      portStore.ports,
      portStore.calls,
    );
    // 预检：基准 = 在库流水 + 实时泊位还原出的占用时段；同批次按时段先后累积
    const baseIntervals = buildKnownIntervals(portStore.calls, portStore.berths);
    const acceptedIntervals: OccupancyInterval[] = [];
    const pendingNew = reviewItems
      .filter((i) => i.status === '新记录')
      .sort((a, b) => (a.entry.startTime ?? '').localeCompare(b.entry.startTime ?? ''));
    for (const item of pendingNew) {
      item.precheck = precheckItem(item, portStore.ports, portStore.berths, baseIntervals.concat(acceptedIntervals));
      if (item.precheck) {
        item.selected = false;
        continue;
      }
      acceptedIntervals.push({
        portId: item.portId,
        berthNo: item.entry.berthNo,
        vesselId: item.vesselId,
        vesselName: item.entry.vesselName,
        start: new Date(item.entry.startTime as string).getTime(),
        end: item.entry.endTime ? new Date(item.entry.endTime).getTime() : FAR_FUTURE,
        source: 'batch',
      });
    }
    for (const item of reviewItems) {
      if (item.status !== '新记录') item.precheck = null;
    }
    items.value = reviewItems;
    ElMessage.success(
      `对账完成：新记录 ${summary.value.added} 条 · 重复 ${summary.value.duplicated} 条 · 字段差异 ${summary.value.conflicted} 条`,
    );
  } catch (error) {
    ElMessage.error(`台账解析失败：${(error as Error).message}`);
  }
}

function parseLedgedSafely(text: string, name: string) {
  return parseLedgerText(text, name);
}

function resetReview(): void {
  items.value = [];
  fileName.value = '';
  importedAt.value = '';
}

async function applySelected(): Promise<void> {
  const targets = selectableItems.value.filter((i) => i.selected && !i.precheck);
  if (!targets.length) {
    ElMessage.warning('没有可应用的记录（请勾选新记录，或先处理预检拒绝项）');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将把 ${targets.length} 条台账记录接入进出港登记。重复导入只保留一条；字段差异采用台账值时仅更新原记录，原记录不会被新增。是否继续？`,
      '应用前确认',
      { confirmButtonText: '应用对账结果', cancelButtonText: '再检查一下', type: 'warning' },
    );
  } catch {
    return;
  }

  applying.value = true;
  batchSeq.value += 1;
  const batchId = `batch-${Date.now().toString(36)}-${batchSeq.value}`;
  try {
    const result = await applyReviewItems({
      items: items.value,
      ports: portStore.ports,
      vessels: vesselStore.vessels,
      berths: portStore.berths,
      batchId,
    });
    const pendingCreated = await createPendingTodos(items.value, batchId);
    // 重新装载，确保拿到其他标签页可能已变更的最新状态
    await Promise.all([portStore.loadAll(), todoStore.loadAll()]);

    const messages = [
      `已接入新记录 ${result.inserted} 条`,
      result.updated ? `按台账更新差异字段 ${result.updated} 条` : '',
      result.rejected ? `预检拒绝 ${result.rejected} 条` : '',
      result.todosCreated || pendingCreated ? `生成待办 ${result.todosCreated + pendingCreated} 条` : '',
    ].filter(Boolean);
    ElMessage.success(messages.join('；'));

    // 已成功应用的行移除；其余（未勾选 / 重复 / 拒绝 / 未建档）保留供继续处理
    const applied = new Set(result.appliedKeys);
    items.value = items.value.filter((i) => !applied.has(i.key));
  } catch (error) {
    ElMessage.error(`应用失败：${(error as Error).message}`);
    await portStore.loadAll();
  } finally {
    applying.value = false;
  }
}

function downloadTemplate(): void {
  const blob = new Blob([`﻿${buildTemplateCsv()}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '停靠台账模板.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function openPort(portId: string): void {
  if (portId) void router.push(`/ports/${portId}`);
}

function openVessel(vesselId: string): void {
  if (vesselId) void router.push(`/vessels/${vesselId}`);
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>停靠台账对账</h1>
        <p class="page__sub">
          港调室每日导出的停靠台账与本机渔港、渔船档案跨系统对账：按渔船编号、渔港与泊位时段配对，
          重复导入只留一条，字段不同先列差异并保留原记录；应用前检查容量与时段冲突，拒绝项自动生成待办。
        </p>
      </div>
      <div class="page__head-actions">
        <el-button data-testid="download-template" @click="downloadTemplate">下载台账模板</el-button>
        <el-button v-if="hasReview" @click="resetReview">重新导入</el-button>
      </div>
    </header>

    <el-card shadow="never" class="detail-card" data-testid="ledger-import">
      <el-upload drag :auto-upload="false" :show-file-list="false" accept=".csv,.tsv,.txt,.json" :on-change="onFileChange">
        <el-icon class="upload-icon"><Tickets /></el-icon>
        <div class="upload-text">将每日停靠台账拖到此处，或<em>点击选择文件</em></div>
        <template #tip>
          <div class="upload-tip">
            支持 CSV / TSV / JSON；表头需包含渔船编号、渔港名称、泊位号、靠泊时间，可带离泊时间与加冰 / 加油 / 卸货量、签证状态。
          </div>
        </template>
      </el-upload>
      <p v-if="fileName" class="file-meta" data-testid="imported-file">
        已载入：<b>{{ fileName }}</b>（{{ formatDateTime(importedAt) }}）
      </p>
    </el-card>

    <template v-if="hasReview">
      <el-row :gutter="12" class="summary-row">
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="stat-card"><span>台账总行</span><b>{{ summary.total }}</b></el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="stat-card stat-card--success"><span>新记录</span><b>{{ summary.added }}</b></el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="stat-card stat-card--info"><span>重复只留一条</span><b>{{ summary.duplicated }}</b></el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="stat-card stat-card--warning"><span>字段差异</span><b>{{ summary.conflicted }}</b></el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="stat-card stat-card--danger"><span>渔船未建档</span><b>{{ summary.vesselMissing }}</b></el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="stat-card stat-card--danger"><span>渔港未建档/异常</span><b>{{ summary.portMissing }}</b></el-card>
        </el-col>
      </el-row>

      <el-alert
        v-if="blockedSelectedCount || applicableCount"
        :type="blockedSelectedCount ? 'warning' : 'success'"
        :closable="false"
        show-icon
        class="apply-bar"
        data-testid="apply-bar"
      >
        <template #title>
          预检结果：{{ applicableCount }} 条可应用；{{ blockedSelectedCount }} 条因容量不足 / 时段冲突被拒绝并将生成待办。
        </template>
        <div class="apply-bar__actions">
          <el-checkbox v-model="allSelected" data-testid="select-all-applicable">全选可应用行</el-checkbox>
          <el-button
            type="primary"
            :loading="applying"
            :disabled="!applicableCount"
            data-testid="apply-review"
            @click="applySelected"
          >
            应用勾选结果（{{ applicableCount }}）
          </el-button>
        </div>
      </el-alert>

      <el-card shadow="never" class="detail-card">
        <template #header><span class="card-title">对账明细（按渔船编号 · 渔港 · 泊位时段配对）</span></template>
        <el-table :data="items" size="small" border row-key="key" :default-sort="{ prop: 'rowNumber', order: 'ascending' }" data-testid="review-table">
          <el-table-column label="应用" width="64" align="center">
            <template #default="scope">
              <el-checkbox
                v-if="(scope.row.status === '新记录' || scope.row.status === '字段差异') && !scope.row.precheck"
                v-model="scope.row.selected"
                :data-testid="`select-${scope.row.key}`"
              />
              <span v-else class="dash">—</span>
            </template>
          </el-table-column>
          <el-table-column label="行" prop="key" width="56" />
          <el-table-column label="配对结果" width="112">
            <template #default="scope">
              <el-tag size="small" :type="STATUS_META[scope.row.status as ReviewStatus].type">
                {{ STATUS_META[scope.row.status as ReviewStatus].text }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="预检" min-width="170">
            <template #default="scope">
              <el-tag v-if="scope.row.precheck" size="small" :type="problemMeta(scope.row.precheck)?.type" effect="dark">
                {{ problemMeta(scope.row.precheck)?.text }}
              </el-tag>
              <span v-else-if="scope.row.entry.issues.length" class="issue-text">{{ scope.row.entry.issues.join('；') }}</span>
              <el-tag v-else-if="scope.row.status === '新记录' || scope.row.status === '字段差异'" size="small" type="success" effect="plain">预检通过</el-tag>
              <span v-else class="dash">—</span>
              <p v-if="scope.row.precheck" class="precheck-reason" data-testid="precheck-reason">{{ scope.row.precheck.message }}</p>
            </template>
          </el-table-column>
          <el-table-column label="渔船编号 / 船名" min-width="170">
            <template #default="scope">
              <div>
                <b>{{ scope.row.entry.vesselNo || '—' }}</b>
                <el-link
                  v-if="scope.row.vesselId"
                  type="primary"
                  class="vessel-link"
                  @click="openVessel(scope.row.vesselId)"
                >
                  {{ scope.row.entry.vesselName }}
                </el-link>
                <span v-else>{{ scope.row.entry.vesselName || '—' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="渔港 · 泊位" min-width="150">
            <template #default="scope">
              <el-link v-if="scope.row.portId" type="primary" @click="openPort(scope.row.portId)">
                {{ scope.row.entry.portName }} · {{ scope.row.entry.berthNo }}
              </el-link>
              <span v-else>{{ scope.row.entry.portName || '—' }} · {{ scope.row.entry.berthNo || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="停靠时段" min-width="200">
            <template #default="scope">
              <span>{{ formatDateTime(scope.row.entry.startTime) }}</span>
              <span class="time-sep">至</span>
              <span>{{ scope.row.entry.endTime ? formatDateTime(scope.row.entry.endTime) : '未离泊' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="加冰 / 加油 / 卸货" min-width="170">
            <template #default="scope">
              {{ scope.row.entry.iceKg }}kg / {{ scope.row.entry.fuelL }}L / {{ scope.row.entry.unloadKg }}kg
            </template>
          </el-table-column>
          <el-table-column label="差异明细" min-width="260">
            <template #default="scope">
              <div v-if="scope.row.diffs.length" class="diff-list" data-testid="diff-list">
                <div v-for="diff in scope.row.diffs" :key="diff.field" class="diff-item">
                  <span class="diff-label">{{ diff.label }}</span>
                  <span class="diff-old">{{ diff.old }}</span>
                  <el-icon class="diff-arrow"><Right /></el-icon>
                  <span class="diff-next">{{ diff.next }}</span>
                </div>
                <p class="diff-hint">原记录已保留；勾选本行后按台账值更新原记录，不新增流水。</p>
              </div>
              <span v-else-if="scope.row.status === '重复'" class="dup-hint">与在库登记时段一致，只保留原记录。</span>
              <span v-else class="dash">—</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
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
  max-width: 900px;
}
.page__head-actions {
  display: flex;
  gap: 8px;
}
.detail-card {
  border-radius: 10px;
}
.card-title {
  font-weight: 600;
  color: #17324d;
}
.upload-icon {
  font-size: 40px;
  color: #409eff;
  margin-bottom: 8px;
}
.upload-text {
  font-size: 13px;
  color: #5b6b7b;
}
.upload-text em {
  color: #409eff;
  font-style: normal;
}
.upload-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #9aa9b6;
}
.file-meta {
  margin: 12px 0 0;
  font-size: 13px;
  color: #5b6b7b;
}
.summary-row {
  margin: 0 !important;
}
.stat-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
}
.stat-card span {
  font-size: 12px;
  color: #7b8a99;
}
.stat-card b {
  font-size: 22px;
  color: #17324d;
}
.stat-card--success b {
  color: #67c23a;
}
.stat-card--info b {
  color: #909399;
}
.stat-card--warning b {
  color: #e6a23c;
}
.stat-card--danger b {
  color: #f56c6c;
}
.apply-bar {
  border-radius: 10px;
}
.apply-bar__actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.dash {
  color: #c0c4cc;
}
.issue-text,
.precheck-reason {
  margin: 4px 0 0;
  font-size: 12px;
  color: #b88230;
  line-height: 1.5;
}
.precheck-reason {
  color: #c45656;
}
.vessel-link {
  margin-left: 8px;
}
.time-sep {
  margin: 0 6px;
  color: #a0aab4;
}
.diff-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.diff-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.diff-label {
  color: #7b8a99;
  width: 56px;
}
.diff-old {
  color: #909399;
  text-decoration: line-through;
}
.diff-arrow {
  color: #409eff;
}
.diff-next {
  color: #17324d;
  font-weight: 600;
}
.diff-hint {
  margin: 4px 0 0;
  font-size: 11px;
  color: #b88230;
}
.dup-hint {
  font-size: 12px;
  color: #909399;
}
</style>
