/**
 * 跨标签页同步总线：
 * - 同浏览器内优先用 BroadcastChannel；不支持时降级到 localStorage storage 事件。
 * - 业务数据（泊位 / 流水 / 待办）写入后广播 'data-changed'，其他标签页重新从 IndexedDB 装载，
 *   避免停留在旧内存快照上覆盖他页修改。
 */

export type SyncMessageType = 'data-changed' | 'berth-locked' | 'todo-changed';

export interface SyncMessage {
  type: SyncMessageType;
  /** 变更泊位 id（乐观锁冲突提示用） */
  berthId?: string;
  /** 发送页面标识，避免自己收到自己 */
  origin: string;
  at: number;
}

const CHANNEL_NAME = 'gbfishport-sync';
const STORAGE_KEY = 'gbfishport:sync';

export type SyncHandler = (message: SyncMessage) => void;

function createOrigin(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class SyncBus {
  readonly origin = createOrigin();
  private channel: BroadcastChannel | null = null;
  private handlers = new Set<SyncHandler>();

  constructor() {
    if (typeof window === 'undefined') return;
    const ChannelCtor = window.BroadcastChannel;
    if (ChannelCtor) {
      this.channel = new ChannelCtor(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<SyncMessage>) => this.dispatch(event.data);
    } else {
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY || !event.newValue) return;
        try {
          this.dispatch(JSON.parse(event.newValue) as SyncMessage);
        } catch {
          // 忽略无法解析的消息
        }
      });
    }
  }

  private dispatch(message: SyncMessage): void {
    if (!message || message.origin === this.origin) return;
    this.handlers.forEach((handler) => handler(message));
  }

  post(type: SyncMessageType, extra: Partial<SyncMessage> = {}): void {
    const message: SyncMessage = { type, origin: this.origin, at: Date.now(), ...extra };
    if (this.channel) {
      this.channel.postMessage(message);
    } else if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
      } catch {
        // 存储不可用时忽略
      }
    }
  }

  on(handler: SyncHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export const syncBus = new SyncBus();
