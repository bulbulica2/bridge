import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { AuctionCall, Bid, Contract, Strain } from '@/services/game';
import { SUIT_SYMBOLS, seatAt } from '@/utils/cards';
import type { ScreenSide } from '@/utils/cards';

// The auction's rules (bridge_backend docs/GAME-RULES.md §4), mirrored as a hint for
// the bidding box. The backend's AuctionService is the final word: a call
// that slips past these answers 409 with its reason.

// Lowest to highest.
export const STRAINS: readonly Strain[] = ['C', 'D', 'H', 'S', 'NT'];

export const LEVELS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

export const PASS = 'P';
export const DOUBLE = 'X';
export const REDOUBLE = 'XX';

export const SEAT_NAMES: Record<Seat, string> = {
  N: 'North',
  E: 'East',
  S: 'South',
  W: 'West',
};

export function strainSymbol(strain: Strain): string {
  return strain === 'NT' ? 'NT' : SUIT_SYMBOLS[strain];
}

export function isRedStrain(strain: Strain | null): boolean {
  return strain === 'H' || strain === 'D';
}

export function isContractBid(bid: Bid): boolean {
  return !bid.special && bid.level !== null && bid.strain !== null;
}

// "1♠", "3NT", "Pass", "X", "XX".
export function callLabel(bid: Bid): string {
  if (isContractBid(bid)) {
    return `${bid.level}${strainSymbol(bid.strain!)}`;
  }
  return bid.call === PASS ? 'Pass' : bid.call;
}

const STRAIN_NAMES: Record<Strain, [string, string]> = {
  C: ['club', 'clubs'],
  D: ['diamond', 'diamonds'],
  H: ['heart', 'hearts'],
  S: ['spade', 'spades'],
  NT: ['no trump', 'no trump'],
};

// The call spoken out, for screen readers: "1 spade", "3 no trump", "Double".
export function callName(bid: Bid): string {
  if (isContractBid(bid)) {
    const [one, many] = STRAIN_NAMES[bid.strain!];
    return `${bid.level} ${bid.level === 1 ? one : many}`;
  }
  return { [PASS]: 'Pass', [DOUBLE]: 'Double', [REDOUBLE]: 'Redouble' }[bid.call] ?? bid.call;
}

function partner(seat: Seat): Seat {
  return SEATS[(SEATS.indexOf(seat) + 2) % 4];
}

function sameSide(a: Seat, b: Seat): boolean {
  return a === b || a === partner(b);
}

// Does `bid` outrank `other`? Level first, then strain; never the id.
export function outranks(bid: Bid, other: Bid): boolean {
  if (bid.level !== other.level) {
    return (bid.level ?? 0) > (other.level ?? 0);
  }
  return STRAINS.indexOf(bid.strain!) > STRAINS.indexOf(other.strain!);
}

// The last contract bid made, or null before the first one.
export function lastBid(auction: AuctionCall[]): AuctionCall | null {
  return [...auction].reverse().find((c) => isContractBid(c.bid)) ?? null;
}

// The last call that isn't a pass: what X and XX are judged against.
function lastAction(auction: AuctionCall[]): AuctionCall | null {
  return [...auction].reverse().find((c) => c.bid.call !== PASS) ?? null;
}

// X: only on an opponent's bid, while that bid is still the last call other
// than a pass (passes in between don't matter, a doubled bid can't be again).
export function canDouble(auction: AuctionCall[], seat: Seat): boolean {
  const action = lastAction(auction);
  return !!action && isContractBid(action.bid) && !sameSide(action.seat, seat);
}

// XX: only on an opponent's X, while it is the last call other than a pass.
export function canRedouble(auction: AuctionCall[], seat: Seat): boolean {
  const action = lastAction(auction);
  return !!action && action.bid.call === DOUBLE && !sameSide(action.seat, seat);
}

// Would `seat` be allowed to make `bid` next? Pass always; a bid only above
// the last one; X and XX as above. Whose turn it is, is the caller's concern.
export function isLegalCall(bid: Bid, auction: AuctionCall[], seat: Seat): boolean {
  if (isContractBid(bid)) {
    const last = lastBid(auction);
    return !last || outranks(bid, last.bid);
  }
  if (bid.call === DOUBLE) {
    return canDouble(auction, seat);
  }
  if (bid.call === REDOUBLE) {
    return canRedouble(auction, seat);
  }
  return bid.call === PASS;
}

// What follows the bid in a contract: "4♠", "4♠ doubled", "4♠ redoubled".
export function doubledSuffix(doubled: Contract['doubled']): string {
  return ['', ' doubled', ' redoubled'][doubled] ?? '';
}

// "4♠ doubled by North".
export function contractLabel(contract: Contract): string {
  return `${callLabel(contract.bid)}${doubledSuffix(contract.doubled)} by ${SEAT_NAMES[contract.declarer]}`;
}

// The auction grid's columns, left to right, for a viewer drawn at the
// bottom of the table (BridgeTable): their left-hand opponent, partner,
// right-hand opponent, then themselves. South sees the usual W N E S.
const GRID_SIDES: readonly ScreenSide[] = ['left', 'top', 'right', 'bottom'];

export function auctionColumns(mySeat: Seat | null): Seat[] {
  return GRID_SIDES.map((side) => seatAt(side, mySeat));
}

// One cell of the grid: a call made, the call awaited from `turn`, or an
// empty cell before the dealer's first call.
export type AuctionCell =
  | { kind: 'call'; seat: Seat; bid: Bid }
  | { kind: 'next'; seat: Seat }
  | { kind: 'empty' };

// The calls laid out in rows of four under `columns`. The dealer calls first,
// so the first row starts in the dealer's column; `turn` (while the auction
// runs) adds a placeholder where the next call will go.
export function auctionRows(
  auction: AuctionCall[],
  dealer: Seat,
  columns: Seat[],
  turn: Seat | null = null,
): AuctionCell[][] {
  const cells: AuctionCell[] = Array.from({ length: columns.indexOf(dealer) }, () => ({
    kind: 'empty' as const,
  }));
  cells.push(...auction.map(({ seat, bid }) => ({ kind: 'call' as const, seat, bid })));
  if (turn) {
    cells.push({ kind: 'next', seat: turn });
  }
  const rows: AuctionCell[][] = [];
  for (let i = 0; i < cells.length; i += 4) {
    const row = cells.slice(i, i + 4);
    while (row.length < 4) {
      row.push({ kind: 'empty' });
    }
    rows.push(row);
  }
  return rows;
}
