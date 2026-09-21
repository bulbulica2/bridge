import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { navigationEnded, navigationStarted } from './loading';

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
    // One table: its four seats and the actions on them. Reached from the
    // Tables list, not from the menu.
    path: '/tables/:id',
    component: () => import('@/views/TableDetailPage.vue'),
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
  navigationStarted(to.fullPath);
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

// afterEach also runs for aborted and duplicated navigations; onError covers
// the ones that throw (e.g. a lazy chunk that fails to load).
router.afterEach((to) => {
  navigationEnded(to.fullPath);
  prefetchPages();
})
router.onError(() => {
  navigationEnded();
})

// Every page is a lazy chunk, and the first visit to one waits for it (in dev,
// Vite even compiles it on that first request). Once the first page is up,
// fetch the rest in the background so later navigations don't pay that cost.
let prefetched = false;
function prefetchPages() {
  if (prefetched) {
    return;
  }
  prefetched = true;
  setTimeout(() => {
    for (const route of routes) {
      if (typeof route.component === 'function') {
        (route.component as () => Promise<unknown>)().catch(() => {
          // Only a head start; the real navigation retries and reports errors.
        });
      }
    }
  }, 1000);
}

export default router
