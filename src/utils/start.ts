import type { PublicPlaying } from '@/services/game';
import { SEATS } from '@/services/tables';
import type { BroadcastTable, TableSeat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';

// Start (bridge_backend docs/API.md, Dealing): a board is dealt once the table
// is full and every human seated there has pressed it. These are hints for
// what to show; the backend's 409 has the final say.

// Robots are ready from the moment they sit down.
export function isReady(seat: TableSeat): boolean {
  return seat.ready || seat.user.is_robot;
}

// Does the next board wait for Start? Always while the table has no board
// (none yet, or one abandoned). With a finished board on the table, the same
// four go on with Next (playing/next), and Start takes over only once one of
// them has been replaced or changed seats. During a board, never. `playing`
// is the state held for this table, if any: a board we can't see the phase
// of says no.
export function startNeeded(table: BroadcastTable, playing: PublicPlaying | null): boolean {
  if (table.board_id === null) {
    return true;
  }
  if (playing?.phase !== 'finished' || playing.board?.id !== table.board_id) {
    return false;
  }
  return SEATS.some(
    (seat) => table.seats.find((s) => s.seat === seat)?.user_id !== playing.players?.[seat]?.id,
  );
}

// "a", "a and b", "a, b and c".
function listOf(items: string[]): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// What the board still waits for: "Waiting for a fourth player.", "Waiting
// for North (ann) and you to press Start.", or both. Null once nothing is
// missing (the board is being dealt).
export function startWaiting(table: BroadcastTable, me: number | null): string | null {
  const free = table.free_seats.length;
  const names = SEATS.flatMap((seat) => {
    const held = table.seats.find((s) => s.seat === seat);
    if (!held || isReady(held)) {
      return [];
    }
    return [held.user_id === me ? 'you' : `${SEAT_NAMES[seat]} (${held.user.username})`];
  });
  const parts: string[] = [];
  if (free > 0) {
    parts.push(free === 1 ? 'a fourth player' : `${free} more players`);
  }
  if (names.length > 0) {
    parts.push(`${listOf(names)} to press Start`);
  }
  return parts.length > 0 ? `Waiting for ${parts.join(', and for ')}.` : null;
}
