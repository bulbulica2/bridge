import http from './http';
import type { Playing, SetPosition } from './game';
import type { PublicUser } from './users';

// Game endpoints answer with an envelope: {status, message, data}.
// See bridge_backend docs/API.md.
interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

export const SEATS = ['N', 'E', 'S', 'W'] as const;

export type Seat = (typeof SEATS)[number];

export interface TableSeat {
  id: number;
  table_id: number;
  user_id: number;
  seat: Seat;
  // Whether this player has pressed Start (POST /tables/{id}/start). Public,
  // so everyone sees who the board waits for; a robot's is always true.
  ready: boolean;
  // Mid-set only: since when this player has been away (their last sign of
  // life, or their Leave), their seat held for them; null when they are
  // here. A seat has no clock of its own: how long the board still waits
  // for the player on turn, away or not, is the game state's `turn_deadline`
  // (bb#120). See bridge_backend docs/API.md, Away mid-set, and utils/away.
  away_since: string | null;
  user: PublicUser;
}

// A table as `TableUpdated` broadcasts it: every field of the HTTP payload
// but `can_manage`, which is the caller's own answer and a broadcast has no
// single caller.
export interface BroadcastTable {
  id: number;
  name: string | null;
  created_by: number | null;
  moderated_by: number | null;
  board_id: number | null;
  // Set while only robots sit here (the last human left): they wait, anyone
  // may remove them, the first human to sit down runs the table, and the
  // backend deletes it after UNATTENDED_MINUTES. Null at every other table.
  unattended_since: string | null;
  created_at: string;
  updated_at: string;
  seats: TableSeat[];
  free_seats: Seat[];
  // The set the table is on, or the one it finished last; `board` is how
  // many of its boards have been dealt. Null before the first Start. A
  // board finishing sends no TableUpdated, so after the last board only the
  // game state's `set` says the set is over (`currentSet` in utils/sets).
  set: SetPosition | null;
}

// A table as the HTTP endpoints answer it. `can_manage` is TablePolicy::manage
// for the caller (the moderator or any admin, never the creator as such), so
// the manager controls show from it rather than from moderated_by/created_by.
export interface Table extends BroadcastTable {
  can_manage: boolean;
}

export interface CreateTablePayload {
  name?: string | null;
  seat?: Seat;
  // Robots take the other three seats. Nothing is dealt until the creator
  // presses Start, which then deals at once (robots are always ready).
  robots?: boolean;
}

// BRIDGE_UNATTENDED_TABLE_MINUTES' default: how long a table with only robots
// left is kept for somebody to take it over.
export const UNATTENDED_MINUTES = 10;

// Newest first. Requires a logged-in session (401 otherwise).
export async function listTables(): Promise<Table[]> {
  const { data } = await http.get<ApiResponse<Table[]>>('/tables');
  return data.data;
}

// Creates the table and seats the creator; 409 if they already sit somewhere
// or already have 3 active tables. With `robots` the table is full, but its
// board_id stays null until the creator presses Start.
// The creator sits South unless told otherwise (the backend's default is
// North): the table is drawn from the viewer's seat at the bottom, and South
// is where the player who sets up the game sits. Robots take N, E and W.
export const CREATOR_SEAT: Seat = 'S';

export async function createTable(payload: CreateTablePayload): Promise<Table> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.post<ApiResponse<Table>>('/tables', { seat: CREATOR_SEAT, ...payload });
  return data.data;
}

// Takes a free seat. Holding a seat already makes this a move, not a 409: at
// the same table it is a plain seat change; off another table it frees the old
// seat with every consequence of leaving it, and the response only describes
// the table joined. 409 if the seat is taken or unknown.
export async function joinSeat(tableId: number, seat: Seat): Promise<Table> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.post<ApiResponse<Table>>(`/tables/${tableId}/seats`, { seat });
  return data.data;
}

// A table exists only while somebody sits at it, so giving up the last seat
// deletes it. The envelope then carries this instead of a table.
export interface TableDeleted {
  table_deleted: true;
}

export type SeatRemovalResult = Table | TableDeleted;

export function isTableDeleted(result: SeatRemovalResult): result is TableDeleted {
  return (result as TableDeleted).table_deleted === true;
}

// One table. 404 once the last player has left and the backend deleted it.
export async function getTable(tableId: number): Promise<Table> {
  const { data } = await http.get<ApiResponse<Table>>(`/tables/${tableId}`);
  return data.data;
}

