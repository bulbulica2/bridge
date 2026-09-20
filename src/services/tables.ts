import http from './http';
import type { User } from './auth';

// Game endpoints answer with an envelope: {status, message, data}.
// See bridge_docs/backend/API.md.
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
  user: User;
}

export interface Table {
  id: number;
  name: string | null;
  created_by: number | null;
  moderated_by: number | null;
  board_id: number | null;
  created_at: string;
  updated_at: string;
  seats: TableSeat[];
  free_seats: Seat[];
}

export interface CreateTablePayload {
  name?: string | null;
  seat?: Seat;
}

// Newest first. Requires a logged-in session (401 otherwise).
export async function listTables(): Promise<Table[]> {
  const { data } = await http.get<ApiResponse<Table[]>>('/tables');
  return data.data;
}

// Creates the table and seats the creator; 409 if they already sit somewhere
// or already have 3 active tables.
export async function createTable(payload: CreateTablePayload): Promise<Table> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.post<ApiResponse<Table>>('/tables', payload);
  return data.data;
}

// Takes a free seat; 409 if the seat is taken or the user already sits somewhere.
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

// Gives up your own seat; 409 if you don't sit here.
export async function leaveSeat(tableId: number): Promise<SeatRemovalResult> {
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.delete<ApiResponse<SeatRemovalResult>>(`/tables/${tableId}/seats`);
  return data.data;
}

// The four seats in N, E, S, W order with whoever holds them. The backend only
// sends the occupied ones, so both table views build the full set from here.
export function seatsOf(table: Table): { seat: Seat; user: User | null }[] {
  return SEATS.map((seat) => ({
    seat,
    user: table.seats.find((s) => s.seat === seat)?.user ?? null,
  }));
}

// TablePolicy::manage as far as the SPA can see it: the moderator, or the
// creator while they still hold a seat here. Admins manage every table too, but
// `is_admin` is hidden from GET /api/user, so they read as non-managers — treat
// the answer as a hint about what to show and let a 403 correct it.
export function canManage(table: Table, userId: number | null | undefined): boolean {
  if (!userId) {
    return false;
  }
  if (table.moderated_by === userId) {
    return true;
  }
  return table.created_by === userId && table.seats.some((s) => s.user_id === userId);
}
