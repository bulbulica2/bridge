import { onBeforeUnmount, onMounted, watch } from 'vue';
import type { Ref, WatchSource } from 'vue';

// Keeps an element at the tallest it has been, so it doesn't shrink as its
// content goes: a hand of large cards wraps onto fewer rows as cards are
// played, and the page below it would jump (#133, #136). `restart` changing
// (a new deal, another card size) or the element's width changing (a turned
// phone) starts over from its natural height. Without ResizeObserver it
// does nothing.
export function useSteadyHeight(target: Ref<HTMLElement | null>, restart: WatchSource) {
  let tallest = 0;
  let width = -1;
  let observer: ResizeObserver | null = null;

  function measure(fresh = false) {
    const el = target.value;
    if (!el) {
      return;
    }
    el.style.minHeight = '';
    const box = el.getBoundingClientRect();
    if (fresh || box.width !== width) {
      tallest = 0;
      width = box.width;
    }
    tallest = Math.max(tallest, box.height);
    el.style.minHeight = `${tallest}px`;
  }

  onMounted(() => {
    if (typeof ResizeObserver !== 'function' || !target.value) {
      return;
    }
    observer = new ResizeObserver(() => measure());
    observer.observe(target.value);
  });

  watch(
    restart,
    () => {
      if (observer) {
        measure(true);
      }
    },
    { flush: 'post' },
  );

  onBeforeUnmount(() => observer?.disconnect());
}