// Gives up your own seat; 409 if you don't sit here. In the middle of a set
// it is a 202 that *holds* the seat instead: the table comes back with us
// still in it, away, and any request at the table (a heartbeat, GET
// /playing) brings us back. Once the board waits for us (at once on our
// turn) our turn clock runs as anyone's (`turn_deadline`): not back and
// played by then, a robot takes the seat for the rest of the set.
export async function leaveSeat(tableId: number): Promise<SeatRemovalResult> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.delete<ApiResponse<SeatRemovalResult>>(`/tables/${tableId}/seats`);
  return data.data;
}

// "Still here": keeps the caller's seat from being freed as idle. The backend
// frees a seat nobody has vouched for in a few minutes (through the normal
// leave path) and, mid-set, marks a player away after a minute, so a seated
// client sends this about every 30 s. It never resets the turn clock: only
// playing does (bb#120). It also brings an away player back (a held seat after a Leave too).
// 403 once the caller no longer sits here, 404 once the table is gone.
export async function sendHeartbeat(tableId: number): Promise<void> {
  await http.post(`/tables/${tableId}/heartbeat`);
}

// A manager takes another player out of their seat, and at an unattended
// table anyone may take a robot out. 403 when the caller may not, 404 when
// that player no longer sits here (the seat is addressed in the URL, unlike
// leaveSeat's 409). Emptying the table deletes it.
export async function removePlayer(tableId: number, userId: number): Promise<SeatRemovalResult> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.delete<ApiResponse<SeatRemovalResult>>(
    `/tables/${tableId}/seats/${userId}`,
  );
  return data.data;
}

// A manager puts another user into a free seat. It deals nothing: the newcomer
// presses Start like everybody else. 403 when the caller can't manage this table, 409 when the
// seat is taken or that user already sits at a table (this never moves them).
export async function seatUser(tableId: number, userId: number, seat: Seat): Promise<Table> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.post<ApiResponse<Table>>(`/tables/${tableId}/seats/users`, {
    user_id: userId,
    seat,
  });
  return data.data;
}

// A manager puts a robot (the backend picks one from its pool) into a free
// seat. A robot is ready at once, so the fourth seat taken this way deals the
// board if every human has already pressed Start. 403 when the caller
// can't manage this table, 409 when the seat is taken.
export async function seatRobot(tableId: number, seat: Seat): Promise<Table> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.post<ApiResponse<Table>>(`/tables/${tableId}/seats/robots`, { seat });
  return data.data;
}

// The answer to Start: the table, plus the caller's game state when the table
// has a playing after the request (the board this Start dealt, or a finished
// one still on the table), else null.
export interface StartedTable extends Table {
  playing: Playing | null;
}

// "I'm ready to play." The board is dealt once the table is full and every
// human there has pressed it; robots are always ready. Nobody presses it for
// anybody else, a manager included. 409 while a board is in progress (or a
// finished one the same four go on from with playing/next, its set not
// over). After a set's last board it deals the first of the next set.
export async function startTable(tableId: number): Promise<StartedTable> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.post<ApiResponse<StartedTable>>(`/tables/${tableId}/start`);
  return data.data;
}

// Takes our Start back while nothing is dealt; harmless if we hadn't pressed.
export async function cancelStart(tableId: number): Promise<Table> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.delete<ApiResponse<Table>>(`/tables/${tableId}/start`);
  return data.data;
}

// Whether `viewer` may take `user` out of their seat here: a manager may
// take anyone, and while only robots sit here anybody may take a robot. An
// admin's seat is the exception: only another admin may, never the
// moderator (bridge_backend docs/API.md, DELETE /tables/{table}/seats/{user}).
// Never yourself: that is Leave. A hint; the backend's 403 has the final say.
export function canRemove(
  table: Table,
  user: PublicUser,
  viewer: Pick<PublicUser, 'id' | 'is_admin'> | null,
): boolean {
  if (user.id === viewer?.id) {
    return false;
  }
  if (user.is_admin) {
    return !!viewer?.is_admin;
  }
  return table.can_manage || (table.unattended_since !== null && user.is_robot);
}

// The four seats in N, E, S, W order with whoever holds them. The backend only
// sends the occupied ones, so both table views build the full set from here.
export function seatsOf(table: Table): { seat: Seat; user: PublicUser | null }[] {
  return SEATS.map((seat) => ({
    seat,
    user: table.seats.find((s) => s.seat === seat)?.user ?? null,
  }));
}
