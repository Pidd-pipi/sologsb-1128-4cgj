import { onBeforeUnmount, ref, type Ref } from 'vue';

export type AmapStatus = 'fallback' | 'idle' | 'loading' | 'ready' | 'error';

const SCRIPT_ID = 'amap-js-api-script';
const LOAD_TIMEOUT = 8000;

let inflight: Promise<boolean> | null = null;

export interface UseAmapLoader {
  key: string;
  hasKey: boolean;
  status: Ref<AmapStatus>;
  reason: Ref<string>;
  load: () => Promise<boolean>;
}

/**
 * 按需注入高德地图 JS API。
 * - `VITE_AMAP_KEY` 为空时**立即**返回降级标记，绝不请求 webapi.amap.com（否则网络失败会污染 console）
 * - 有 key 时用 onerror + 超时兜底，加载失败同样降级为本地 SVG 网格视图
 */
export function useAmapLoader(): UseAmapLoader {
  const key = String(import.meta.env.VITE_AMAP_KEY ?? '').trim();
  const hasKey = key.length > 0;
  const status = ref<AmapStatus>(hasKey ? 'idle' : 'fallback');
  const reason = ref(
    hasKey ? '已配置 VITE_AMAP_KEY，点击加载高德地图' : '未配置 VITE_AMAP_KEY，当前使用本地 SVG 网格视图',
  );
  let timer: number | undefined;

  function clearTimer(): void {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  }

  function injectScript(): Promise<boolean> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return Promise.resolve(false);
    }
    if (window.__AMAP_LOADED__ && window.AMap) return Promise.resolve(true);
    if (inflight) return inflight;

    inflight = new Promise<boolean>((resolve) => {
      const existing = document.getElementById(SCRIPT_ID);
      const finish = (ok: boolean): void => {
        clearTimer();
        if (ok) {
          window.__AMAP_LOADED__ = true;
        }
        resolve(ok);
      };
      timer = window.setTimeout(() => finish(false), LOAD_TIMEOUT);

      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      existing?.remove();
      document.head.appendChild(script);
    });
    return inflight;
  }

  async function load(): Promise<boolean> {
    if (!hasKey) {
      status.value = 'fallback';
      reason.value = '未配置 VITE_AMAP_KEY，当前使用本地 SVG 网格视图';
      return false;
    }
    status.value = 'loading';
    reason.value = '正在加载高德地图 JS API…';
    let ok = false;
    try {
      ok = await injectScript();
    } catch {
      ok = false;
    }
    if (ok) {
      status.value = 'ready';
      reason.value = '高德地图 JS API 已就绪';
    } else {
      status.value = 'fallback';
      reason.value = '高德地图 JS API 加载失败或超时，已降级为本地 SVG 网格视图';
      inflight = null;
    }
    return ok;
  }

  onBeforeUnmount(clearTimer);

  return { key, hasKey, status, reason, load };
}
