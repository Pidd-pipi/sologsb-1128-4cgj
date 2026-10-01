/**
 * 跨标签页数据同步：任一标签页写入后广播 data-changed，
 * 其他标签页收到后重新拉取 IndexedDB，保证渔港详情、地图、渔船档案
 * 同步显示整理结果，且不会用旧数据覆盖新数据（配合乐观锁）。
 */
const CHANNEL_NAME = 'gbfishport-sync';

type ChangeHandler = () => void;

function getChannel(): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel === 'undefined') return null;
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/** 广播一次数据变更（写入成功后调用） */
export function broadcastDataChanged(): void {
  const ch = getChannel();
  if (!ch) return;
  try {
    ch.postMessage({ type: 'data-changed', at: Date.now() });
    ch.close();
  } catch {
    // 广播不可用时静默降级
  }
}

/** 订阅其他标签页的数据变更，返回取消订阅函数 */
export function onDataChanged(handler: ChangeHandler): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const listener = (event: MessageEvent): void => {
    if (event.data && event.data.type === 'data-changed') handler();
  };
  ch.addEventListener('message', listener);
  return () => {
    ch.removeEventListener('message', listener);
    ch.close();
  };
}
