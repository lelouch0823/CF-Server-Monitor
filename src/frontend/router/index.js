import { createRouter, createWebHashHistory } from 'vue-router'
import { normalizeAdminEntryUrl } from './adminEntryUrl.js'

// 归一化必须先于 createWebHashHistory()：hash history 在创建时就用当前 URL 快照 base 与初始路由，
// 之后再 replaceState 只改地址栏。放在同一模块内执行，避免依赖 import 的求值顺序。
normalizeAdminEntryUrl()

export const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/Dashboard.vue')
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('../views/admin/index.vue')
  },
  {
    path: '/server/:id',
    name: 'Server',
    component: () => import('../views/ServerDetail.vue')
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    redirect: '/'
  }
]

export const scrollBehavior = (_to, _from, savedPosition) => {
  if (savedPosition) {
    return savedPosition
  }
  return { top: 0, left: 0 }
}

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior
})

export default router
