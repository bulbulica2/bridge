import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteLocationNormalized, RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useTablesStore } from '@/stores/tables';
import { navigationEnded, navigationStarted } from './loading';

declare module 'vue-router' {
  interface RouteMeta {
    /** Only reachable while logged in; guests are sent to /login. */
    requiresAuth?: boolean;
    /** Only reachable while logged out; logged-in users are sent to /account. */
    guestOnly?: boolean;
    /** Closed to a banned user (the game itself); they are sent to /tables. */
    notBanned?: boolean;
    /**
     * The page finds the user's seat itself (it loads the Tables list or its
     * own table), so the router doesn't ask for it on the way in.
     */
    findsSeat?: boolean;
  }
}

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/home'
  },
  {
    path: '/home',
    component: () => import('@/views/HomePage.vue'),
    meta: { findsSeat: true }
  },
  {
    path: '/login',
    component: () => import('@/views/LoginPage.vue'),
    meta: { guestOnly: true }
  },
  {
    path: '/tables',
    component: () => import('@/views/TablesPage.vue'),
    meta: { requiresAuth: true, findsSeat: true }
  },
  {
    // One table: its four seats and the actions on them. Reached from the
    // Tables list, not from the menu.
    path: '/tables/:id',
    component: () => import('@/views/TableDetailPage.vue'),
    meta: { requiresAuth: true, notBanned: true, findsSeat: true }
  },
  {
    // The game at one table: the board, the four players and your own hand.
    // Entered from the detail page (automatically when a board is dealt).
    path: '/tables/:id/play',
    component: () => import('@/views/TablePlayPage.vue'),
    meta: { requiresAuth: true, notBanned: true, findsSeat: true }
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
    // One set of four boards: each board's result, the totals and the
    // winner. Reached from a set in "My boards"; 403 unless the user played
    // in it or has finished all its boards.
    path: '/sets/:id',
    component: () => import('@/views/SetResultsPage.vue'),
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

// Enforces the requiresAuth / guestOnly / notBanned route meta. loadSession() asks the
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
  // Every game action would 403 (bridge_backend docs/AUTH.md, Bans): the
  // lobby stays readable, with the ban in place of its actions.
  if (to.meta.notBanned && auth.isBanned) {
    return { path: '/tables' };
  }
  return true;
})

// afterEach also runs for aborted and duplicated navigations; onError covers
// the ones that throw (e.g. a lazy chunk that fails to load).
router.afterEach((to) => {
  navigationEnded(to.fullPath);
  prefetchPages();
  prefetchGameLists();
  findSeat(to);
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

// The bid list (GET /bids) and the card list (GET /cards) are the same for
// every table: the bids are needed on the user's turn to call, and both to
// read a `PlayingUpdated` (cards and calls come as ids). So they are read
// once in the background a moment after a logged-in page is up (after login,
// or the first page of a reload) instead of on the way into a table, where
// they would queue ahead of the board itself.
let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
function prefetchGameLists() {
  const auth = useAuthStore();
  const game = useGameStore();
  const held = game.bids.length > 0 && game.cards.length > 0;
  if (!auth.isAuthenticated || held || prefetchTimer !== null) {
    return;
  }
  prefetchTimer = setTimeout(() => {
    prefetchTimer = null;
    if (auth.isAuthenticated) {
      // Only a head start; the game page and the game store ask again.
      game.loadBids().catch(() => {});
      game.loadCards().catch(() => {});
    }
  }, 1000);
}

// The header's and menu's "Your table" (useYourTable) need the user's seat
// on every page, not only once the Tables list has loaded: after a reload on
// My boards, say, nothing else asks. A page that finds it itself
// (`findsSeat`) is left to it, so its own requests don't queue behind this
// one (the local backend answers one at a time). Banned users get no
// shortcut, so they aren't asked for.
function findSeat(to: RouteLocationNormalized) {
  const auth = useAuthStore();
  if (auth.isAuthenticated && !auth.isBanned && !to.meta.findsSeat) {
    useTablesStore().findSeat();
  }
}

export default router
