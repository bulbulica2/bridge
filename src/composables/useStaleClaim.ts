import { onScopeDispose, watch } from 'vue';

// How long after a claim's `expires_at` the page waits for the backend's
// PlayingUpdated before it rereads the game itself.
export const STALE_CLAIM_GRACE_MS = 2000;

// The backend rejects a claim nobody finished answering at its `expires_at`
// and broadcasts the change (bridge_backend docs/API.md, Claims). If that
// update hasn't arrived `graceMs` later it may have been lost (bb#95), so
// `reload()` rereads the state rather than leave the table on a claim the
// backend has already settled. `deadline` is the pending claim's
// `expires_at`, or null when there is none to wait on (no claim, the page
// left): any change of it drops the timer, and a new deadline arms a new one.
export function useStaleClaim(
  deadline: () => string | null,
  reload: () => void,
  graceMs = STALE_CLAIM_GRACE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  watch(
    deadline,
    (at) => {
      cancel();
      const ms = at ? Date.parse(at) : NaN;
      if (Number.isNaN(ms)) {
        return;
      }
      timer = setTimeout(
        () => {
          timer = null;
          reload();
        },
        Math.max(0, ms + graceMs - Date.now()),
      );
    },
    { immediate: true },
  );

  onScopeDispose(cancel);
}
