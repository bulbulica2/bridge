import { onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';

// The width of an element's content box, kept up to date as it is resized
// (the window, the side menu pinned or not, the chat beside it). It follows
// the element as a v-if brings it and takes it away. 0 while there is no
// element, or no ResizeObserver (tests, very old WebViews).
export function useElementWidth(target: Ref<HTMLElement | null>): Ref<number> {
  const width = ref(0);
  let observer: ResizeObserver | null = null;

  watch(
    target,
    (el) => {
      observer?.disconnect();
      observer = null;
      if (typeof ResizeObserver !== 'function' || !el) {
        width.value = 0;
        return;
      }
      observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry) {
          width.value = entry.contentRect.width;
        }
      });
      observer.observe(el);
    },
    { immediate: true, flush: 'sync' },
  );

  onBeforeUnmount(() => observer?.disconnect());

  return width;
}
