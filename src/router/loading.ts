import { readonly, ref } from 'vue';
import type { UseIonRouterResult } from '@ionic/vue';

type NavigateArgs = Parameters<UseIonRouterResult['navigate']>;

// Fast navigations finish before this, so the bar never flickers for them.
const SHOW_DELAY_MS = 150;

const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
// The route the in-flight navigation is heading to. A guard redirect replaces
// it; a navigation cancelled by a newer one ends with a different `to`, which
// must not stop the bar the newer one still needs.
let pendingPath: string | null = null;
let waiters: Array<() => void> = [];

/** True while a navigation has been running for longer than SHOW_DELAY_MS. */
export const routeLoading = readonly(visible);

/** Called from router.beforeEach. */
export function navigationStarted(path: string) {
  pendingPath = path;
  if (timer === null && !visible.value) {
    timer = setTimeout(() => {
      timer = null;
      visible.value = true;
    }, SHOW_DELAY_MS);
  }
}

/**
 * Called from router.afterEach (with the target path) and router.onError
 * (without one, since a failed chunk load always ends the navigation).
 */
export function navigationEnded(path?: string) {
  if (path !== undefined && pendingPath !== null && path !== pendingPath) {
    return;
  }
  pendingPath = null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  visible.value = false;
  const settled = waiters;
  waiters = [];
  settled.forEach((resolve) => resolve());
}

/** Resolves when the next navigation has finished (or failed). */
export function nextNavigationSettled(): Promise<void> {
  return new Promise((resolve) => waiters.push(resolve));
}

/**
 * ionRouter.navigate() keeps Ionic's page transition but returns nothing, so a
 * form that must stay busy until the next page is up awaits this instead.
 */
export function navigateAndSettle(
  ionRouter: UseIonRouterResult,
  path: string,
  direction: NavigateArgs[1] = 'root',
  action: NavigateArgs[2] = 'replace',
): Promise<void> {
  const settled = nextNavigationSettled();
  ionRouter.navigate(path, direction, action);
  return settled;
}
