import { ref, type Ref } from 'vue';

const DRAFT_PREFIX = 'gbfishport:draft:';

/** 旧标签页误覆盖检测：比草稿内容新的记录会把旧页的静默保存挡掉 */
export const DRAFT_BEATEN_EVENT = 'gbfishport:draft-beaten';

interface DraftEnvelope<T> {
  value: T;
  /** 最近一次写入时间戳（毫秒） */
  at: number;
  /** 最近写入页面标识 */
  origin: string;
}

export interface UseLocalDraft<T> {
  storageKey: string;
  draft: Ref<T>;
  savedAt: Ref<string>;
  restored: Ref<boolean>;
  /** 草稿是否已被其他标签页更新（当前页为旧版本，保存会被拦截） */
  staleByOtherTab: Ref<boolean>;
  persist: () => void;
  restore: () => boolean;
  clearDraft: () => void;
  /** 放弃当前页旧草稿，改用最新草稿 */
  adoptRemote: () => boolean;
}

function ownOrigin(): string {
  if (typeof window === 'undefined') return 'ssr';
  const w = window as unknown as { __gbfishportOrigin?: string };
  if (!w.__gbfishportOrigin) {
    w.__gbfishportOrigin = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return w.__gbfishportOrigin;
}

/**
 * 表单草稿：存 localStorage（与业务数据走 IndexedDB 区分开）。
 * 页面挂载时 restore()，字段变更时 persist()，提交成功后 clearDraft()。
 * 多标签页保护：草稿带时间戳与来源页标识，旧标签页（restoreAt 早于最新写入）的静默
 * persist() 会被拦截并派发 DRAFT_BEATEN_EVENT，防止手工补录被旧页面盖掉。
 */
export function useLocalDraft<T extends object>(name: string, initial: () => T): UseLocalDraft<T> {
  const storageKey = `${DRAFT_PREFIX}${name}`;
  const origin = ownOrigin();
  const draft = ref(initial()) as Ref<T>;
  const savedAt = ref('');
  const restored = ref(false);
  const staleByOtherTab = ref(false);
  /** 本页载入草稿时的版本时间戳 */
  let baselineAt = 0;

  function readEnvelope(): DraftEnvelope<T> | null {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DraftEnvelope<T> | T;
      if (parsed && typeof parsed === 'object' && 'value' in parsed && 'at' in parsed) {
        return parsed as DraftEnvelope<T>;
      }
      // 兼容旧格式（直接存的表单对象）
      return { value: parsed as T, at: 0, origin: '' };
    } catch {
      return null;
    }
  }

  function writeEnvelope(value: T): void {
    const envelope: DraftEnvelope<T> = { value, at: Date.now(), origin };
    baselineAt = envelope.at;
    try {
      localStorage.setItem(storageKey, JSON.stringify(envelope));
      savedAt.value = new Date().toISOString();
    } catch {
      // localStorage 不可用（隐私模式等）时静默降级，不影响主流程
    }
  }

  function persist(): void {
    if (staleByOtherTab.value) return;
    const remote = readEnvelope();
    if (remote && remote.origin !== origin && remote.at > baselineAt) {
      // 另一个标签页已经写入了更新的草稿，旧页不再静默覆盖
      staleByOtherTab.value = true;
      window.dispatchEvent(new CustomEvent(DRAFT_BEATEN_EVENT, { detail: { storageKey, at: remote.at } }));
      return;
    }
    writeEnvelope(draft.value);
  }

  function applyEnvelope(envelope: DraftEnvelope<T>): void {
    draft.value = { ...initial(), ...envelope.value } as T;
    baselineAt = envelope.at;
    restored.value = true;
    staleByOtherTab.value = false;
    savedAt.value = new Date(envelope.at || Date.now()).toISOString();
  }

  function restore(): boolean {
    const envelope = readEnvelope();
    if (!envelope) return false;
    applyEnvelope(envelope);
    return true;
  }

  function adoptRemote(): boolean {
    const envelope = readEnvelope();
    if (!envelope) return false;
    applyEnvelope(envelope);
    return true;
  }

  function clearDraft(): void {
    try {
      // 只有最新版本的页面才能清空，避免旧页把新页草稿删掉
      const remote = readEnvelope();
      if (!remote || remote.origin === origin || remote.at <= baselineAt) {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // 忽略
    }
    baselineAt = 0;
    restored.value = false;
    staleByOtherTab.value = false;
    savedAt.value = '';
  }

  // 其他标签页写入草稿时实时感知
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== storageKey) return;
      const envelope = readEnvelope();
      if (!envelope) return;
      if (envelope.origin === origin) return;
      if (envelope.at > baselineAt) {
        staleByOtherTab.value = true;
      }
    });
  }

  return { storageKey, draft, savedAt, restored, staleByOtherTab, persist, restore, clearDraft, adoptRemote };
}
