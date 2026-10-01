import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
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
    // The game at one table: the board, the four players and your own hand.
    // Entered from the detail page (automatically when a board is dealt).
    path: '/tables/:id/play',
    component: () => import('@/views/TablePlayPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    // The user's finished boards (the menu's "My boards"), paged in as it scrolls.
    path: '/history',
    component: () => import('@/views/HistoryPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    // One board's results at every table, with matchpoints. Reached from a
    // board's replay or a finished board's result panel; 403 unless the user
    // has finished that board.
    path: '/boards/:id/results',
    component: () => import('@/views/BoardResultsPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    // One finished playing replayed trick by trick: its auction, the play
    // and the result. Reached from a history entry or a board's results row;
    // 403 unless the user has finished that board.
    path: '/playings/:id',
    component: () => import('@/views/PlayingReviewPage.vue'),
    meta: { requiresAuth: true }
  },
  {
    // A player's public profile. Reached from the profile sheet a seated
    // player opens, not from the menu.
    path: '/users/:id',
    component: () => import('@/views/UserProfilePage.vue'),
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
  prefetchBids();
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

// The bid list (GET /bids) is the same for every table and only needed on the
// user's turn to call, so it is read once in the background a moment after a
// logged-in page is up (after login, or the first page of a reload) instead of
// on the way into a table, where it would queue ahead of the board itself.
let bidsTimer: ReturnType<typeof setTimeout> | null = null;
function prefetchBids() {
  const auth = useAuthStore();
  const game = useGameStore();
  if (!auth.isAuthenticated || game.bids.length > 0 || bidsTimer !== null) {
    return;
  }
  bidsTimer = setTimeout(() => {
    bidsTimer = null;
    if (auth.isAuthenticated) {
      game.loadBids().catch(() => {
        // Only a head start; the game page asks again and shows its own error.
      });
    }
  }, 1000);
}

export default router
