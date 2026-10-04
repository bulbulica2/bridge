import http from './http';
import type { Seat } from './tables';
import type { PublicUser } from './users';

// The game state of a table's current board (a "playing"). Same envelope as
// the table endpoints. See bridge_backend docs/API.md (Playing, Realtime).
interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

// `waiting` until four players sit down and every human presses Start
// (bridge_backend docs/API.md, Dealing), then the auction, the play, and
// `finished` once the 13th trick is in, a claim is accepted, or the board was
// passed out.
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
  // The play ended by an accepted claim rather than at trick 13
  // (`tricks_won` then includes the claimed tricks).
  claimed: boolean;
}

// A pending claim: `seat` claims `tricks` of the tricks still to play for
// their side (0 concedes them all). `hand` is the claimer's remaining cards,
// face up to everyone; `accepted` the seats that have agreed so far.
// `expires_at` (ISO 8601) is when silence rejects it, BRIDGE_CLAIM_SECONDS
// after it was made (bb#96): count down from it, never from when the claim
// arrived (bridge_backend docs/API.md, Claims).
export interface Claim {
  seat: Seat;
  tricks: number;
  hand: Card[];
  accepted: Seat[];
  expires_at: string;
}

// The side that forfeited a set, in the backend's spelling.
export type SideCode = 'NS' | 'EW';

// How a set ended: all its boards played, given up by one side (a player
// away too long, see bridge_backend docs/API.md, Away mid-set), or broken off
// with no winner (one of its four taken out of the table otherwise).
export type SetEnding = 'completed' | 'forfeit' | 'abandoned';

// Where a table is in its set of boards (bridge_backend docs/API.md, Sets):
// the set's `id` (for GET /sets/{id}), its `number` at the table (1, 2, 3…)
// and `board`, this board's place in it out of `of` (4). `finished` turns
// true after the last board, or earlier when the set ends early, while that
// board is still on show.
export interface SetPosition {
  id: number;
  number: number;
  board: number;
  of: number;
  finished: boolean;
  // Null while the set goes on.
  ended: SetEnding | null;
  // Set on a forfeit only.
  forfeited_by: SideCode | null;
}

// What every player at the table may see: the `PlayingUpdated` payload.
// While `waiting`, everything but `phase` is null.
export interface PublicPlaying {
  phase: Phase;
  playing_id: number | null;
  // The set this board was dealt in.
  set: SetPosition | null;
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
  // Non-null only while a claim waits for its answers: no card is played then.
  claim: Claim | null;
  result: BoardResult | null;
  deal: Record<Seat, Card[]> | null;
  ready: Seat[] | null;
}

// `PlayingUpdated` as it comes over the table channel: the same keys as
// `PublicPlaying`, but every card and call written as its id so a whole board
// fits in a broadcast's 10 KB (bridge_backend docs/API.md, Event
// PlayingUpdated). `expandPlaying` (src/utils/compact.ts) turns it back into
// `PublicPlaying` from GET /cards and GET /bids. `auction` runs clockwise
// from `board.dealer`, each trick's `cards` clockwise from its `leader`, and
// a trick's `round` is its place in `tricks`.
export interface CompactPlaying
  extends Omit<
    PublicPlaying,
    'auction' | 'contract' | 'tricks' | 'current_trick' | 'dummy_hand' | 'claim' | 'result' | 'deal'
  > {
  auction: number[] | null;
  contract: (Omit<Contract, 'bid'> & { bid: number }) | null;
  tricks: { leader: Seat; cards: number[]; winner: Seat }[] | null;
  // `leader` is null until the trick's first card.
  current_trick: { leader: Seat | null; cards: number[] } | null;
  dummy_hand: number[] | null;
  claim: (Omit<Claim, 'hand'> & { hand: number[] }) | null;
  result: (Omit<BoardResult, 'contract'> & { contract: number | null }) | null;
  deal: Record<Seat, number[]> | null;
}

// GET /tables/{id}/playing adds the caller's own seat and remaining cards.
export interface Playing extends PublicPlaying {
  my_seat: Seat | null;
  hand: Card[] | null;
  // Declarer's remaining cards, only for a human dummy whose declarer is a
  // robot: that dummy plays both hands (see `acting_user_id`). Set from the
  // end of the auction to the end of the play, null for everyone else.
  declarer_hand: Card[] | null;
}

// `HandDealt` on the user's own channel, once per board dealt.
export interface HandDealtEvent {
  table_id: number;
  playing_id: number;
  my_seat: Seat;
  hand: Card[];
}

// `DeclarerHandShown` on the user's own channel: an auction just ended with a
// robot declarer and the user, dummy, plays its cards (`declarer_hand`).
export interface DeclarerHandShownEvent {
  table_id: number;
  playing_id: number;
  my_seat: Seat;
  declarer: Seat;
  declarer_hand: Card[];
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

// The 52 cards, to read the card ids a `PlayingUpdated` carries. Public,
// static reference data, like the bids.
export async function getCards(): Promise<Card[]> {
  const { data } = await http.get<ApiResponse<Card[]>>('/cards');
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
// from dummy's when the caller is declarer and it is dummy's turn, or from
// declarer's when the caller is a robot declarer's dummy. 201 with
// the whole new state (hand included); 409 with the reason in `message` (not
// your turn, must follow suit, not in that hand, dummy doesn't play), 403
// unless seated here, 422 for an unknown card id.
export async function playCard(tableId: number, cardId: number): Promise<Playing> {
  const { data } = await http.post<ApiResponse<Playing>>(`/tables/${tableId}/cards`, {
    card_id: cardId,
  });
  return data.data;
}

// Once the board is finished, ask for the next one, for the caller only
// (nobody asks for anyone else, bb#74). 200 with the whole new state: still
// the finished board with the caller's seat in `ready` while others have yet
// to ask, or the next board's auction once the last one does. Asking twice
// changes nothing. 409 with the reason (not finished, no board, short of a
// player, and after the set's last board "The set is over: press Start for
// a new one."), 403 unless seated here.
export async function nextBoard(tableId: number): Promise<Playing> {
  const { data } = await http.post<ApiResponse<Playing>>(`/tables/${tableId}/playing/next`);
  return data.data;
}

// Claim `tricks` of the tricks still to play for the caller's side (0
// concedes them). Any player but dummy (unless dummy plays for a robot
// declarer: then the claim is declarer's), during the play. 201 with the whole
// new state; 409 with the reason (a claim already pending, too many tricks,
// dummy, not the play), 403 unless seated here.
export async function makeClaim(tableId: number, tricks: number): Promise<Playing> {
  const { data } = await http.post<ApiResponse<Playing>>(`/tables/${tableId}/claim`, { tricks });
  return data.data;
}

// Accept or reject the pending claim (the other non-dummy players). A reject
// clears it and play goes on; the last accept finishes the board. 200 with
// the whole new state; 409 with the reason (no claim, your own, already
// accepted, dummy).
export async function respondToClaim(tableId: number, accept: boolean): Promise<Playing> {
  const { data } = await http.post<ApiResponse<Playing>>(`/tables/${tableId}/claim/response`, {
    accept,
  });
  return data.data;
}

// The claimer takes their pending claim back and play goes on. 200 with the
// whole new state; 409 with the reason (no claim, somebody else's).
export async function withdrawClaim(tableId: number): Promise<Playing> {
  const { data } = await http.delete<ApiResponse<Playing>>(`/tables/${tableId}/claim`);
  return data.data;
}
