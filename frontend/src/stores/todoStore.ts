import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain } from '../utils/format';
import type { ReconcileTodo, TodoStatus, TodoType } from '../types/todo';
import { TODO_STATUSES } from '../types/todo';
import { syncBus } from '../services/syncBus';

/**
 * 待办：容量不足 / 时段冲突 / 未建档等预检拒绝项的跟进清单。
 * 跨标签页通过 syncBus 广播后自动 reload。
 */
export const useTodoStore = defineStore('todo', () => {
  const todos = ref<ReconcileTodo[]>([]);
  const loading = ref(false);

  const openTodos = computed(() =>
    todos.value
      .filter((t) => t.status === '待处理' || t.status === '处理中')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

  const openCount = computed(() => openTodos.value.length);

  function todosOfPort(portId: string): ReconcileTodo[] {
    return openTodos.value.filter((t) => t.portId === portId);
  }

  function openCountOfPort(portId: string): number {
    return todosOfPort(portId).length;
  }

  async function loadAll(): Promise<void> {
    loading.value = true;
    try {
      todos.value = await db.todos.toArray();
    } finally {
      loading.value = false;
    }
  }

  async function setStatus(id: string, status: TodoStatus): Promise<void> {
    const hit = todos.value.find((t) => t.id === id);
    if (!hit) return;
    const next: ReconcileTodo = {
      ...hit,
      status,
      resolvedAt: status === '已完成' || status === '已忽略' ? new Date().toISOString() : null,
    };
    await db.todos.put(toPlain(next));
    todos.value = todos.value.map((t) => (t.id === id ? next : t));
    syncBus.post('todo-changed');
  }

  async function remove(id: string): Promise<void> {
    await db.todos.delete(id);
    todos.value = todos.value.filter((t) => t.id !== id);
    syncBus.post('todo-changed');
  }

  return {
    todos,
    loading,
    openTodos,
    openCount,
    todosOfPort,
    openCountOfPort,
    loadAll,
    setStatus,
    remove,
    TODO_STATUSES,
  };
});

export type { TodoType };
