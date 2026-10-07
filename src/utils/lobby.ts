import type { SetPosition } from '@/services/game';
import { SEATS, UNATTENDED_MINUTES } from '@/services/tables';
import type { BroadcastTable, Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES } from '@/utils/auction';

// The Tables page's lobby (the Daylight Lobby board, #162): the open tables
// filtered and counted client-side over GET /tables (the list has no
// channel), each told in one meta line, a status pill and a mini compass.

export type TableFilter = 'all' | 'free' | 'playing' | 'robots';

export const TABLE_FILTERS: { value: TableFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'free', label: 'Seat free' },
  { value: 'playing', label: 'Playing' },
  { value: 'robots', label: 'Robots only' },
];

// "Robots only" is an unattended table (the last human left): anyone may sit
// down and run it.
export function matchesFilter(table: BroadcastTable, filter: TableFilter): boolean {
  switch (filter) {
    case 'free':
      return table.free_seats.length > 0;
    case 'playing':
      return table.board_id !== null;
    case 'robots':
      return table.unattended_since !== null;
    default:
      return true;
  }
}

// How many tables each chip would show.
export function filterCounts(tables: BroadcastTable[]): Record<TableFilter, number> {
  const count = (filter: TableFilter) => tables.filter((t) => matchesFilter(t, filter)).length;
  return { all: tables.length, free: count('free'), playing: count('playing'), robots: count('robots') };
}

// The pill on a table's card: `wait` (orange) when seats are free, `play`
// (navy) for a board on or a full table, `robots` (blue) when only robots
// are left.
export type TableTone = 'wait' | 'play' | 'robots';

export function tableStatus(table: BroadcastTable): { text: string; tone: TableTone } {
  if (table.unattended_since) {
    return { text: 'Robots only', tone: 'robots' };
  }
  const free = table.free_seats.length;
  if (free > 0) {
    return { text: `${free} seat${free === 1 ? '' : 's'} free`, tone: 'wait' };
  }
  return { text: table.board_id !== null ? 'Playing' : 'Full', tone: 'play' };
}

// Whole minutes since an ISO time, never below 0.
function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

// The card's meta line: "16 min · set 2 · board 2/4" (each player's time
// for a set, then where the table is), "16 min · no set yet", or for an
// unattended table "left 3 min ago · closes in 7" (the backend deletes it
// after UNATTENDED_MINUTES).
export function tableMeta(table: BroadcastTable, now: number = Date.now()): string {
  if (table.unattended_since) {
    const left = minutesSince(table.unattended_since, now);
    const closes = Math.max(0, UNATTENDED_MINUTES - left);
    return `left ${left} min ago · closes in ${closes}`;
  }
  const set = table.set;
  const where = !set ? 'no set yet' : set.finished ? `set ${set.number} over` : `set ${set.number} · board ${set.board}/${set.of}`;
  return `${table.set_minutes} min · ${where}`;
}

// One seat of the mini compass: who sits there and how to draw them (the
// viewer, a robot in blue, an away player in red, a player), or nobody.
export type CompassKind = 'me' | 'robot' | 'away' | 'player' | 'empty';

export interface CompassSeat {
  seat: Seat;
  user: PublicUser | null;
  kind: CompassKind;
}

export function compassSeats(table: BroadcastTable, me: number | null): Record<Seat, CompassSeat> {
  return Object.fromEntries(
    SEATS.map((seat) => {
      const taken = table.seats.find((s) => s.seat === seat);
      const user = taken?.user ?? null;
      let kind: CompassKind = 'empty';
      if (taken) {
        if (taken.user_id === me) {
          kind = 'me';
        } else if (user?.is_robot) {
          kind = 'robot';
        } else if (taken.away_since) {
          kind = 'away';
        } else {
          kind = 'player';
        }
      }
      return [seat, { seat, user, kind }];
    }),
  ) as Record<Seat, CompassSeat>;
}

const PARTNER: Record<Seat, Seat> = { N: 'S', S: 'N', E: 'W', W: 'E' };

// The Your table hero's line: "Set 3 · Board 2 of 4 · you sit South with
// radu" ("No set yet · …" before the first Start, "Set 3 over · …" after its
// last board; no partner while that seat is empty).
export function yourTableLine(
  table: BroadcastTable,
  me: number | null,
  set: Pick<SetPosition, 'number' | 'board' | 'of' | 'finished'> | null,
): string {
  const where = !set ? 'No set yet' : set.finished ? `Set ${set.number} over` : `Set ${set.number} · Board ${set.board} of ${set.of}`;
  const mine = table.seats.find((s) => s.user_id === me);
  if (!mine) {
    return where;
  }
  const partner = table.seats.find((s) => s.seat === PARTNER[mine.seat])?.user.username;
  return `${where} · you sit ${SEAT_NAMES[mine.seat]}${partner ? ` with ${partner}` : ''}`;
}
