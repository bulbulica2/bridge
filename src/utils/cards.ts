import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { Card, Strain, Suit, Vulnerability } from '@/services/game';

// Bridge order: spades, hearts, diamonds, clubs. Diagrams and exports (PBN
// requires it) keep it.
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

// The order a hand is held in at the table: hearts, clubs, diamonds,
// spades, red and black alternating. The viewer's own hand always reads so.
export const HAND_SUITS: readonly Suit[] = ['H', 'C', 'D', 'S'];

// A hand laid face up for the viewer to see or play (dummy, a robot
// declarer's cards): trumps on the left, the base order rotated so the
// colours still alternate (♦ trumps: ♦ ♠ ♥ ♣). No trumps, or no contract
// yet, keeps the base order.
export function suitOrder(trump: Strain | null): readonly Suit[] {
  const start = trump && trump !== 'NT' ? HAND_SUITS.indexOf(trump) : 0;
  return [...HAND_SUITS.slice(start), ...HAND_SUITS.slice(0, start)];
}

export const SUIT_SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export const SUIT_NAMES: Record<Suit, string> = {
  S: 'spades',
  H: 'hearts',
  D: 'diamonds',
  C: 'clubs',
};

const HONOURS: Record<number, string> = { 12: 'J', 13: 'Q', 14: 'K', 15: 'A' };

// The backend ranks the jack 12 (there is no 11), so never print the number.
export function rankLabel(rank: number): string {
  return HONOURS[rank] ?? String(rank);
}

export function isRed(suit: Suit): boolean {
  return suit === 'H' || suit === 'D';
}

// Suits in `order` (bridge order by default), high to low within a suit.
export function sortHand(cards: Card[], order: readonly Suit[] = SUITS): Card[] {
  return [...cards].sort(
    (a, b) => order.indexOf(a.suit) - order.indexOf(b.suit) || b.rank - a.rank,
  );
}

// The hand split into its suits, in `order` (bridge order by default),
// leaving out empty suits.
export function groupBySuit(
  cards: Card[],
  order: readonly Suit[] = SUITS,
): { suit: Suit; cards: Card[] }[] {
  const sorted = sortHand(cards, order);
  return order.map((suit) => ({ suit, cards: sorted.filter((c) => c.suit === suit) })).filter(
    (group) => group.cards.length > 0,
  );
}

// How many cards the hand's longest suit holds (0 for no cards): the
// height of its suit columns (see DummyColumns), whatever their order.
export function longestSuit(cards: Card[]): number {
  return Math.max(0, ...SUITS.map((suit) => cards.filter((c) => c.suit === suit).length));
}

export type ScreenSide = 'bottom' | 'left' | 'top' | 'right';

// Where a seat sits on screen for a viewer at `mySeat`, who is always drawn at
// the bottom (as South): play goes clockwise N → E → S → W, so the next seat
// round is on the viewer's left, partner opposite and the last one on the right.
export function screenSide(seat: Seat, mySeat: Seat | null): ScreenSide {
  const offset = (SEATS.indexOf(seat) - SEATS.indexOf(mySeat ?? 'S') + 4) % 4;
  return (['bottom', 'left', 'top', 'right'] as const)[offset];
}

// The seat drawn on each side of the screen for that viewer.
export function seatAt(side: ScreenSide, mySeat: Seat | null): Seat {
  return SEATS.find((seat) => screenSide(seat, mySeat) === side)!;
}

export function isVulnerable(seat: Seat, vulnerable: Vulnerability): boolean {
  return vulnerable.includes(seat === 'N' || seat === 'S' ? 'N-S' : 'E-W');
}

export function vulnerabilityLabel(vulnerable: Vulnerability): string {
  switch (vulnerable) {
    case 'N-S':
      return 'N-S';
    case 'E-W':
      return 'E-W';
    case 'N-S E-W':
      return 'Both';
    default:
      return 'None';
  }
}
