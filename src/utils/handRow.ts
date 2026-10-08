import { MIN_TARGET_PX } from '@/utils/cardSize';

// Dummy's cards across the top of the table, and a robot declarer's for its
// dummy (#172): always one row, so the table never jumps as they go. Where
// the row is short of room the cards overlap more, then get smaller; they
// never wrap. HandView's `singleRow` lays them out from these.

// A full hand, in four suits: the row is sized for it from the start, so
// the cards keep their size (and the row its height) as they are played.
export const ROW_CARDS = 13;
export const ROW_SUITS = 4;

// The extra room between two suits of the row.
export const SUIT_GAP_PX = 4;

// How much of a card shows at the least: its corner, rank over suit, "10"
// included (PlayingCard: the corner sits 0.06 of the width in, the rank is
// 0.38 of it tall), and never under 22 px.
export const CORNER_SHARE = 0.42;
export const MIN_STEP_PX = 22;

// Below this the cards would be too small to read: the row may then spill
// over a screen narrower than any phone rather than shrink further.
export const MIN_CARD_PX = 24;

// The usual step (HandView's `--card-step`): rank and suit with room to
// spare, and never less than a finger's width.
export function naturalStep(cardWidth: number): number {
  return Math.max(MIN_TARGET_PX, cardWidth * 0.46);
}

// The least of a card the row may show: its corner.
export function floorStep(cardWidth: number): number {
  return Math.max(MIN_STEP_PX, cardWidth * CORNER_SHARE);
}

// The card width for a row `room` px wide: the setting's, unless 13 cards
// at the floor step don't fit at it, then the largest that does.
export function rowCardWidth(room: number, cardWidth: number): number {
  const steps = ROW_CARDS - 1;
  const free = room - (ROW_SUITS - 1) * SUIT_GAP_PX;
  // While the floor is a share of the card, the row is a multiple of it.
  const shared = free / (1 + steps * CORNER_SHARE);
  const fit = shared * CORNER_SHARE >= MIN_STEP_PX ? shared : free - steps * MIN_STEP_PX;
  return Math.max(MIN_CARD_PX, Math.min(cardWidth, fit));
}

// How much of each card shows before the next one covers it (all but the
// last, which shows whole), for cards `cardWidth` px wide in `suits` suits
// on a row `room` px wide. The usual step where it fits. Else the cards that
// can be tapped (`tappable`, one per card) keep it, so each still has a
// finger's width, and the rest share what is left, down to the floor. If
// the tappable ones take too much (a lead, every card playable), the rest
// stay at the floor and the tappable ones share the remainder.
export function rowSteps(room: number, cardWidth: number, suits: number, tappable: boolean[]): number[] {
  const count = tappable.length - 1;
  if (count <= 0) {
    return [];
  }
  const free = room - cardWidth - (suits - 1) * SUIT_GAP_PX;
  const natural = naturalStep(cardWidth);
  if (count * natural <= free) {
    return Array<number>(count).fill(natural);
  }
  const tapped = tappable.slice(0, count);
  const taps = tapped.filter(Boolean).length;
  const rest = count - taps;
  const floor = floorStep(cardWidth);
  if (taps * natural + rest * floor <= free && rest > 0) {
    const share = (free - taps * natural) / rest;
    return tapped.map((tap) => (tap ? natural : share));
  }
  if (taps === 0) {
    return Array<number>(count).fill(floor);
  }
  const share = Math.max(floor, (free - rest * floor) / taps);
  return tapped.map((tap) => (tap ? share : floor));
}
