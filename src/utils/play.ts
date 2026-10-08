import type { Seat } from '@/services/tables';
import type { Card, PlayedCard, Playing, Strain } from '@/services/game';
import { screenSide } from '@/utils/cards';
import type { ScreenSide } from '@/utils/cards';

// The play's rules (bridge_backend docs/GAME-RULES.md §5), mirrored as a hint for
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

// The one card `hand` may play to the trick in progress, when there is only
// one: nothing to decide, so the play page sends it by itself. Never on the
// lead (an empty trick): any card may lead, and a single card left only
// leads the last trick.
export function forcedCard(hand: Card[], trick: PlayedCard[] | null): Card | null {
  if (!trick?.length) {
    return null;
  }
  const legal = legalCards(hand, trick);
  return legal.length === 1 ? legal[0] : null;
}

// Whether the viewer, dummy, plays declarer's game: a robot declarer hands
// the play of both hands to its human dummy (bridge_backend docs/API.md,
// `acting_user_id`). Declarer and dummy stay who they are; the viewer then
// claims for declarer's seat. Whose move it is still comes from
// `acting_user_id` alone (handToPlay).
export function playsForDeclarer(state: Pick<Playing, 'contract' | 'players' | 'my_seat'>): boolean {
  const contract = state.contract;
  return (
    !!contract &&
    state.my_seat !== null &&
    contract.dummy === state.my_seat &&
    !!state.players?.[contract.declarer]?.is_robot
  );
}

// Whether a forced card may play itself for this viewer: only for whoever
// plays declarer's game (declarer, or a robot declarer's dummy), who plays
// both declarer's hand and dummy's. A defender always taps their card: the
// pause before following is time to think, and a card landing at once would
// tell the table they are out of the suit led.
export function autoPlaysForced(state: Playing): boolean {
  return (!!state.contract && state.contract.declarer === state.my_seat) || playsForDeclarer(state);
}

// The hand the user plays from: their own, dummy's (declarer on dummy's
// turn) or declarer's (a robot declarer's dummy on declarer's turn).
export type PlayFrom = 'own' | 'dummy' | 'declarer';

// Which hand the user plays from right now, or none. `acting_user_id` says
// whose move it is; `turn` says which hand the card comes from. A pending
// claim stops the play.
export function handToPlay(state: Playing, userId: number | null): PlayFrom | null {
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
  if (state.turn === state.contract?.dummy) {
    return 'dummy';
  }
  return state.turn === state.contract?.declarer && state.my_seat === state.contract.dummy
    ? 'declarer'
    : null;
}

// The cards of the hand `from`, as the state holds them (null if unknown).
export function cardsToPlay(state: Playing, from: PlayFrom): Card[] | null {
  if (from === 'dummy') {
    return state.dummy_hand;
  }
  return from === 'declarer' ? state.declarer_hand : state.hand;
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

// When each side's card came in the trick, laid out like trickBySide: 0 for
// the lead, 3 for the last card, null for a seat that hasn't played. The
// table stacks the cards by it, the last card played on top (#201).
export function trickOrder(
  cards: PlayedCard[],
  mySeat: Seat | null,
): Record<ScreenSide, number | null> {
  const order: Record<ScreenSide, number | null> = { bottom: null, left: null, top: null, right: null };
  cards.forEach(({ seat }, index) => {
    order[screenSide(seat, mySeat)] = index;
  });
  return order;
}

// The seat whose card wins the trick so far (GAME-RULES.md §5): the highest
// trump played, else the highest card of the suit led. Null for an empty
// trick. Only a hint for the table's ring: the backend says who won.
export function winningSoFar(cards: PlayedCard[], trump: Strain | null): Seat | null {
  if (cards.length === 0) {
    return null;
  }
  let best = cards[0];
  for (const played of cards.slice(1)) {
    const ruffs = trump !== null && trump !== 'NT' && played.card.suit === trump && best.card.suit !== trump;
    const beats = played.card.suit === best.card.suit && played.card.rank > best.card.rank;
    if (ruffs || beats) {
      best = played;
    }
  }
  return best.seat;
}
