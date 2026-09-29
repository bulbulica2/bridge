import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { Card, Suit, Vulnerability } from '@/services/game';

// Bridge order: spades, hearts, diamonds, clubs.
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

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

// Spades first, and high to low within a suit. The backend already sends the
// hand in this order; sorting again keeps a hand we trimmed ourselves right.
export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort(
    (a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || b.rank - a.rank,
  );
}

// The hand split into its suits, in bridge order, leaving out empty suits.
export function groupBySuit(cards: Card[]): { suit: Suit; cards: Card[] }[] {
  const sorted = sortHand(cards);
  return SUITS.map((suit) => ({ suit, cards: sorted.filter((c) => c.suit === suit) })).filter(
    (group) => group.cards.length > 0,
  );
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
