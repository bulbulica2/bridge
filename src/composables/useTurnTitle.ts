import { onScopeDispose, ref, watchEffect } from 'vue';
import { useTurnClock } from '@/composables/useTurnClock';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { turnTitle } from '@/utils/turnClock';

function isHidden() {
  return document.visibilityState === 'hidden';
}

// The "ping" for a player whose turn it is while they look at another tab
// (bb#120: the clock runs whether they are there or not): the tab's title
// becomes "● Your turn (0:42) – Bridge" while the page is hidden and the
// board we hold waits for us with a clock running, and is put back once the
// turn is taken or the page shows. App.vue runs it, so it follows the game
// store whatever page is up.
export function useTurnTitle() {
  const auth = useAuthStore();
  const game = useGameStore();
  const hidden = ref(isHidden());
  const { clock } = useTurnClock(
    () => game.playing,
    () => auth.user?.id ?? null,
  );
  // The title to put back, while ours is up.
  let saved: string | null = null;

  function onVisibilityChange() {
    hidden.value = isHidden();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  function restore() {
    if (saved !== null) {
      document.title = saved;
      saved = null;
    }
  }

  watchEffect(() => {
    const mine = clock.value?.mine ? clock.value : null;
    if (!hidden.value || !mine) {
      restore();
      return;
    }
    saved ??= document.title;
    document.title = turnTitle(mine, saved);
  });

  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    restore();
  });
}
