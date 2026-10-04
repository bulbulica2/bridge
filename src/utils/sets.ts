import type { PublicPlaying, SetPosition, SideCode } from '@/services/game';
import type { PlayingHistoryEntry, SetResults } from '@/services/history';
import { SEATS } from '@/services/tables';
import type { BroadcastTable, Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { SIDE_LABELS, matchpointPercent, sideOf } from '@/utils/result';
import type { Side } from '@/utils/result';

// Sets of boards (bridge_backend docs/API.md, Sets): Start deals a set's
// first board, the other three are dealt by themselves (`next_board_at`), and
// after the fourth it is everyone's Start again. The backend adds up the set (GET /sets/{id}); this only words
// it and turns it round for the side looking at it.

export function sideOfCode(code: SideCode): Side {
  return code === 'NS' ? 'ns' : 'ew';
}

// "Board 2 of 4 · Set 3".
export function setLabel(set: Pick<SetPosition, 'number' | 'board' | 'of'>): string {
  return `Board ${set.board} of ${set.of} · Set ${set.number}`;
}

// The set a table is on, from what we hold of it. The table payload follows
// seats and Start live, but a board finishing sends no TableUpdated, so
// after the last board only the game state says the set is over; with both
// for the same set, whatever either knows counts. Two different sets: the
// later one (ids only grow).
export function currentSet(
  table: BroadcastTable | null,
  playing: PublicPlaying | null,
): SetPosition | null {
  const fromTable = table?.set ?? null;
  const fromBoard = playing?.set ?? null;
  if (!fromTable || !fromBoard) {
    return fromTable ?? fromBoard;
  }
  if (fromTable.id !== fromBoard.id) {
    return fromTable.id > fromBoard.id ? fromTable : fromBoard;
  }
  return {
    ...fromTable,
    board: Math.max(fromTable.board, fromBoard.board),
    finished: fromTable.finished || fromBoard.finished,
    ended: fromTable.ended ?? fromBoard.ended,
    forfeited_by: fromTable.forfeited_by ?? fromBoard.forfeited_by,
  };
}

// The set the table is in the middle of (a board of it on, or between its
// boards), else null: no set yet, or the last one is over. Mid-set, going
// away costs the set (bridge_backend docs/API.md, Away mid-set).
export function runningSet(
  table: BroadcastTable | null,
  playing: PublicPlaying | null,
): SetPosition | null {
  const set = currentSet(table, playing);
  return set && !set.finished ? set : null;
}

// "Set 3 over", or "Set 3: 2 of 4 boards played" while it goes on.
export function setTitle(set: SetResults): string {
  if (set.finished) {
    return `Set ${set.number} over`;
  }
  const played = set.boards.length;
  return `Set ${set.number}: ${played} of ${set.of} board${set.of === 1 ? '' : 's'} played`;
}

// Who won, turned to the viewer's side: "You won the set.", "You lost the
// set by forfeit.", or "N-S won the set." for someone who didn't play it.
// Null while the set goes on.
export function setWinnerText(set: SetResults, seat: Seat | null): string | null {
  if (!set.finished) {
    return null;
  }
  if (set.ended === 'abandoned') {
    return 'Abandoned: no winner.';
  }
  if (set.winner === null) {
    return 'A tie: no winner.';
  }
  const winner = sideOfCode(set.winner);
  const how = set.ended === 'forfeit' ? ' by forfeit' : '';
  if (seat) {
    return sideOf(seat) === winner ? `You won the set${how}.` : `You lost the set${how}.`;
  }
  return `${SIDE_LABELS[winner]} won the set${how}.`;
}

// Did the viewer's side win (true), lose (false), or neither (null)?
export function setWon(set: SetResults, seat: Seat | null): boolean | null {
  if (!seat || !set.finished || set.winner === null || set.ended === 'abandoned') {
    return null;
  }
  return sideOf(seat) === sideOfCode(set.winner);
}

// The seat whose player cost their side the set: the forfeiting side's seat
// whose player no longer sits at `table` (they didn't come back, or moved
// away). Null when that can't be told, e.g. without the table.
export function forfeitedSeat(set: SetResults, table: BroadcastTable | null): Seat | null {
  if (set.ended !== 'forfeit' || !set.forfeited_by || !table) {
    return null;
  }
  const side = sideOfCode(set.forfeited_by);
  const seated = new Set(table.seats.map((s) => s.user_id));
  return (
    SEATS.find(
      (seat) => sideOf(seat) === side && set.players[seat] && !seated.has(set.players[seat]!.id),
    ) ?? null
  );
}

// "N-S forfeited, East didn't come back in time.", or "N-S forfeited the
// set." when we can't tell who went. Null unless the set was forfeited.
export function forfeitText(set: SetResults, gone: Seat | null = null): string | null {
  if (set.ended !== 'forfeit' || !set.forfeited_by) {
    return null;
  }
  const side = SIDE_LABELS[sideOfCode(set.forfeited_by)];
  return gone
    ? `${side} forfeited, ${SEAT_NAMES[gone]} didn't come back in time.`
    : `${side} forfeited the set.`;
}

// The viewer's side of the totals (N-S for someone who didn't play it):
// the score, the matchpoints out of the top and as a percentage.
export function setTotals(set: SetResults, seat: Seat | null) {
  const side: Side = seat ? sideOf(seat) : 'ns';
  const matchpoints = set.totals.matchpoints[side];
  return {
    side,
    score: set.totals.score[side],
    matchpoints,
    top: set.totals.top,
    percent: matchpointPercent(matchpoints, set.totals.top),
  };
}

// A run of history entries from one set, with its score from the owner's
// side. `set` is null for entries made outside any set.
export interface HistorySetGroup {
  key: string;
  set: PlayingHistoryEntry['set'];
  tableId: number | null;
  entries: PlayingHistoryEntry[];
  score: number;
}

// The history (latest first) cut into runs of the same set, each with the
// owner's score added up over the boards it holds so far (an older page can
// add more). Entries without a set stand in runs of their own.
export function groupBySet(entries: PlayingHistoryEntry[]): HistorySetGroup[] {
  const groups: HistorySetGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && entry.set && last.set?.id === entry.set.id) {
      last.entries.push(entry);
      last.score += entry.score;
      continue;
    }
    groups.push({
      key: `${entry.set ? `set-${entry.set.id}` : 'board'}:${entry.playing_id}`,
      set: entry.set,
      tableId: entry.table_id,
      entries: [entry],
      score: entry.score,
    });
  }
  return groups;
}
