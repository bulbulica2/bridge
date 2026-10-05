import { computed } from 'vue';
import type { PublicPlaying } from '@/services/game';
import { useNow } from '@/composables/useNow';
import { turnClock, turnClockText, turnDeadline, turnUrgent } from '@/utils/turnClock';

// The turn clock of `state` (src/utils/turnClock.ts), ticking every second
// while a deadline runs: the clock itself, its text for the status line and
// whether it is the viewer's in its last seconds.
export function useTurnClock(state: () => PublicPlaying | null, me: () => number | null) {
  const now = useNow(() => turnDeadline(state()) !== null);
  const clock = computed(() => turnClock(state(), me(), now.value));
  const text = computed(() => (clock.value ? turnClockText(clock.value) : ''));
  const urgent = computed(() => turnUrgent(clock.value));
  return { clock, text, urgent };
}
