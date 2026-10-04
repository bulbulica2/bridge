import http from './http';
import type { Seat } from './tables';

// The chat of a table's current board (bridge_backend docs/API.md, Chat):
// the opponents ask what a call means and the bidder answers in their own
// words, never with partner reading along. Same envelope as the table
// endpoints.
interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

// Who reads a message: the sender and their two opponents (never partner),
// the only kind while the board is bid or played; or all four, once it is
// finished. A finished board's `opponents` messages are public too.
export type ChatTo = 'opponents' | 'table';

// One message, as every payload has it. `seat` is the sender's (named from
// the board's `players`), `call_index` the call of the auction it is about
// (from 0), if any. `body` is plain text: render it as text, never as HTML.
export interface BoardMessage {
  id: number;
  seat: Seat;
  user_id: number;
  to: ChatTo;
  call_index: number | null;
  body: string;
  created_at: string;
}

// GET /tables/{id}/messages: the current board's playing (null before the
// first deal, with no messages) and the messages the caller may read,
// oldest first.
export interface BoardChat {
  playing_id: number | null;
  messages: BoardMessage[];
}

// `BoardMessageSent` on the user's own channel: a message the user may read,
// their own included (so their other tabs see it), for the board `playing_id`.
export interface BoardMessageSentEvent {
  table_id: number;
  playing_id: number;
  message: BoardMessage;
}

export interface NewMessage {
  body: string;
  to: ChatTo;
  // The call of the current auction it is about; about an opponent's call
  // it is a question, which a robot bidder answers at once.
  call_index?: number | null;
}

// The current board's messages the caller may read: all but partner's
// `opponents` ones during the board, all of them once it is finished. 403
// unless seated here (or banned), 404 for an unknown table.
export async function getMessages(tableId: number): Promise<BoardChat> {
  const { data } = await http.get<ApiResponse<BoardChat>>(`/tables/${tableId}/messages`);
  return data.data;
}

// A message on the current board. 201 with the message, which also comes
// back as `BoardMessageSent`; 409 with the reason (`table` mid-board, no
// board yet), 422 for a bad body or call, 429 past 10 messages in 30 s, 403
// unless seated here (or banned).
export async function sendMessage(tableId: number, message: NewMessage): Promise<BoardMessage> {
  const { call_index, ...rest } = message;
  const { data } = await http.post<ApiResponse<BoardMessage>>(`/tables/${tableId}/messages`, {
    ...rest,
    ...(call_index != null ? { call_index } : {}),
  });
  return data.data;
}
