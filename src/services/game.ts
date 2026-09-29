import http from './http';
import type { Seat } from './tables';
import type { PublicUser } from './users';

// The game state of a table's current board (a "playing"). Same envelope as
// the table endpoints. See bridge_docs/backend/API.md (Playing, Realtime).
interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

// `waiting` until four players sit down, then the auction, the play, and
// `finished` once the 13th trick is in (or the board was passed out).
export type Phase = 'waiting' | 'auction' | 'play' | 'finished';

export type Suit = 'S' | 'H' | 'D' | 'C';

// `rank` is 2–10, then J=12, Q=13, K=14, A=15: the backend skips 11.
export interface Card {
  id: number;
  suit: Suit;
  rank: number;
  rank_name: string;
}

// '' is nobody vulnerable, 'N-S E-W' is both sides.
export type Vulnerability = '' | 'N-S' | 'E-W' | 'N-S E-W';

export interface Board {
  id: number;
  number: number;
  dealer: Seat;
  vulnerable: Vulnerability;
}

// A contract bid's strain, lowest to highest: clubs, diamonds, hearts,
// spades, no trump.
export type Strain = Suit | 'NT';

// One of the 38 calls. `call` is the only field telling pass (P), double (X)
// and redouble (XX) apart; `level` and `strain` are null for those three.
// Ids aren't pinned to the rank, so never compare or hard-code them: look a
// call up by `call` in the GET /bids list.
export interface Bid {
  id: number;
  call: string;
  level: number | null;
  strain: Strain | null;
  special: boolean;
}

export interface AuctionCall {
  seat: Seat;
  bid: Bid;
}

export interface Contract {
  bid: Bid;
  doubled: 0 | 1 | 2;
  declarer: Seat;
  dummy: Seat;
}

// `seat` is the hand the card came from, so dummy's seat for dummy's cards.
export interface PlayedCard {
  seat: Seat;
  card: Card;
}

export interface Trick {
  round: number;
  leader: Seat;
  cards: PlayedCard[];
  winner: Seat;
}

export interface BoardResult {
  contract: Bid | null;
  doubled: 0 | 1 | 2 | null;
  declarer: Seat | null;
  tricks_won: number | null;
  score_ns: number;
  made_by: number | null;
}

// What every player at the table may see: the `PlayingUpdated` payload.
// While `waiting`, everything but `phase` is null.
export interface PublicPlaying {
  phase: Phase;
  playing_id: number | null;
  board: Board | null;
  players: Record<Seat, PublicUser> | null;
  turn: Seat | null;
  acting_user_id: number | null;
  auction: AuctionCall[] | null;
  contract: Contract | null;
  tricks: Trick[] | null;
  current_trick: PlayedCard[] | null;
  tricks_won: { ns: number; ew: number } | null;
  dummy_hand: Card[] | null;
  result: BoardResult | null;
  deal: Record<Seat, Card[]> | null;
  ready: Seat[] | null;
}

// GET /tables/{id}/playing adds the caller's own seat and remaining cards.
export interface Playing extends PublicPlaying {
  my_seat: Seat | null;
  hand: Card[] | null;
}

// `HandDealt` on the user's own channel, once per board dealt.
export interface HandDealtEvent {
  table_id: number;
  playing_id: number;
  my_seat: Seat;
  hand: Card[];
}

// The table's current board with the caller's own hand: enough to render the
// table from scratch after a reload or a reconnect. 403 unless the caller sits
// at this table, 404 for an unknown table.
export async function getPlaying(tableId: number): Promise<Playing> {
  const { data } = await http.get<ApiResponse<Playing>>(`/tables/${tableId}/playing`);
  return data.data;
}

// All 38 calls with the ids POST /tables/{id}/calls takes: P, X, XX, then
// 1C … 7NT by rank. Public, static reference data.
export async function getBids(): Promise<Bid[]> {
  const { data } = await http.get<ApiResponse<Bid[]>>('/bids');
  return data.data;
}

// The caller's next call in the auction. 201 with the whole new state (hand
// included); 409 with the reason in `message` when the call is illegal or it
// isn't the caller's turn, 403 unless seated here, 422 for an unknown bid id.
export async function makeCall(tableId: number, bidId: number): Promise<Playing> {
  const { data } = await http.post<ApiResponse<Playing>>(`/tables/${tableId}/calls`, {
    bid_id: bidId,
  });
  return data.data;
}

// Play the next card of the current trick: from the caller's own hand, or
// from dummy's when the caller is declarer and it is dummy's turn. 201 with
// the whole new state (hand included); 409 with the reason in `message` (not
// your turn, must follow suit, not in that hand, dummy doesn't play), 403
// unless seated here, 422 for an unknown card id.
export async function playCard(tableId: number, cardId: number): Promise<Playing> {
  const { data } = await http.post<ApiResponse<Playing>>(`/tables/${tableId}/cards`, {
    card_id: cardId,
  });
  return data.data;
}
