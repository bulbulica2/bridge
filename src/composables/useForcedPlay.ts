import { onScopeDispose, ref, watch } from 'vue';
import type { Card } from '@/services/game';

// How long a forced card waits for the user before it goes by itself.
export const FORCED_PLAY_SECONDS = 3;

// A card with no alternative (see forcedCard in src/utils/play.ts), played
// automatically after FORCED_PLAY_SECONDS unless the user taps it first.
// `forced` says what is forced now, or null when nothing is or the play must
// wait (a card in flight, the claim sheet open, the page left). `key` names
// the state the card is forced in: any change of it restarts or cancels the
// countdown, so a timer never sends a card for a state that is gone. A key
// the timer already fired for is not armed again (a refused card that
// reloads the same state then waits for a tap instead of looping).
export function useForcedPlay(
  forced: () => { key: string; card: Card } | null,
  play: (card: Card) => void,
) {
  // The card counting down, and the whole seconds left before it goes.
  const card = ref<Card | null>(null);
  const secondsLeft = ref(0);

  let timer: ReturnType<typeof setInterval> | null = null;
  let firedKey: string | null = null;

  function cancel() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    card.value = null;
    secondsLeft.value = 0;
  }

  watch(
    () => forced()?.key ?? null,
    (key) => {
      cancel();
      const now = forced();
      if (key === null || key === firedKey || !now) {
        return;
      }
      card.value = now.card;
      secondsLeft.value = FORCED_PLAY_SECONDS;
      timer = setInterval(() => {
        secondsLeft.value--;
        if (secondsLeft.value > 0) {
          return;
        }
        cancel();
        // The watch cancels on any change, so this is only a backstop.
        const due = forced();
        if (due?.key === key) {
          firedKey = key;
          play(due.card);
        }
      }, 1000);
    },
    { immediate: true },
  );

  onScopeDispose(cancel);

  return { card, secondsLeft };
}
