import http from './http';
import type { Bid, Board } from './game';
import type { Seat } from './tables';
import type { PublicUser } from './users';

// Finished boards, read from the playings' seat snapshots, so they outlive
// the table they were played at. Same envelope as the table endpoints.
// See bridge_docs/backend/API.md (Users, GET /users/{user}/playings).
interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

// One finished board the user played (played out or passed out; a board
// they left before the end isn't there). `contract`…`made_by` are the game
// state's `result`; `score` is `score_ns` turned round for the user's side.
export interface PlayingHistoryEntry {
  playing_id: number;
  // Null once the table has been deleted.
  table_id: number | null;
  board: Board;
  seat: Seat;
  partner: PublicUser;
  contract: Bid | null;
  doubled: 0 | 1 | 2 | null;
  declarer: Seat | null;
  tricks_won: number | null;
  score_ns: number;
  made_by: number | null;
  score: number;
  finished_at: string;
}

// Laravel's paginator, trimmed to what the SPA reads.
export interface Page<T> {
  current_page: number;
  data: T[];
  last_page: number;
  next_page_url: string | null;
  per_page: number;
  total: number;
}

// The logged-in user's finished boards, latest first, 20 a page.
export async function getMyPlayings(page = 1): Promise<Page<PlayingHistoryEntry>> {
  const { data } = await http.get<ApiResponse<Page<PlayingHistoryEntry>>>('/api/user/playings', {
    params: { page },
  });
  return data.data;
}
