import type { Seat } from '@/services/tables';
import type { BoardResult, Strain } from '@/services/game';
import type { BoardResults } from '@/services/history';
import type { PublicUser } from '@/services/users';
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
  const contract = contractShort(result);
  if (contract === null) {
    return 'Passed out · 0';
  }
  const score = viewerScore(result, seat);
  const shown = score === null ? `N-S ${formatScore(result.score_ns)}` : formatScore(score);
  return `${contract} · ${shown}`;
}

// The contract and how it went in table notation, "2♣X W +2"; null for a
// passed-out board.
export function contractShort(
  result: Pick<BoardResult, 'contract' | 'doubled' | 'declarer' | 'made_by'>,
): string | null {
  if (!result.contract || !result.declarer || result.made_by === null) {
    return null;
  }
  const call = `${callLabel(result.contract)}${doubledMark(result.doubled)}`;
  return `${call} ${result.declarer} ${madeSuffix(result.made_by)}`;
}

// Who played the contract, as the result's hero card says it: "You
// declared", "radu declared" (the declarer's username, when known), or the
// side, "E-W declared".
export function declaredText(
  declarer: Seat,
  mySeat: Seat | null,
  players: Partial<Record<Seat, Pick<PublicUser, 'username'> | null>> = {},
): string {
  if (declarer === mySeat) {
    return 'You declared';
  }
  const name = players[declarer]?.username;
  return `${name ?? SIDE_LABELS[sideOf(declarer)]} declared`;
}

// One row of "Same board elsewhere": the table's result told by its players
// (a result row has no table name), N-S's score, and whether it is ours.
export interface OtherTableRow {
  playingId: number;
  // "You" for our own table, else its N-S pair: "anna & luis".
  label: string;
  // Every player there, for a tooltip: "anna, dan, luis, vlad".
  players: string;
  // "3NT N +2", or "Passed out".
  contract: string;
  scoreNs: number;
  mine: boolean;
}

// The board's results at every table (best N-S first) as the finished
// board's list: the first `max`, always with our own row (in place of the
// last when it is further down). Empty until another table has played it.
export function otherTableRows(
  board: BoardResults | null | undefined,
  playingId: number | null,
  max = 5,
): OtherTableRow[] {
  if (!board || board.results.length < 2) {
    return [];
  }
  const rows = board.results;
  const mineAt = rows.findIndex((r) => r.playing_id === playingId);
  const shown = mineAt < max ? rows.slice(0, max) : [...rows.slice(0, max - 1), rows[mineAt]];
  return shown.map((row) => {
    const mine = row.playing_id === playingId;
    const name = (seat: Seat) => row.players[seat]?.username ?? '?';
    return {
      playingId: row.playing_id,
      label: mine ? 'You' : `${name('N')} & ${name('S')}`,
      players: (['N', 'E', 'S', 'W'] as Seat[]).map(name).join(', '),
      contract: contractShort(row) ?? 'Passed out',
      scoreNs: row.score_ns,
      mine,
    };
  });
}

// The board's score for whoever sits at `seat`: positive when their side
// scored. Null for someone without a seat, who has no side.
export function viewerScore(result: BoardResult, seat: Seat | null): number | null {
  return seat ? scoreFor(result.score_ns, sideOf(seat)) : null;
}

// "75 %" (or "56.0 %" for a number already formatted).
export function percentText(percent: number | string): string {
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

// What a contract scores for declarer's side (negative when it goes down),
// as duplicate scores it (bridge_backend docs/GAME-RULES.md §6, the
// backend's ScoringService): trick points for the bid tricks (×2 doubled,
// ×4 redoubled), the part-score, game and slam bonuses, the insult for a
// doubled contract made, overtricks, or undertricks for the defenders.
// `vulnerable` is declarer's side's; `tricks` all declarer's side took.
// Only a hint, for the claim sheet: the backend's result is final.
export function contractScore(
  contract: { level: number; strain: Strain },
  doubled: 0 | 1 | 2,
  vulnerable: boolean,
  tricks: number,
): number {
  const { level, strain } = contract;
  const needed = level + 6;
  if (tricks < needed) {
    return 0 - undertricks(needed - tricks, doubled, vulnerable);
  }
  const multiplier = [1, 2, 4][doubled];
  const perTrick = strain === 'C' || strain === 'D' ? 20 : 30;
  const trickPoints = (level * perTrick + (strain === 'NT' ? 10 : 0)) * multiplier;
  let score = trickPoints;
  score += trickPoints >= 100 ? (vulnerable ? 500 : 300) : 50;
  if (level === 6) {
    score += vulnerable ? 750 : 500;
  } else if (level === 7) {
    score += vulnerable ? 1500 : 1000;
  }
  score += [0, 50, 100][doubled];
  const over = tricks - needed;
  const overValue = doubled === 0 ? perTrick : (vulnerable ? 200 : 100) * (doubled === 2 ? 2 : 1);
  return score + over * overValue;
}

// The defenders' score for `down` undertricks.
function undertricks(down: number, doubled: 0 | 1 | 2, vulnerable: boolean): number {
  if (doubled === 0) {
    return down * (vulnerable ? 100 : 50);
  }
  let total = 0;
  for (let n = 1; n <= down; n++) {
    if (vulnerable) {
      total += n === 1 ? 200 : 300;
    } else {
      total += n === 1 ? 100 : n <= 3 ? 200 : 300;
    }
  }
  return total * (doubled === 2 ? 2 : 1);
}
