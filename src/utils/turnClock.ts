import type { DeadlineBy, PublicPlaying } from '@/services/game';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { formatClock, secondsLeft } from '@/utils/away';

// The turn clock (bridge_backend docs/API.md, Away mid-set, and the turn
// clock; bb#120): the human the board waits for has a minute to call, play
// or act on a claim, until the game state's `turn_deadline`. Past it the
// backend's check (every 10 s) hands their seat to a robot for the rest of
// the set. The countdown reads the deadline against the time now, never
// from when the state arrived; nothing is decided here. The deadline is the
// end of the player's time for the set instead when that comes first
// (`turn_deadline_by: "set"`, bb#131; their bank, utils/setClock).

// The last seconds, when the player on turn sees the clock in red.
export const TURN_URGENT_SECONDS = 15;

export const TIME_UP_TEXT = 'Time is up…';

export interface TurnClock {
  // Whole seconds left, 0 once the deadline has passed.
  seconds: number;
  // The clock is the viewer's own.
  mine: boolean;
  // The seat whose player the board waits for (declarer on dummy's turn).
  seat: Seat | null;
  // Which clock it is: the move's minute, or the player's time for the set.
  by: DeadlineBy;
}

// The deadline running in `state`, if any: only during the auction and the
// play (the backend sends none otherwise, nor for a robot or an admin).
export function turnDeadline(state: PublicPlaying | null): string | null {
  return state && (state.phase === 'auction' || state.phase === 'play') ? (state.turn_deadline ?? null) : null;
}

// The seat of `acting_user_id`: on dummy's turn that is declarer's, who
// plays it. The turn's own seat when the players don't say.
export function actingSeat(state: PublicPlaying): Seat | null {
  const entry = Object.entries(state.players ?? {}).find(([, user]) => user.id === state.acting_user_id);
  return (entry?.[0] as Seat | undefined) ?? state.turn;
}

// The turn clock as it stands at `now`, or null when none runs.
export function turnClock(state: PublicPlaying | null, me: number | null, now: number): TurnClock | null {
  const deadline = turnDeadline(state);
  if (!state || !deadline) {
    return null;
  }
  return {
    seconds: secondsLeft(deadline, now),
    mine: me !== null && state.acting_user_id === me,
    seat: actingSeat(state),
    by: state.turn_deadline_by ?? 'move',
  };
}

// "Your turn · 0:42", "Waiting for East · 0:42", or "Time is up…" until
// the backend's update lands. When the time for the set runs out first:
// "Your time for the set: 0:42" or "East's time for the set: 0:42".
export function turnClockText(clock: TurnClock): string {
  if (clock.seconds === 0) {
    return TIME_UP_TEXT;
  }
  const time = formatClock(clock.seconds);
  if (clock.by === 'set') {
    const whose = clock.mine ? 'Your' : clock.seat ? `${SEAT_NAMES[clock.seat]}'s` : 'The';
    return `${whose} time for the set: ${time}`;
  }
  if (clock.mine) {
    return `Your turn · ${time}`;
  }
  return clock.seat ? `Waiting for ${SEAT_NAMES[clock.seat]} · ${time}` : `Waiting · ${time}`;
}

// The viewer's own clock in its last seconds: the page shows it in red.
export function turnUrgent(clock: TurnClock | null): boolean {
  return !!clock && clock.mine && clock.seconds <= TURN_URGENT_SECONDS;
}

// The tab's title while it is hidden and the board waits for the viewer:
// "● Your turn (0:42) – Bridge".
export function turnTitle(clock: TurnClock, title: string): string {
  return `● Your turn (${formatClock(clock.seconds)}) – ${title}`;
}
