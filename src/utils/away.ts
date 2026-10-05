import type { PublicPlaying } from '@/services/game';
import type { BroadcastTable, Seat, TableSeat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { SIDE_LABELS, sideOf } from '@/utils/result';
import type { Side } from '@/utils/result';
import { runningSet } from '@/utils/sets';

// Away mid-set (bridge_backend docs/API.md, Away mid-set): a player with no
// sign of life for a minute is marked away and their seat held. The clock
// runs only for the away player the board is waiting for (on turn): their
// seat gets `forfeit_at`, three minutes from when the board began waiting
// for them, and still away then their side forfeits the set. Every other
// away seat has `forfeit_at: null` until the turn reaches it, so at most one
// countdown shows at a time. The backend keeps the clock; the countdown here
// only reads `forfeit_at` against the time now. Nothing is decided here.

// BRIDGE_SET_FORFEIT_MINUTES' default. The confirmations quote it, and the
// away lines of a seat whose clock hasn't started yet; a countdown always
// reads the seat's `forfeit_at`.
export const SET_FORFEIT_MINUTES = 3;

export function isAway(seat: Pick<TableSeat, 'away_since'>): boolean {
  return !!seat.away_since;
}

// The seats whose players are away, but `exceptUserId`'s (the viewer, whose
// own absence is told differently). Robots are never away.
export function awaySeats(table: BroadcastTable, exceptUserId: number | null = null): TableSeat[] {
  return table.seats.filter((s) => isAway(s) && s.user_id !== exceptUserId);
}

// The user's own seat at `table` when it is away (held for them), else null.
export function myAwaySeat(table: BroadcastTable, userId: number | null): TableSeat | null {
  const seat = table.seats.find((s) => s.user_id === userId);
  return seat && isAway(seat) ? seat : null;
}

// Whole seconds until `deadline` (a seat's `forfeit_at`, a claim's
// `expires_at`), never below 0.
export function secondsLeft(deadline: string, now: number): number {
  const ms = Date.parse(deadline) - now;
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / 1000));
}

// 161 → "2:41".
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// While an admin at the table is away nobody forfeits: no clock runs, and
// the table just waits (bridge_backend docs/API.md, Away mid-set). Read from
// the seats, since `forfeit_at: null` alone mostly means "not their turn".
export function forfeitSuspended(table: BroadcastTable): boolean {
  return table.seats.some((s) => isAway(s) && !!s.user.is_admin);
}

// "3:00", the time a player gets once the board waits for them.
function fullClock(): string {
  return formatClock(SET_FORFEIT_MINUTES * 60);
}

// What the others see of one away seat. With a clock (the player on turn):
// "East is away. E-W lose the set in 2:41 unless they come back." Without
// one, not their turn yet: "South is away. N-S lose the set if they aren't
// back within 3:00 of their turn." `waits` (forfeitSuspended: an admin is
// away) means no clock is coming: the table just waits.
export function awayText(seat: Pick<TableSeat, 'seat' | 'forfeit_at'>, now: number, waits = false): string {
  const name = SEAT_NAMES[seat.seat];
  const side = SIDE_LABELS[sideOf(seat.seat)];
  if (!seat.forfeit_at) {
    return waits
      ? `${name} is away. The table waits for them.`
      : `${name} is away. ${side} lose the set if they aren't back within ${fullClock()} of their turn.`;
  }
  const left = secondsLeft(seat.forfeit_at, now);
  if (left === 0) {
    return `${name} is away. ${side} lose the set any moment now.`;
  }
  return `${name} is away. ${side} lose the set in ${formatClock(left)} unless they come back.`;
}

// Several away seats with no clock, told in one line: "South and West are
// away." and what that will cost once the turn reaches them.
export function awayTogetherText(seats: Pick<TableSeat, 'seat'>[], waits = false): string {
  const names = seats.map((s) => SEAT_NAMES[s.seat]);
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  const verb = names.length > 1 ? 'are' : 'is';
  return waits
    ? `${who} ${verb} away. The table waits for them.`
    : `${who} ${verb} away. Whoever isn't back within ${fullClock()} of their turn loses the set for their side.`;
}

// What the user sees of their own held seat, away from the table: "Your
// seat is held. N-S lose the set in 2:41 unless you come back." once the
// board waits for them, "… if you aren't back within 3:00 of your turn."
// before. `waits` as for awayText.
export function heldText(seat: Pick<TableSeat, 'seat' | 'forfeit_at'>, now: number, waits = false): string {
  const side = SIDE_LABELS[sideOf(seat.seat)];
  if (!seat.forfeit_at) {
    return waits
      ? 'Your seat is held while you are away.'
      : `Your seat is held. ${side} lose the set if you aren't back within ${fullClock()} of your turn.`;
  }
  const left = secondsLeft(seat.forfeit_at, now);
  if (left === 0) {
    return `Your seat is held, but time is up: ${side} lose the set any moment now.`;
  }
  return `Your seat is held. ${side} lose the set in ${formatClock(left)} unless you come back.`;
}

// What walking out of `table` now would put at stake: the user's side, and
// whether it costs that side the set (`forfeits`) or only breaks the set off
// with no winner. Null outside a set, or when the user doesn't sit there.
// An admin never forfeits, and nobody does while an admin here is away
// (forfeitSuspended).
export interface SetAtStake {
  number: number;
  seat: Seat;
  side: Side;
  forfeits: boolean;
}

export function setAtStake(
  table: BroadcastTable,
  playing: PublicPlaying | null,
  userId: number | null,
  isAdmin = false,
): SetAtStake | null {
  const set = runningSet(table, playing);
  const mine = table.seats.find((s) => s.user_id === userId);
  if (!set || !mine) {
    return null;
  }
  return {
    number: set.number,
    seat: mine.seat,
    side: sideOf(mine.seat),
    forfeits: !isAdmin && !forfeitSuspended(table),
  };
}

// A set the user's side lost by forfeit while they were away from it.
export interface LostSet {
  id: number;
  number: number;
  side: Side;
  // Where it was played, so only that table's pages act on it.
  tableId: number;
}

// "You were away too long: N-S lost set 3 by forfeit."
export function lostSetText(lost: LostSet): string {
  return `You were away too long: ${SIDE_LABELS[lost.side]} lost set ${lost.number} by forfeit.`;
}
