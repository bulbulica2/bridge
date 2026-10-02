import { onScopeDispose, ref, watch } from 'vue';

/**
 * The time now (ms), ticking every `intervalMs` while `active()` is true, for
 * a countdown on screen. Only the display ticks: the deadline itself comes
 * from the backend (a seat's `forfeit_at`), never from this clock.
 */
export function useNow(active: () => boolean, intervalMs = 1000) {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  watch(
    active,
    (on) => {
      stop();
      if (on) {
        now.value = Date.now();
        timer = setInterval(() => (now.value = Date.now()), intervalMs);
      }
    },
    { immediate: true },
  );

  onScopeDispose(stop);

  return now;
}
