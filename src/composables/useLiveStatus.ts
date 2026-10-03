import { computed, onScopeDispose, ref, watch } from 'vue';
import { isLive } from '@/services/liveStatus';

// How long live updates must stay off before the page says so, so the first
// connection or a brief reconnect doesn't flash a Refresh button.
export const OFFLINE_GRACE_MS = 5000;

/**
 * Whether the table `tableId()` gets live updates (`live`), and whether they
 * have been off for `OFFLINE_GRACE_MS` (`offline`): the cue for the table
 * pages to offer Refresh.
 */
export function useLiveStatus(tableId: () => number) {
  const live = computed(() => isLive(tableId()));
  const offline = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stop() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  watch(
    live,
    (on) => {
      stop();
      offline.value = false;
      if (!on) {
        timer = setTimeout(() => {
          timer = null;
          offline.value = true;
        }, OFFLINE_GRACE_MS);
      }
    },
    { immediate: true },
  );

  onScopeDispose(stop);

  return { live, offline };
}
