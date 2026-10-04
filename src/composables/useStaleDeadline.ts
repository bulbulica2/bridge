import { onScopeDispose, watch } from 'vue';

// How long after a deadline the page waits for the backend's PlayingUpdated
// before it rereads the game itself.
export const STALE_GRACE_MS = 2000;

// Some changes happen on the backend at a deadline it sent ahead: a claim
// nobody finished answering is rejected at its `expires_at` (bridge_backend
// docs/API.md, Claims), and a set's next board is dealt at the finished
// board's `next_board_at` (POST /tables/{table}/playing/next). Each is
// broadcast. If that update hasn't arrived `graceMs` later it may have been
// lost (bb#95), so `reload()` rereads the state rather than leave the table
// on something the backend has already moved past. `deadline` is the one to
// wait on, or null when there is none (nothing pending, the page left): any
// change of it drops the timer, and a new deadline arms a new one, so each
// deadline reloads once at most.
export function useStaleDeadline(
  deadline: () => string | null,
  reload: () => void,
  graceMs = STALE_GRACE_MS,
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
