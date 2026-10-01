<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  {
    title: '暂无数据',
    description: '当前条件下没有匹配的记录，可调整筛选条件或新增一条。',
  },
);
</script>

<template>
  <div class="empty-state" data-testid="empty-state">
    <svg viewBox="0 0 120 80" class="empty-state__art" aria-hidden="true">
      <rect x="8" y="30" width="104" height="8" rx="4" fill="#d7e3ee" />
      <path d="M24 30l10-18h32l10 18z" fill="#e8f1f8" stroke="#c3d7e8" stroke-width="2" />
      <path d="M30 66h60l-8 10H38z" fill="#eaf2f9" />
      <circle cx="96" cy="20" r="8" fill="#f0f5fa" />
    </svg>
    <p class="empty-state__title">{{ title }}</p>
    <p class="empty-state__desc">{{ description }}</p>
    <div class="empty-state__action">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  border: 1px dashed #c8d8e6;
  border-radius: 10px;
  background: #fbfdff;
  text-align: center;
}
.empty-state__art {
  width: 120px;
  height: 80px;
}
.empty-state__title {
  margin: 8px 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: #34495e;
}
.empty-state__desc {
  margin: 0;
  font-size: 13px;
  color: #7b8a99;
  max-width: 420px;
}
.empty-state__action:not(:empty) {
  margin-top: 12px;
}
</style>
