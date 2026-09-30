import type { Seat } from '@/services/tables';
import type { BoardResult } from '@/services/game';
import type { PlayingHistoryEntry } from '@/services/history';
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

// How the contract went, short: "+1", "made" (exactly), "−2".
export function madeBy(made: number): string {
  if (made === 0) {
    return 'made';
  }
  return made > 0 ? `+${made}` : `−${-made}`;
}

// The same, spelled out: "Made with 1 overtrick", "Made exactly", "Down 2".
export function madeText(made: number): string {
  if (made === 0) {
    return 'Made exactly';
  }
  if (made > 0) {
    return `Made with ${made} overtrick${made === 1 ? '' : 's'}`;
  }
  return `Down ${-made}`;
}

// "4♠ doubled by North", or null for a passed-out board.
export function resultContract(result: BoardResult): string | null {
  if (!result.contract || !result.declarer) {
    return null;
  }
  return `${callLabel(result.contract)}${doubledSuffix(result.doubled ?? 0)} by ${SEAT_NAMES[result.declarer]}`;
}

// One line for the whole board: "4♠ by N, +1: N-S +450", naming the side
// that scored (an E-W plus when N-S lost points), "4♠ by N, +1 by claim: …"
// when the play ended by a claim, or "Passed out: 0".
export function resultSummary(result: BoardResult): string {
  if (isPassedOut(result) || !result.declarer || result.made_by === null) {
    return 'Passed out: 0';
  }
  const call = `${callLabel(result.contract!)}${['', 'X', 'XX'][result.doubled ?? 0]}`;
  const side: Side = result.score_ns >= 0 ? 'ns' : 'ew';
  const score = formatScore(scoreFor(result.score_ns, side));
  const how = `${madeBy(result.made_by)}${result.claimed ? ' by claim' : ''}`;
  return `${call} by ${result.declarer}, ${how}: ${SIDE_LABELS[side]} ${score}`;
}

// The board's score for whoever sits at `seat`: positive when their side
// scored. Null for someone without a seat, who has no side.
export function viewerScore(result: BoardResult, seat: Seat | null): number | null {
  return seat ? scoreFor(result.score_ns, sideOf(seat)) : null;
}

export interface SessionScore {
  boards: number;
  // The sum of `score_ns` over those boards.
  ns: number;
  // The sum of the user's own side's scores (each board's `score`).
  mine: number;
}

// The running score at one table: the user's latest finished boards (the
// history is latest first) for as long as they were played at `tableId`. An
// older run at the same table, before a stint elsewhere, is another session.
// `complete` is false when every row given was at this table, so an older
// page may hold more.
export function sessionScore(
  entries: PlayingHistoryEntry[],
  tableId: number,
): SessionScore & { complete: boolean } {
  const total = { boards: 0, ns: 0, mine: 0, complete: false };
  for (const entry of entries) {
    if (entry.table_id !== tableId) {
      total.complete = true;
      break;
    }
    total.boards += 1;
    total.ns += entry.score_ns;
    total.mine += entry.score;
  }
  return total;
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
