import http from './http';
import type { BoardMessage } from './chat';
import type {
  Bid,
  Board,
  BoardResult,
  Card,
  PublicPlaying,
  SetEnding,
  SideCode,
  Strain,
} from './game';
import type { Seat } from './tables';
import type { PublicUser } from './users';

// Finished boards, read from the playings' seat snapshots, so they outlive
// the table they were played at: a player's history and a board's results
// at every table, and one playing call by call and card by card. Same
// envelope as the table endpoints. See
// bridge_backend docs/API.md (Users, GET /users/{user}/playings, Boards,
// GET /playings/{playing} and Sets).
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
  // The set the board was dealt in and its place in it, to group the
  // history by set. Null only for a playing made outside the game services.
  set: { id: number; number: number; board: number; of: number } | null;
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

// A board's double dummy table: the tricks each declarer makes in each
// strain with all four hands in view and both sides at their best. It
// depends on the deal alone, so it is the same at every table.
export type DoubleDummyTable = Record<Seat, Record<Strain, number>>;

// `ready` with the numbers; `pending` until the backend's queue has solved
// it; `unavailable` when the server has no solver.
export type DoubleDummyStatus = 'ready' | 'pending' | 'unavailable';

export interface DoubleDummy {
  status: DoubleDummyStatus;
  // Null unless `ready`.
  table: DoubleDummyTable | null;
}

// One card the opening leader held, with the tricks declarer makes after
// it is led and both sides play their best from there.
export interface LeadTricks {
  card: Card;
  tricks: number;
}

// A playing's double dummy analysis: the board's table plus, for its
// contract, every possible opening lead (in hand order). `leads` is null
// until solved and always on a passed-out board, which is `ready` with its
// table alone.
export interface PlayingDoubleDummy extends DoubleDummy {
  leads: LeadTricks[] | null;
}

// The board's double dummy table. Like its results, 403 (a bare {message})
// unless the caller has finished the board, 404 for an unknown board. See
// bridge_backend docs/API.md, GET /boards/{board}/double-dummy.
export async function getDoubleDummy(boardId: number): Promise<DoubleDummy> {
  const { data } = await http.get<ApiResponse<DoubleDummy>>(`/boards/${boardId}/double-dummy`);
  return data.data;
}

// One finished playing after the fact: exactly the live game state once
// `finished` (auction, contract, every trick, result and the deal as
// dealt), less `ready` and `next_board_at` and without anybody's own `hand`. A board that ended
// by a claim has only the tricks up to it (the unfinished one in
// `current_trick`); a passed-out one has its four passes and no play.
// Playings finished before the backend kept them come back with an empty
// `auction` and `tricks`.
export interface PlayingReview extends Omit<PublicPlaying, 'ready' | 'next_board_at' | 'players' | 'set'> {
  // From the seat snapshot; null only if that player's account is gone.
  players: Record<Seat, PublicUser | null>;
  // The board's whole chat, oldest first: every message, the opponents-only
  // ones too, since the board is over (bb#101). Empty when nobody wrote.
  messages?: BoardMessage[];
  // The board's double dummy table and this contract's opening leads
  // (bb#114).
  double_dummy?: PlayingDoubleDummy | null;
}

// Any finished playing of a board the caller has finished themselves, even
// once its table is gone. 403 (a bare {message}) otherwise, 404 for an
// unknown or unfinished playing.
export async function getPlayingReview(playingId: number): Promise<PlayingReview> {
  const { data } = await http.get<ApiResponse<PlayingReview>>(`/playings/${playingId}`);
  return data.data;
}

// One finished board of a set: its place in the set, the playing to review,
// the game state's `result` fields, and its matchpoints against every
// finished playing of that board at any table (`top` 0 when only this table
// has played it).
export interface SetBoardRow extends BoardResult {
  position: number;
  playing_id: number;
  board: Board;
  top: number;
  matchpoints: { ns: number; ew: number };
}

// A set's results: its finished boards in order, the totals per side and
// the winner (the higher total score; null while it goes on, on a tie and
// for an abandoned set; a forfeit gives it to the other side).
export interface SetResults {
  id: number;
  number: number;
  // Null once the table has been deleted.
  table_id: number | null;
  of: number;
  // Boards dealt, an abandoned one included (it isn't in `boards`).
  boards_dealt: number;
  started_at: string;
  finished_at: string | null;
  finished: boolean;
  ended: SetEnding | null;
  forfeited_by: SideCode | null;
  // The four who played it; null only if that account is gone.
  players: Record<Seat, PublicUser | null>;
  boards: SetBoardRow[];
  totals: {
    score: { ns: number; ew: number };
    matchpoints: { ns: number; ew: number };
    top: number;
  };
  winner: SideCode | null;
}

// A set's results, while it goes on (the boards finished so far) or after,
// even once its table is gone. 403 (a bare {message}) unless the caller
// played in it or has finished every board it finished, 404 for an unknown
// set.
export async function getSet(setId: number): Promise<SetResults> {
  const { data } = await http.get<ApiResponse<SetResults>>(`/sets/${setId}`);
  return data.data;
}
