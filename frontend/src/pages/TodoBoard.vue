<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useTodoStore } from '../stores/todoStore';
import { formatDateTime } from '../utils/format';
import { TODO_STATUSES, type TodoStatus, type TodoType } from '../types/todo';

const router = useRouter();
const todoStore = useTodoStore();

const statusFilter = ref<'待处理' | '处理中' | '全部'>('待处理');
const typeFilter = ref<TodoType | ''>('');

const TYPE_TAG: Record<TodoType, 'danger' | 'warning' | 'info' | 'primary' | 'success'> = {
  容量不足: 'danger',
  时段冲突: 'warning',
  渔船未建档: 'primary',
  泊位缺失: 'info',
  登记冲突: 'danger',
  其他: 'info',
};

const rows = computed(() => {
  let list = todoStore.todos.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (statusFilter.value !== '全部') list = list.filter((t) => t.status === statusFilter.value);
  if (typeFilter.value) list = list.filter((t) => t.type === typeFilter.value);
  return list;
});

onMounted(async () => {
  if (!todoStore.todos.length) await todoStore.loadAll();
});

function openPort(portId?: string): void {
  if (portId) void router.push(`/ports/${portId}`);
}

async function changeStatus(id: string, status: TodoStatus): Promise<void> {
  await todoStore.setStatus(id, status);
  ElMessage.success(`待办已标记为「${status}」`);
}

async function remove(id: string): Promise<void> {
  await todoStore.remove(id);
  ElMessage.success('待办已删除');
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>待办事项</h1>
        <p class="page__sub">
          台账应用前因渔港容量不足、泊位时段冲突、渔船 / 泊位未建档等被拒绝的记录会自动落到这里，处理后可回到对账页重新导入。
        </p>
      </div>
      <el-tag type="danger" effect="dark" data-testid="todo-count">待处理 {{ todoStore.openCount }}</el-tag>
    </header>

    <el-card shadow="never" class="filter-card">
      <el-radio-group v-model="statusFilter" data-testid="todo-status-filter">
        <el-radio-button value="待处理">待处理</el-radio-button>
        <el-radio-button value="处理中">处理中</el-radio-button>
        <el-radio-button value="全部">全部</el-radio-button>
      </el-radio-group>
      <el-select v-model="typeFilter" placeholder="全部类型" clearable style="width: 150px; margin-left: 12px" data-testid="todo-type-filter">
        <el-option v-for="t in ['容量不足', '时段冲突', '渔船未建档', '泊位缺失', '登记冲突', '其他'] as TodoType[]" :key="t" :label="t" :value="t" />
      </el-select>
    </el-card>

    <el-card shadow="never" class="detail-card">
      <el-table :data="rows" size="small" border empty-text="暂无待办事项" data-testid="todo-table">
        <el-table-column label="类型" width="110">
          <template #default="scope">
            <el-tag size="small" :type="TYPE_TAG[scope.row.type as TodoType]">{{ scope.row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="92">
          <template #default="scope">
            <el-tag size="small" :type="scope.row.status === '已完成' ? 'success' : scope.row.status === '已忽略' ? 'info' : 'warning'" effect="plain">
              {{ scope.row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="事项" min-width="240" />
        <el-table-column prop="reason" label="拒绝 / 处理说明" min-width="280" />
        <el-table-column label="停靠时段" min-width="200">
          <template #default="scope">
            {{ scope.row.startTime ? formatDateTime(scope.row.startTime) : '—' }}
            <span v-if="scope.row.endTime"> 至 {{ formatDateTime(scope.row.endTime) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="scope">
            <el-button v-if="scope.row.portId" text type="primary" size="small" @click="openPort(scope.row.portId)">渔港详情</el-button>
            <el-button
              v-if="scope.row.status === '待处理'"
              text
              type="warning"
              size="small"
              @click="changeStatus(scope.row.id, '处理中')"
            >
              开始处理
            </el-button>
            <el-button
              v-if="scope.row.status === '待处理' || scope.row.status === '处理中'"
              text
              type="success"
              size="small"
              data-testid="todo-resolve"
              @click="changeStatus(scope.row.id, '已完成')"
            >
              完成
            </el-button>
            <el-button
              v-if="scope.row.status === '待处理' || scope.row.status === '处理中'"
              text
              type="info"
              size="small"
              @click="changeStatus(scope.row.id, '已忽略')"
            >
              忽略
            </el-button>
            <el-button text type="danger" size="small" @click="remove(scope.row.id)">删除</el-button>
          </template>
        </el-table-column>
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
  max-width: 860px;
}
.filter-card {
  border-radius: 10px;
}
.detail-card {
  border-radius: 10px;
}
</style>
