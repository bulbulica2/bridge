import type { PublicPlaying, ReplacementReason, SetPosition, SetReplacement, SideCode } from '@/services/game';
import type { PlayingHistoryEntry, SetResults } from '@/services/history';
import { SEATS } from '@/services/tables';
import type { BroadcastTable, Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { SIDE_LABELS, matchpointPercent, sideOf } from '@/utils/result';
import type { Side } from '@/utils/result';

// Sets of boards (bridge_backend docs/API.md, Sets): Start deals a set's
// first board, the other three are dealt by themselves (`next_board_at`), and
// after the fourth it is everyone's Start again. The backend adds up the set (GET /sets/{id}); this only words
// it and turns it round for the side looking at it. Scores are never added
// up over a set: each board is compared with the other tables (matchpoints).

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
    // Replacements only add up over a set: the longer list is the later.
    replaced: replacementsOf(fromBoard).length > replacementsOf(fromTable).length
      ? fromBoard.replaced
      : fromTable.replaced,
  };
}

// The set the table is in the middle of (a board of it on, or between its
// boards), else null: no set yet, or the last one is over. Mid-set, walking
// out hands the seat to a robot (bridge_backend docs/API.md, Away mid-set).
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
// set.", or "N-S won the set." for someone who didn't play it. Null while
// the set goes on.
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
  if (seat) {
    return sideOf(seat) === winner ? 'You won the set.' : 'You lost the set.';
  }
  return `${SIDE_LABELS[winner]} won the set.`;
}

// Did the viewer's side win (true), lose (false), or neither (null)?
export function setWon(set: SetResults, seat: Seat | null): boolean | null {
  if (!seat || !set.finished || set.winner === null || set.ended === 'abandoned') {
    return null;
  }
  return sideOf(seat) === sideOfCode(set.winner);
}

// A set's replacements, [] for a payload that has none.
export function replacementsOf(set: Pick<SetPosition, 'replaced'> | null | undefined): SetReplacement[] {
  return set?.replaced ?? [];
}

// Why a robot took a seat over (bridge_backend docs/API.md, Away mid-set),
// said of somebody else and of the viewer.
const REPLACED_WHY: Record<ReplacementReason, { them: string; you: string }> = {
  turn_timeout: { them: "didn't play in time", you: "didn't play in time" },
  set_time: { them: 'ran out of time for the set', you: 'ran out of time for the set' },
  away: { them: 'was away on their turn', you: 'were away on your turn' },
  moved: { them: 'moved to another table', you: 'moved to another table' },
  kicked: { them: 'was removed while away', you: 'were removed while away' },
};

// "East didn't play in time: a robot took their seat.", or for the player
// it replaced, `mine`: "You didn't play in time: a robot took your seat."
// Out of time for the set: "East ran out of time for the set: a robot took…"
export function replacedText(entry: Pick<SetReplacement, 'seat' | 'reason'>, mine = false): string {
  const why = REPLACED_WHY[entry.reason];
  return mine
    ? `You ${why.you}: a robot took your seat.`
    : `${SEAT_NAMES[entry.seat]} ${why.them}: a robot took their seat.`;
}

// The viewer's seat in a set's results: the seat they play, or the one a
// robot took over from them (their side is still the one they played for).
export function seatInSet(set: Pick<SetResults, 'players' | 'replaced'>, userId: number | null | undefined): Seat | null {
  if (userId == null) {
    return null;
  }
  return (
    SEATS.find((seat) => set.players[seat]?.id === userId) ??
    replacementsOf(set).find((r) => r.user_id === userId)?.seat ??
    null
  );
}

// A set a robot took the user's seat over in while they were away from the
// table (their turn clock ran out, or a kick while away): told on Home until
// dismissed, and the pages of that table go to its results.
export interface ReplacedFrom {
  id: number;
  number: number;
  seat: Seat;
  reason: ReplacementReason;
  // Where it was played, so only that table's pages act on it.
  tableId: number;
}

// The replacement of `userId` in `set`, unless they walked out themselves by
// moving (they know: they confirmed it).
export function replacementOf(
  set: Pick<SetPosition, 'replaced'> | null | undefined,
  userId: number | null | undefined,
): SetReplacement | null {
  return replacementsOf(set).find((r) => r.user_id === userId && r.reason !== 'moved') ?? null;
}

// "You didn't play in time: a robot took your seat. You may sit down at
// that table again once set 3 is over."
export function replacedFromText(replaced: Pick<ReplacedFrom, 'seat' | 'reason' | 'number'>): string {
  return `${replacedText(replaced, true)} You may sit down at that table again once set ${replaced.number} is over.`;
}

// The viewer's side of the totals (N-S for someone who didn't play it):
// the matchpoints out of the top and as a percentage (null while no other
// table has played any of its boards).
export function setTotals(set: SetResults, seat: Seat | null) {
  const side: Side = seat ? sideOf(seat) : 'ns';
  const matchpoints = set.totals.matchpoints[side];
  return {
    side,
    matchpoints,
    top: set.totals.top,
    percent: matchpointPercent(matchpoints, set.totals.top),
  };
}

// The owner's side's matchpoints over a set as a percentage, from its
// results if they have been read; null when they haven't, or no other table
// has played its boards yet.
export function setPercent(set: SetResults | undefined, seat: Seat): number | null {
  return set ? setTotals(set, seat).percent : null;
}

// A run of history entries from one set, with the owner's seat in it (to
// turn the set's matchpoints to their side). `set` is null for entries made
// outside any set.
export interface HistorySetGroup {
  key: string;
  set: PlayingHistoryEntry['set'];
  tableId: number | null;
  seat: Seat;
  entries: PlayingHistoryEntry[];
}

// The history (latest first) cut into runs of the same set (an older page
// can add more boards to the last). Entries without a set stand in runs of
// their own. No score is added up: a set is told by its matchpoints.
export function groupBySet(entries: PlayingHistoryEntry[]): HistorySetGroup[] {
  const groups: HistorySetGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && entry.set && last.set?.id === entry.set.id) {
      last.entries.push(entry);
      continue;
    }
    groups.push({
      key: `${entry.set ? `set-${entry.set.id}` : 'board'}:${entry.playing_id}`,
      set: entry.set,
      tableId: entry.table_id,
      seat: entry.seat,
      entries: [entry],
    });
  }
  return groups;
}
