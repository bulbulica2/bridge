import { computed } from 'vue';
import type { PublicPlaying } from '@/services/game';
import { useNow } from '@/composables/useNow';
import { setBanks } from '@/utils/setClock';
import {
  turnClock,
  turnClockFraction,
  turnClockText,
  turnClockTime,
  turnDeadline,
  turnUrgent,
} from '@/utils/turnClock';

// The turn clock of `state` (src/utils/turnClock.ts), ticking every second
// while a deadline runs: the clock itself, its text for the status line and
// whether it is the viewer's in its last seconds; for the play page's line,
// the time on its right and how full its bar is. With it each seat's time
// for the set (src/utils/setClock.ts), whose running one ticks on the same
// clock: it runs exactly while a turn clock does.
export function useTurnClock(state: () => PublicPlaying | null, me: () => number | null) {
  const now = useNow(() => turnDeadline(state()) !== null);
  const clock = computed(() => turnClock(state(), me(), now.value));
  const text = computed(() => (clock.value ? turnClockText(clock.value) : ''));
  const time = computed(() => turnClockTime(clock.value));
  const fraction = computed(() => turnClockFraction(clock.value));
  const urgent = computed(() => turnUrgent(clock.value));
  const banks = computed(() => setBanks(state(), now.value));
  return { clock, text, time, fraction, urgent, banks };
}
