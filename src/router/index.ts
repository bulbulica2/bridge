import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    /** Only reachable while logged in; guests are sent to /login. */
    requiresAuth?: boolean;
    /** Only reachable while logged out; logged-in users are sent to /account. */
    guestOnly?: boolean;
  }
}

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
    component: () => import('@/views/LoginPage.vue'),
    meta: { guestOnly: true }
  },
  {
    path: '/tables',
    component: () => import('@/views/TablesPage.vue'),
    meta: { requiresAuth: true }
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
  },
  {
    path: '/account',
    component: () => import('@/views/AccountPage.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

// Enforces the requiresAuth / guestOnly route meta. loadSession() asks the
// backend once per page load whether the Sanctum session cookie is still valid,
// so a reload on an auth-only page doesn't bounce a logged-in user to /login.
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.loadSession();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login' };
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { path: '/account' };
  }
  return true;
})

export default router
