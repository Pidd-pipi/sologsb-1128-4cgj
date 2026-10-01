<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Bell, FolderOpened, Location, MapLocation, Tickets, Van } from '@element-plus/icons-vue';
import { useUiStore } from './stores/uiStore';
import { useTodoStore } from './stores/todoStore';
import { useCrossTabSync } from './hooks/useCrossTabSync';

const route = useRoute();
const uiStore = useUiStore();
const todoStore = useTodoStore();

useCrossTabSync();

const activePath = computed(() => {
  const path = route.path;
  if (path === '/' || path.startsWith('/ports')) return '/';
  if (path.startsWith('/vessels')) return '/vessels';
  if (path.startsWith('/reconcile')) return '/reconcile';
  if (path.startsWith('/calls')) return '/calls';
  if (path.startsWith('/todos')) return '/todos';
  if (path.startsWith('/map')) return '/map';
  return path;
});

onMounted(() => {
  void todoStore.loadAll();
});

watch(
  () => uiStore.notices.length,
  () => {
    for (const notice of uiStore.consumeNotices()) {
      ElMessage({ message: notice.text, type: notice.type });
    }
  },
);
</script>

<template>
  <el-container class="app">
    <el-header class="app__header">
      <div class="app__brand">
        <img src="/favicon.svg" alt="渔港与渔船档案地图" class="app__logo" />
        <div>
          <p class="app__title">渔港与渔船档案地图</p>
          <p class="app__subtitle">泊位条件 · 渔船档案 · 进出港动态 · 台账对账</p>
        </div>
      </div>
      <el-menu :default-active="activePath" mode="horizontal" router class="app__menu" :ellipsis="false">
        <el-menu-item index="/">
          <el-icon><Location /></el-icon>
          渔港一览
        </el-menu-item>
        <el-menu-item index="/vessels">
          <el-icon><Van /></el-icon>
          渔船检索
        </el-menu-item>
        <el-menu-item index="/reconcile">
          <el-icon><FolderOpened /></el-icon>
          台账对账
        </el-menu-item>
        <el-menu-item index="/calls">
          <el-icon><Tickets /></el-icon>
          进出港登记
        </el-menu-item>
        <el-menu-item index="/todos">
          <el-icon><Bell /></el-icon>
          待办
          <el-badge v-if="todoStore.openCount" :value="todoStore.openCount" :max="99" class="todo-badge" />
        </el-menu-item>
        <el-menu-item index="/map">
          <el-icon><MapLocation /></el-icon>
          地图分布
        </el-menu-item>
      </el-menu>
    </el-header>

    <el-main class="app__main">
      <router-view />
    </el-main>

    <el-footer class="app__footer">
      纯前端单页应用 · 数据保存在浏览器 IndexedDB（gbfishport-db）与 localStorage 草稿中，不依赖任何后端服务 · 多标签页泊位写入带乐观锁，互不覆盖
    </el-footer>
  </el-container>
</template>

<style scoped>
.app {
  min-height: 100vh;
}
.app__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  height: auto;
  padding: 12px 24px;
  background: #ffffff;
  border-bottom: 1px solid #e7eef5;
  position: sticky;
  top: 0;
  z-index: 10;
}
.app__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.app__logo {
  width: 38px;
  height: 38px;
}
.app__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #12395c;
}
.app__subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: #8592a0;
}
.app__menu {
  border-bottom: none;
}
.todo-badge {
  margin-left: 6px;
}
.app__main {
  padding: 20px 24px 8px;
  background: #f5f8fb;
}
.app__footer {
  display: flex;
  align-items: center;
  justify-content: center;
  height: auto;
  padding: 14px;
  font-size: 12px;
  color: #8592a0;
  background: #ffffff;
  border-top: 1px solid #e7eef5;
}
</style>
