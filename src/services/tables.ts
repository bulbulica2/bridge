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
