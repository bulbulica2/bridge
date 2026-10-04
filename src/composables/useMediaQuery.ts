import { onBeforeUnmount, ref } from 'vue';
import type { Ref } from 'vue';

// Whether `query` matches now, kept up to date as the window is resized.
// False where matchMedia is missing (tests, very old WebViews).
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false);
  if (typeof window.matchMedia !== 'function') {
    return matches;
  }
  const list = window.matchMedia(query);
  matches.value = list.matches;
  const update = (event: MediaQueryListEvent) => {
    matches.value = event.matches;
  };
  list.addEventListener('change', update);
  onBeforeUnmount(() => list.removeEventListener('change', update));
  return matches;
}
