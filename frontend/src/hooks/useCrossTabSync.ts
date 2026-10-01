import { onBeforeUnmount, onMounted } from 'vue';
import { usePortStore } from '../stores/portStore';
import { useVesselStore } from '../stores/vesselStore';
import { useTodoStore } from '../stores/todoStore';
import { syncBus } from '../services/syncBus';

/**
 * 跨标签页 / 旧标签页数据同步：
 * - 收到其他标签页广播的数据变更，或页面重新变为可见时，重新从 IndexedDB 装载，
 *   避免用旧内存快照覆盖他页的修改（泊位并发保护的第二道防线）。
 * - berth-locked 消息给出明确提示。
 */
export function useCrossTabSync(): void {
  let reloadTimer: number | undefined;

  function scheduleReload(): void {
    if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => {
      const portStore = usePortStore();
      const vesselStore = useVesselStore();
      const todoStore = useTodoStore();
      void Promise.all([portStore.loadAll(), vesselStore.loadAll(), todoStore.loadAll()]);
    }, 150);
  }

  function onVisibility(): void {
    if (document.visibilityState === 'visible') scheduleReload();
  }

  const off = syncBus.on((message) => {
    if (message.type === 'data-changed' || message.type === 'todo-changed') {
      scheduleReload();
    }
  });

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', scheduleReload);
  });

  onBeforeUnmount(() => {
    off();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', scheduleReload);
    if (reloadTimer !== undefined) window.clearTimeout(reloadTimer);
  });
}
