import type { Seat } from '@/services/tables';
import type { BoardResult } from '@/services/game';
import { callLabel, doubledSuffix, SEAT_NAMES } from '@/utils/auction';

// A finished board's score, read from the backend's `result`
// (bridge_backend docs/API.md, GET /tables/{table}/playing). The score itself
// is the backend's (ScoringService); this only words it and turns it round
// for the side looking at it.

export type Side = 'ns' | 'ew';

export const SIDE_LABELS: Record<Side, string> = { ns: 'N-S', ew: 'E-W' };

export function sideOf(seat: Seat): Side {
  return seat === 'N' || seat === 'S' ? 'ns' : 'ew';
}

// Four passes: no contract, and 0 for both sides.
export function isPassedOut(result: BoardResult): boolean {
  return result.contract === null;
}

// `score_ns` is from N-S's point of view whichever side declared; E-W's is
// the same number negated.
export function scoreFor(scoreNs: number, side: Side): number {
  return side === 'ns' ? scoreNs : 0 - scoreNs;
}

// "+450", "−50" (a real minus sign), "0".
export function formatScore(score: number): string {
  if (score === 0) {
    return '0';
  }
  return score > 0 ? `+${score}` : `−${-score}`;
}

// How the contract went, the way it is written at the table: "+2"
// (overtricks), "=" (just made), "−1" (down, a real minus sign); "" for a
// passed-out board (no contract, `made_by` null).
export function madeSuffix(made: number | null): string {
  if (made === null) {
    return '';
  }
  if (made === 0) {
    return '=';
  }
  return made > 0 ? `+${made}` : `−${-made}`;
}

// A doubled contract's mark: "", "X" or "XX".
export function doubledMark(doubled: 0 | 1 | 2 | null): string {
  return ['', 'X', 'XX'][doubled ?? 0];
}

// "4♠ doubled by North", or null for a passed-out board.
export function resultContract(result: BoardResult): string | null {
  if (!result.contract || !result.declarer) {
    return null;
  }
  return `${callLabel(result.contract)}${doubledSuffix(result.doubled ?? 0)} by ${SEAT_NAMES[result.declarer]}`;
}

// One line for the whole board, in table notation: "2♣ W +2 · −130", the
// score from the side of whoever sits at `seat`, or "2♣ W +2 · N-S −130"
// for someone without a seat. "Passed out · 0" when nobody bid.
export function resultSummary(result: BoardResult, seat: Seat | null = null): string {
  if (isPassedOut(result) || !result.declarer || result.made_by === null) {
    return 'Passed out · 0';
  }
  const score = viewerScore(result, seat);
  const shown = score === null ? `N-S ${formatScore(result.score_ns)}` : formatScore(score);
  const call = `${callLabel(result.contract!)}${doubledMark(result.doubled)}`;
  return `${call} ${result.declarer} ${madeSuffix(result.made_by)} · ${shown}`;
}

// The board's score for whoever sits at `seat`: positive when their side
// scored. Null for someone without a seat, who has no side.
export function viewerScore(result: BoardResult, seat: Seat | null): number | null {
  return seat ? scoreFor(result.score_ns, sideOf(seat)) : null;
}

// "75 %".
export function percentText(percent: number): string {
  return `${percent} %`;
}

// A side's matchpoints on a board as a percentage of the top, rounded.
// Null when the board has only one result (top 0): nothing to compare with.
export function matchpointPercent(matchpoints: number, top: number): number | null {
  return top > 0 ? Math.round((matchpoints / top) * 100) : null;
}

// The seat `userId` held in a playing's seat snapshot, if any.
export function seatOfUser(
  players: Partial<Record<Seat, { id: number } | null>>,
  userId: number | null | undefined,
): Seat | null {
  if (userId == null) {
    return null;
  }
  const seat = (Object.keys(players) as Seat[]).find((s) => players[s]?.id === userId);
  return seat ?? null;
}
