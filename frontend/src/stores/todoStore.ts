import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import type { Todo, TodoKind, TodoStatus } from '../types/todo';
import { broadcastDataChanged } from '../utils/sync';

export interface TodoInput {
  kind: TodoKind;
  title: string;
  detail: string;
  vesselNo?: string;
  portName?: string;
  berthNo?: string;
  batchId?: string | null;
}

/**
 * 对账待办：台账应用前容量 / 时段冲突检查被拒后留下，需人工跟进。
 */
export const useTodoStore = defineStore('todo', () => {
  const todos = ref<Todo[]>([]);
  const loading = ref(false);

  const openCount = computed(() => todos.value.filter((t) => t.status === 'open').length);

  const openTodos = computed(() =>
    todos.value
      .filter((t) => t.status === 'open')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  );

  async function loadAll(): Promise<void> {
    loading.value = true;
    try {
      todos.value = await db.todos.orderBy('createdAt').toArray();
    } finally {
      loading.value = false;
    }
  }

  async function addTodo(input: TodoInput): Promise<Todo> {
    const todo: Todo = {
      id: uid('todo'),
      kind: input.kind,
      status: 'open',
      title: input.title,
      detail: input.detail,
      vesselNo: input.vesselNo ?? '',
      portName: input.portName ?? '',
      berthNo: input.berthNo ?? '',
      batchId: input.batchId ?? null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    await db.todos.put(toPlain(todo));
    todos.value = [...todos.value, todo];
    broadcastDataChanged();
    return todo;
  }

  async function setStatus(id: string, status: TodoStatus): Promise<void> {
    const hit = todos.value.find((t) => t.id === id);
    if (!hit) return;
    const next: Todo = {
      ...hit,
      status,
      resolvedAt: status === 'open' ? null : new Date().toISOString(),
    };
    await db.todos.put(toPlain(next));
    todos.value = todos.value.map((t) => (t.id === id ? next : t));
    broadcastDataChanged();
  }

  return { todos, loading, openCount, openTodos, loadAll, addTodo, setStatus };
});
