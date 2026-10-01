import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'port-list',
    component: () => import('../pages/PortList.vue'),
    meta: { title: '渔港一览' },
  },
  {
    path: '/ports/:id',
    name: 'port-detail',
    component: () => import('../pages/PortDetail.vue'),
    meta: { title: '渔港详情' },
  },
  {
    path: '/vessels',
    name: 'vessel-list',
    component: () => import('../pages/VesselList.vue'),
    meta: { title: '渔船检索' },
  },
  {
    path: '/vessels/:id',
    name: 'vessel-detail',
    component: () => import('../pages/VesselDetail.vue'),
    meta: { title: '渔船档案' },
  },
  {
    path: '/calls',
    name: 'call-board',
    component: () => import('../pages/CallBoard.vue'),
    meta: { title: '进出港登记' },
  },
  {
    path: '/map',
    name: 'map-view',
    component: () => import('../pages/MapView.vue'),
    meta: { title: '渔港分布' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? '';
  document.title = title ? `${title} · 渔港与渔船档案地图` : '渔港与渔船档案地图';
});

export default router;
