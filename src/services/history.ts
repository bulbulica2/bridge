import http from './http';
import type { Bid, Board, PublicPlaying } from './game';
import type { Seat } from './tables';
import type { PublicUser } from './users';

// Finished boards, read from the playings' seat snapshots, so they outlive
// the table they were played at: a player's history and a board's results
// at every table, and one playing call by call and card by card. Same
// envelope as the table endpoints. See
// bridge_backend docs/API.md (Users, GET /users/{user}/playings, Boards, and
// GET /playings/{playing}).
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
  // Null only if the partner's account is gone.
  partner: PublicUser | null;
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

// Anyone's finished boards, the same list. 404 for an unknown user id.
export async function getUserPlayings(
  userId: number,
  page = 1,
): Promise<Page<PlayingHistoryEntry>> {
  const { data } = await http.get<ApiResponse<Page<PlayingHistoryEntry>>>(
    `/users/${userId}/playings`,
    { params: { page } },
  );
  return data.data;
}

// One table's finished playing of a board. `contract`…`made_by` are the game
// state's `result`; `matchpoints` compare it with every other table's.
export interface BoardResultRow {
  playing_id: number;
  // Null once the table has been deleted.
  table_id: number | null;
  players: Record<Seat, PublicUser | null>;
  contract: Bid | null;
  doubled: 0 | 1 | 2 | null;
  declarer: Seat | null;
  tricks_won: number | null;
  score_ns: number;
  made_by: number | null;
  matchpoints: { ns: number; ew: number };
  finished_at: string;
}

export interface BoardResults {
  board: Board;
  // The most matchpoints one result can get: 2 × (results − 1), 0 for one.
  top: number;
  // Best N-S score first.
  results: BoardResultRow[];
}

// Every table's result on a board. 403 (a bare {message}) unless the caller
// has finished that board themselves, 404 for an unknown board.
export async function getBoardResults(boardId: number): Promise<BoardResults> {
  const { data } = await http.get<ApiResponse<BoardResults>>(`/boards/${boardId}/results`);
  return data.data;
}

// One finished playing after the fact: exactly the live game state once
// `finished` (auction, contract, every trick, result and the deal as
// dealt), less `ready` and without anybody's own `hand`. A board that ended
// by a claim has only the tricks up to it (the unfinished one in
// `current_trick`); a passed-out one has its four passes and no play.
// Playings finished before the backend kept them come back with an empty
// `auction` and `tricks`.
export interface PlayingReview extends Omit<PublicPlaying, 'ready' | 'players'> {
  // From the seat snapshot; null only if that player's account is gone.
  players: Record<Seat, PublicUser | null>;
}

// Any finished playing of a board the caller has finished themselves, even
// once its table is gone. 403 (a bare {message}) otherwise, 404 for an
// unknown or unfinished playing.
export async function getPlayingReview(playingId: number): Promise<PlayingReview> {
  const { data } = await http.get<ApiResponse<PlayingReview>>(`/playings/${playingId}`);
  return data.data;
}
