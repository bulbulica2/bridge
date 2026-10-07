import { onBeforeUnmount, watch } from 'vue';
import type { Ref, WatchSource } from 'vue';

// Keeps an element at the tallest it has been, so it doesn't shrink as its
// content goes: a hand of large cards wraps onto fewer rows as cards are
// played, and the page below it would jump (#133, #136). `restart` changing
// (a new deal, another card size) or the element's width changing (a turned
// phone) starts over from its natural height. It follows the element as a
// v-if brings it and takes it away (the wide table's auction, #163), each
// time from its natural height. Without ResizeObserver it does nothing.
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

  watch(
    target,
    (el) => {
      observer?.disconnect();
      observer = null;
      if (typeof ResizeObserver !== 'function' || !el) {
        return;
      }
      tallest = 0;
      width = -1;
      observer = new ResizeObserver(() => measure());
      observer.observe(el);
    },
    { immediate: true, flush: 'sync' },
  );

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
