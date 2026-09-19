import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/home'
  },
  {
    path: '/home',
    component: () => import('@/views/HomePage.vue')
  },
  {
    path: '/login',
    component: () => import('@/views/LoginPage.vue')
  },
  {
    path: '/create-account',
    component: () => import('@/views/CreateAccountPage.vue'),
    meta: { guestOnly: true }
  },
  {
    path: '/reset-password',
    component: () => import('@/views/ResetPasswordPage.vue'),
    meta: { guestOnly: true }
  },
  {
    // Target of the reset link bridge_backend emails
    // (/password-reset/:token?email=…); same page, second stage.
    path: '/password-reset/:token',
    component: () => import('@/views/ResetPasswordPage.vue'),
    meta: { guestOnly: true }
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router
