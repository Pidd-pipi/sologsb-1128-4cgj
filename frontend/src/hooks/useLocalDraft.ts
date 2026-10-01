import { ref, type Ref } from 'vue';

const DRAFT_PREFIX = 'gbfishport:draft:';

export interface UseLocalDraft<T> {
  storageKey: string;
  draft: Ref<T>;
  savedAt: Ref<string>;
  restored: Ref<boolean>;
  persist: () => void;
  restore: () => boolean;
  clearDraft: () => void;
}

/**
 * 表单草稿：存 localStorage（与业务数据走 IndexedDB 区分开）。
 * 页面挂载时 restore()，字段变更时 persist()，提交成功后 clearDraft()。
 */
export function useLocalDraft<T extends object>(name: string, initial: () => T): UseLocalDraft<T> {
  const storageKey = `${DRAFT_PREFIX}${name}`;
  const draft = ref(initial()) as Ref<T>;
  const savedAt = ref('');
  const restored = ref(false);

  function persist(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft.value));
      savedAt.value = new Date().toISOString();
    } catch {
      // localStorage 不可用（隐私模式等）时静默降级，不影响主流程
    }
  }

  function restore(): boolean {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as Partial<T>;
      draft.value = { ...initial(), ...parsed } as T;
      restored.value = true;
      savedAt.value = new Date().toISOString();
      return true;
    } catch {
      return false;
    }
  }

  function clearDraft(): void {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 忽略
    }
    restored.value = false;
    savedAt.value = '';
  }

  return { storageKey, draft, savedAt, restored, persist, restore, clearDraft };
}
