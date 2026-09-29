import type { Seat } from '@/services/tables';
import type { Card, PlayedCard, Playing } from '@/services/game';
import { screenSide } from '@/utils/cards';
import type { ScreenSide } from '@/utils/cards';

// The play's rules (bridge_docs/GAME-RULES.md §5), mirrored as a hint for
// which cards to dim. The backend's CardPlayService is the final word: a card
// that slips past these answers 409 with its reason.

// The cards `hand` may play to the trick in progress: anything on the lead
// (an empty trick), else the suit led while the hand still holds it, else
// anything at all.
export function legalCards(hand: Card[], trick: PlayedCard[] | null): Card[] {
  const led = trick?.[0]?.card.suit;
  if (!led) {
    return hand;
  }
  const following = hand.filter((card) => card.suit === led);
  return following.length > 0 ? following : hand;
}

// Which hand the user plays from right now: their own, dummy's (declarer on
// dummy's turn), or none. `acting_user_id` says whose move it is; `turn`
// says which hand the card comes from. A pending claim stops the play.
export function handToPlay(state: Playing, userId: number | null): 'own' | 'dummy' | null {
  if (
    state.phase !== 'play' ||
    state.claim ||
    userId === null ||
    state.acting_user_id !== userId ||
    !state.turn
  ) {
    return null;
  }
  if (state.turn === state.my_seat) {
    return 'own';
  }
  return state.turn === state.contract?.dummy ? 'dummy' : null;
}

// A trick's cards placed by the side of the screen their hand sits on, for a
// viewer at `mySeat` (see screenSide): a seat that hasn't played yet is null.
export function trickBySide(
  cards: PlayedCard[],
  mySeat: Seat | null,
): Record<ScreenSide, Card | null> {
  const sides: Record<ScreenSide, Card | null> = { bottom: null, left: null, top: null, right: null };
  for (const { seat, card } of cards) {
    sides[screenSide(seat, mySeat)] = card;
  }
  return sides;
}
