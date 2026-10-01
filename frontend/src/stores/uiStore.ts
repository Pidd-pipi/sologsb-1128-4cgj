import { defineStore } from 'pinia';
import { ref } from 'vue';

export type NoticeType = 'success' | 'warning' | 'info' | 'error';

export interface Notice {
  id: number;
  text: string;
  type: NoticeType;
}

let noticeSeq = 0;

/**
 * 全局 UI 状态：当前聚焦渔港、地图模式偏好与轻提示队列。
 */
export const useUiStore = defineStore('ui', () => {
  const selectedPortId = ref<string>('');
  const preferGridMap = ref<boolean>(true);
  const notices = ref<Notice[]>([]);

  function selectPort(portId: string): void {
    selectedPortId.value = portId;
  }

  function setPreferGridMap(value: boolean): void {
    preferGridMap.value = value;
  }

  function notify(text: string, type: NoticeType = 'success'): void {
    noticeSeq += 1;
    notices.value = [...notices.value, { id: noticeSeq, text, type }];
  }

  function consumeNotices(): Notice[] {
    const list = notices.value;
    notices.value = [];
    return list;
  }

  return { selectedPortId, preferGridMap, notices, selectPort, setPreferGridMap, notify, consumeNotices };
});
