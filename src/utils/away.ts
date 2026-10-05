import type { PublicPlaying } from '@/services/game';
import type { BroadcastTable, Seat, TableSeat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { sideOf } from '@/utils/result';
import type { Side } from '@/utils/result';
import { runningSet } from '@/utils/sets';

// Away mid-set (bridge_backend docs/API.md, Away mid-set, and the turn
// clock): a player with no sign of life for a minute is marked away and
// their seat held. A seat has no clock of its own (bb#120): the player the
// board waits for, away or not, has TURN_SECONDS to act (the game state's
// `turn_deadline`, utils/turnClock), and letting it run out hands their seat
// to a robot for the rest of the set. So an away player costs nothing until
// the turn reaches them, and these lines only say who is away. Nothing is
// decided here.

// BRIDGE_TURN_SECONDS' default. The away lines and the confirmations quote
// it; a countdown always reads `turn_deadline`.
export const TURN_SECONDS = 60;

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

// Whole seconds until `deadline` (the game state's `turn_deadline`, a
// claim's `expires_at`), never below 0.
export function secondsLeft(deadline: string, now: number): number {
  const ms = Date.parse(deadline) - now;
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / 1000));
}

// 161 → "2:41".
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// While an admin at the table is away, a Leave or a move by anyone else is
// immediate and breaks the set off: nobody's seat is held or handed to a
// robot (bridge_backend docs/API.md, Away mid-set, Admins).
export function adminAway(table: BroadcastTable): boolean {
  return table.seats.some((s) => isAway(s) && !!s.user.is_admin);
}

// "1:00", the time a player gets once the board waits for them.
function turnClock(): string {
  return formatClock(TURN_SECONDS);
}

type AwaySeat = Pick<TableSeat, 'seat'> & { user: Pick<TableSeat['user'], 'is_admin'> };

// What the others see of one away seat: "East is away. If they don't play
// within 1:00 of their turn, a robot takes their seat." An admin has no
// turn clock: the table just waits for them.
export function awayText(seat: AwaySeat): string {
  const name = SEAT_NAMES[seat.seat];
  return seat.user.is_admin
    ? `${name} is away. The table waits for them.`
    : `${name} is away. If they don't play within ${turnClock()} of their turn, a robot takes their seat.`;
}

// Several away seats (no admin among them), told in one line: "South and
// West are away." and what that will cost once the turn reaches them.
export function awayTogetherText(seats: Pick<TableSeat, 'seat'>[]): string {
  const names = seats.map((s) => SEAT_NAMES[s.seat]);
  const who = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${who} are away. Whoever doesn't play within ${turnClock()} of their turn is replaced by a robot.`;
}

// What the user sees of their own held seat, away from the table: "Your
// seat is held. If you aren't back to play within 1:00 of your turn, a
// robot takes it for the rest of the set." An admin's just waits.
export function heldText(seat: AwaySeat): string {
  return seat.user.is_admin
    ? 'Your seat is held while you are away.'
    : `Your seat is held. If you aren't back to play within ${turnClock()} of your turn, a robot takes it for the rest of the set.`;
}

// What walking out of `table` now would put at stake: the user's seat and
// side in the set going on, and whether a Leave only holds the seat
// (`held`: then a walk-out hands it to a robot, as long as another human is
// left to play with it) or breaks the set off with no winner. Null outside
// a set, or when the user doesn't sit there. An admin's Leave is never
// held, nor anyone's while an admin here is away (adminAway).
export interface SetAtStake {
  number: number;
  seat: Seat;
  side: Side;
  held: boolean;
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
    held: !isAdmin && !adminAway(table),
  };
}
