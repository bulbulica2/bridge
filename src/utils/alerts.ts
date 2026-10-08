import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { AuctionCall, CallAlert, CallQuestion, PublicPlaying } from '@/services/game';
import { SEAT_NAMES, callLabel } from '@/utils/auction';

// Alerts (bridge_backend docs/API.md, Alerts; GAME-RULES.md §4): a bidder
// marks their own call for the opponents, never for a human partner while
// the auction lasts (partner sees them once it is over), and the opponents
// may ask about any call of the other side until the board is over. A
// robot's alerts reach its human partner at once (bb#152, #203): playing
// with a robot, one has to learn its system at the table.

// What an alert with nothing written says.
export const NO_EXPLANATION = 'Alerted, no explanation given.';

// What a kibitzer (#182) reads about an alerted call while the board is on:
// the backend keeps the explanation from them until it is over.
export const KIBITZER_ALERT = 'Alerted. What it means shows once the board is over.';

// What the opponents were told about an alerted call.
export function alertText(alert: CallAlert): string {
  return alert.explanation?.trim() || NO_EXPLANATION;
}

// Is `seat` on the other side from `mySeat`? Never for a viewer not seated.
export function isOpponent(seat: Seat, mySeat: Seat | null): boolean {
  return mySeat !== null && SEATS.indexOf(seat) % 2 !== SEATS.indexOf(mySeat) % 2;
}

// Is `seat` the partner of `mySeat`? Never for a viewer not seated.
export function isPartner(seat: Seat, mySeat: Seat | null): boolean {
  return mySeat !== null && seat !== mySeat && !isOpponent(seat, mySeat);
}

// Does the viewer at `mySeat` keep from seeing the alert on `seat`'s call
// while the auction lasts? Only a human partner's: a robot partner's shows
// like an opponent's (`robot`: the caller is one).
export function hidesPartnerAlert(seat: Seat, mySeat: Seat | null, robot: boolean): boolean {
  return isPartner(seat, mySeat) && !robot;
}

// The alert and open question known about one call of the board.
export interface CallNote {
  alert: CallAlert | null;
  question: CallQuestion | null;
}

// Every note known about one board's calls, by the call's index in the
// auction. `PlayingUpdated` carries no alerts, so the game store keeps them
// here and lays them back on each state it shows (`withNotes`).
export interface AlertBook {
  playingId: number | null;
  calls: Record<number, CallNote>;
}

export function emptyBook(): AlertBook {
  return { playingId: null, calls: {} };
}

// The calls of `book` for `playingId`: its own if it is that board's, none
// for a newer board, and null for an older one (whose late news is dropped).
function callsFor(book: AlertBook, playingId: number): Record<number, CallNote> | null {
  if (book.playingId === playingId) {
    return { ...book.calls };
  }
  return book.playingId !== null && playingId < book.playingId ? null : {};
}

// Take the notes a state answered over HTTP carries into the book: it has
// every alert the viewer may see (partner's too once the auction is over,
// a robot partner's all along) and the open questions. An alert never goes
// away, so a known one stays when the state has none on that call; a new
// board starts a new book.
export function takeNotes(book: AlertBook, state: PublicPlaying): AlertBook {
  if (state.playing_id === null) {
    return emptyBook();
  }
  const calls = callsFor(book, state.playing_id);
  if (!calls) {
    return book;
  }
  (state.auction ?? []).forEach((call, index) => {
    if (call.alert === undefined && call.question === undefined) {
      return;
    }
    calls[index] = {
      alert: call.alert ?? calls[index]?.alert ?? null,
      question: call.question ?? null,
    };
  });
  return { playingId: state.playing_id, calls };
}

// `state` with the book's notes laid on its calls, if it is the book's board.
export function withNotes<T extends PublicPlaying>(state: T, book: AlertBook): T {
  if (!state.auction || state.playing_id === null || state.playing_id !== book.playingId) {
    return state;
  }
  return {
    ...state,
    auction: state.auction.map((call, index) => {
      const note = book.calls[index];
      return note ? { ...call, ...note } : call;
    }),
  };
}

// `CallAlerted`: the call is alerted with `explanation`, which also answers
// any question about it.
export function noteAlert(
  book: AlertBook,
  playingId: number,
  index: number,
  explanation: string | null,
): AlertBook {
  const calls = callsFor(book, playingId);
  if (!calls) {
    return book;
  }
  calls[index] = { alert: { explanation }, question: null };
  return { playingId, calls };
}

// `CallQuestioned`: the opponent at `askedBy` waits for the bidder's answer.
export function noteQuestion(
  book: AlertBook,
  playingId: number,
  index: number,
  askedBy: Seat,
): AlertBook {
  const calls = callsFor(book, playingId);
  if (!calls) {
    return book;
  }
  calls[index] = { alert: calls[index]?.alert ?? null, question: { asked_by: askedBy } };
  return { playingId, calls };
}

// The first of the viewer's own calls an opponent asked about and they
// haven't answered yet, with its index in the auction.
export function openQuestion(
  auction: AuctionCall[] | null,
  mySeat: Seat | null,
): { index: number; call: AuctionCall } | null {
  const index = (auction ?? []).findIndex((call) => call.seat === mySeat && !!call.question);
  return index === -1 ? null : { index, call: auction![index] };
}

// "West asks what your 2♣ means."
export function questionText(askedBy: Seat, call: AuctionCall | null | undefined): string {
  return `${SEAT_NAMES[askedBy]} asks what your ${call ? callLabel(call.bid) : 'call'} means.`;
}

// "North explains 2♣: Stayman."
export function answerText(call: AuctionCall, alert: CallAlert): string {
  return `${SEAT_NAMES[call.seat]} explains ${callLabel(call.bid)}: ${alertText(alert)}`;
}

// The auction's alerts as lines for the text export, in auction order:
// "2♣ by North: Stayman, asks for a major."
export function alertLines(auction: AuctionCall[]): string[] {
  return auction
    .filter((call) => !!call.alert)
    .map((call) => `${callLabel(call.bid)} by ${SEAT_NAMES[call.seat]}: ${alertText(call.alert!)}`);
}
