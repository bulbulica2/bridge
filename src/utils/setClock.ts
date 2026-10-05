import type { PublicPlaying } from '@/services/game';
import type { SetResults } from '@/services/history';
import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { formatClock } from '@/utils/away';
import { actingSeat, turnDeadline } from '@/utils/turnClock';

// The set clock (bridge_backend docs/API.md, The set clock; bb#131): each
// human has a time bank for the whole set, the table's `set_minutes`, like a
// chess clock. Only the bank of the player the board waits for runs (the
// same player whose turn clock runs, `acting_user_id`); the backend charges
// it on every move and replaces a player whose bank runs out with a robot
// (`set_time`). `set.time_left` is each seat's bank as of `turn_started_at`,
// so the running one is counted down from then, never from when the state
// arrived. Robots and admins have none (null). Nothing is decided here.

// Under a minute left, a seat's bank shows in red.
export const SET_LOW_SECONDS = 60;

export interface SeatBank {
  // Whole seconds left, 0 once it has run out.
  seconds: number;
  // It is the bank running now (the board waits for that seat's player).
  running: boolean;
  // Under SET_LOW_SECONDS left.
  low: boolean;
}

// What is left at `now` of a bank that had `left` seconds at `startedAt`
// and has run since: never below 0, nor above `left` (a clock running
// behind the server's).
export function bankLeft(left: number, startedAt: string | null, now: number): number {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (Number.isNaN(started)) {
    return left;
  }
  return Math.min(left, Math.max(0, Math.ceil(left - (now - started) / 1000)));
}

// Each seat's bank at `now`: the acting seat's counting down while its turn
// clock runs (the auction or the play, no claim pending), the others' as
// they stood. No entry for a robot or an admin, nor without a set.
export function setBanks(state: PublicPlaying | null, now: number): Partial<Record<Seat, SeatBank>> {
  const left = state?.set?.time_left;
  if (!state || !left) {
    return {};
  }
  const runs = turnDeadline(state) !== null ? actingSeat(state) : null;
  const banks: Partial<Record<Seat, SeatBank>> = {};
  for (const seat of SEATS) {
    const seatLeft = left[seat];
    if (seatLeft == null) {
      continue;
    }
    const running = seat === runs;
    const seconds = running ? bankLeft(seatLeft, state.turn_started_at, now) : Math.max(0, seatLeft);
    banks[seat] = { seconds, running, low: seconds < SET_LOW_SECONDS };
  }
  return banks;
}

// "North's time for the set: 13:32", the bank's label for a screen reader.
export function bankLabel(seat: Seat, bank: SeatBank): string {
  return `${SEAT_NAMES[seat]}'s time for the set: ${formatClock(bank.seconds)}`;
}

// "16 minutes each for a set of 4 boards".
export function setClockText(minutes: number): string {
  return `${minutes} minutes each for a set of 4 boards`;
}

// "10:48 of 16:00", a player's time used of their time for the set.
export function timeUsedText(seconds: number, minutes: number): string {
  return `${formatClock(seconds)} of ${formatClock(minutes * 60)}`;
}

// One row of a set's "Time used": the seat ("North", "South (you)", with
// the player's username unless a robot sits there now, having taken it
// over) and "10:48 of 16:00".
export interface TimeUsedRow {
  seat: Seat;
  who: string;
  text: string;
}

// Each human's time used of their time for the set, in seat order; none for
// a seat a robot or an admin played from the start, nor without the clock.
export function timeUsedRows(
  set: Pick<SetResults, 'players' | 'minutes' | 'time_used'>,
  mySeat: Seat | null,
): TimeUsedRow[] {
  const used = set.time_used;
  if (!used) {
    return [];
  }
  return SEATS.filter((seat) => used[seat] != null).map((seat) => {
    const player = set.players[seat];
    const name = SEAT_NAMES[seat];
    let who = name;
    if (seat === mySeat) {
      who = `${name} (you)`;
    } else if (player && !player.is_robot) {
      who = `${name} · ${player.username}`;
    }
    return { seat, who, text: timeUsedText(used[seat]!, set.minutes) };
  });
}
