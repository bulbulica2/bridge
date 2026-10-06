import type { PublicPlaying } from '@/services/game';
import type { BroadcastTable, Seat, TableSeat } from '@/services/tables';
import { sideOf } from '@/utils/result';
import type { Side } from '@/utils/result';
import { runningSet } from '@/utils/sets';

// Away mid-set (bridge_backend docs/API.md, Away mid-set, and the turn
// clock): a player with no sign of life for a minute, or who pressed Leave,
// is marked away and their seat held. Each away seat has its own clock
// (bb#138): `replace_at`, two minutes on from `away_since`, running whoever's
// turn it is, every away seat's at once, so players who went together are
// replaced together. The seat's tag counts it down ("away · 0:42"); an
// admin has none (the table waits for them). The player the board waits
// for when they are there has TURN_SECONDS to act (the game state's
// `turn_deadline`, utils/turnClock). Nothing is decided here.

// BRIDGE_TURN_SECONDS' default, the time a player who is there gets on
// their turn. A countdown always reads `turn_deadline`.
export const TURN_SECONDS = 60;

// BRIDGE_AWAY_REPLACE_SECONDS' default: how long an away seat is kept. The
// Leave confirmations quote it; a countdown always reads `replace_at`.
export const AWAY_REPLACE_SECONDS = 120;

// The last seconds of an away seat's clock, when its tag turns red.
export const AWAY_URGENT_SECONDS = 15;

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
// claim's `expires_at`, a seat's `replace_at`), never below 0.
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

// The tag on an away seat: `seconds` left on its clock (0 once it ran out,
// until the update with the robot lands), null for a seat with no clock
// (an admin's).
export interface AwayTag {
  seconds: number | null;
  urgent: boolean;
}

export function awayTag(seat: Pick<TableSeat, 'replace_at'>, now: number): AwayTag {
  if (!seat.replace_at) {
    return { seconds: null, urgent: false };
  }
  const seconds = secondsLeft(seat.replace_at, now);
  return { seconds, urgent: seconds <= AWAY_URGENT_SECONDS };
}

// The others' away seats at `table` (not `exceptUserId`'s), each with its
// tag as it stands at `now`.
export function awayTags(
  table: BroadcastTable,
  exceptUserId: number | null,
  now: number,
): Partial<Record<Seat, AwayTag>> {
  return Object.fromEntries(awaySeats(table, exceptUserId).map((s) => [s.seat, awayTag(s, now)]));
}

// Whether any away seat at `table` has a clock running, so a page ticks.
export function awayClockRuns(table: BroadcastTable | null): boolean {
  return !!table && table.seats.some((s) => isAway(s) && !!s.replace_at);
}

// "away", "away · 0:42", or "replacing…" once the clock has run out.
export function awayTagText(tag: AwayTag): string {
  if (tag.seconds === null) {
    return 'away';
  }
  return tag.seconds === 0 ? 'replacing…' : `away · ${formatClock(tag.seconds)}`;
}

// The one line under the table while others are away (the seats' tags
// tell who and how long): what their clocks are for. Only admins away: the
// table waits for them.
export const AWAY_NOTE = 'Away players are replaced by a robot when their clock runs out.';
export const ADMIN_AWAY_NOTE = 'An admin is away: the table waits for them.';

export function awayNote(table: BroadcastTable, exceptUserId: number | null): string | null {
  const seats = awaySeats(table, exceptUserId);
  if (seats.length === 0) {
    return null;
  }
  return seats.some((s) => !s.user.is_admin) ? AWAY_NOTE : ADMIN_AWAY_NOTE;
}

type HeldSeat = Pick<TableSeat, 'replace_at'> & { user: Pick<TableSeat['user'], 'is_admin'> };

// What the user sees of their own held seat, away from the table: "You're
// away from Friday club: a robot takes your seat in 0:42 unless you come
// back." An admin's just waits.
export function heldText(
  seat: HeldSeat,
  table: Pick<BroadcastTable, 'id' | 'name'>,
  now: number,
): string {
  const name = table.name || `table #${table.id}`;
  if (seat.user.is_admin) {
    return `You're away from ${name}: your seat is held until you come back.`;
  }
  const { seconds } = awayTag(seat, now);
  if (seconds === null) {
    return `You're away from ${name}: come back before a robot takes your seat.`;
  }
  return seconds === 0
    ? `You're away from ${name}: a robot is taking your seat…`
    : `You're away from ${name}: a robot takes your seat in ${formatClock(seconds)} unless you come back.`;
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
