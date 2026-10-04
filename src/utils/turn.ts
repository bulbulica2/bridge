import type { Playing } from '@/services/game';
import type { BroadcastTable } from '@/services/tables';
import { claimAction, claimSeatOf } from '@/utils/claim';
import { handToPlay } from '@/utils/play';
import { isReady } from '@/utils/start';

// What the game waits for the user to do, if anything: a call, a card (from
// whichever hand they play), an answer to a claim or their Start. The play
// page's review modal shows it, so looking back at a board never holds the
// table up unnoticed. A finished board waits for nobody: the set's next one
// is dealt by itself (bb#97). `startShown` is the page's
// StartBox in place of NextBoardBox (src/utils/start.ts startNeeded).
export function turnNotice(
  state: Playing | null,
  me: number | null,
  table: BroadcastTable | null,
  startShown: boolean,
): string | null {
  if (startShown) {
    const seat = table?.seats.find((s) => s.user_id === me);
    return seat && !isReady(seat) ? 'Your Start: the next board waits for you' : null;
  }
  if (!state || me === null) {
    return null;
  }
  if (state.phase === 'auction') {
    return state.acting_user_id === me ? 'Your turn to bid' : null;
  }
  if (state.phase === 'play') {
    if (state.claim) {
      return claimAction(state, claimSeatOf(state)) === 'answer' ? 'A claim waits for your answer' : null;
    }
    return handToPlay(state, me) ? 'Your turn to play' : null;
  }
  return null;
}
