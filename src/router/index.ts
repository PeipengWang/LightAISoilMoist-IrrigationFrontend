import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('../views/LayoutView.vue'),
      redirect: '/realtime',
      children: [
        {
          path: 'realtime',
          name: 'Realtime',
          component: () => import('../views/RealTimeView.vue'),
          meta: { title: '实时数据监测' },
        },
        {
          path: 'history',
          name: 'History',
          component: () => import('../views/HistoryView.vue'),
          meta: { title: '历史数据分析' },
        },
        {
          path: 'decision',
          name: 'Decision',
          component: () => import('../views/DecisionView.vue'),
          meta: { title: '智能决策管理' },
        },
        {
          path: 'thresholds',
          name: 'Thresholds',
          component: () => import('../views/ThresholdConfigView.vue'),
          meta: { title: '阈值配置管理' },
        },
      ],
    },
  ],
})

export default router