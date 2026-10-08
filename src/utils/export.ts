import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { Bid, Card, PlayedCard, Suit, Vulnerability } from '@/services/game';
import type { BoardResults, PlayingReview, SetResults } from '@/services/history';
import type { PublicUser } from '@/services/users';
import { alertLines, alertText } from '@/utils/alerts';
import { auctionRows, callLabel, contractLabel, SEAT_NAMES } from '@/utils/auction';
import { chatLines } from '@/utils/chat';
import { doubleDummyLines, leadSummary, pbnOptimumResultTable } from '@/utils/doubleDummy';
import { rankLabel, sortHand, SUIT_SYMBOLS, SUITS, vulnerabilityLabel } from '@/utils/cards';
import {
  matchpointPercent,
  resultContract,
  resultSummary,
  SIDE_LABELS,
  sideOf,
} from '@/utils/result';
import type { Side } from '@/utils/result';
import { isRecorded, playedCards } from '@/utils/review';
import { boardInSetText } from '@/utils/sets';

// A finished board taken out of the app (GET /playings/{playing}, the
// review page's payload): as plain text to paste into a chat, as Portable
// Bridge Notation for other bridge software, and the pieces the printout
// (BoardPrintout.vue) lays out. Pure functions of the review alone.

// What the page may know besides the review: this playing's matchpoints,
// from the board's results at every table when they are loaded.
export interface ExportExtras {
  matchpoints?: { ns: number; ew: number } | null;
  top?: number | null;
}

// A playing's matchpoints from what is already read: its board's results at
// every table (GET /boards/{id}/results), else any cached set holding it
// (GET /sets/{id}). Empty when neither has it.
export function playingExtras(
  results: Record<number, BoardResults>,
  sets: Record<number, SetResults>,
  boardId: number | null,
  playingId: number | null,
): ExportExtras {
  if (playingId === null) {
    return {};
  }
  const board = boardId !== null ? results[boardId] : undefined;
  const row = board?.results.find((r) => r.playing_id === playingId);
  if (row) {
    return { matchpoints: row.matchpoints, top: board!.top };
  }
  for (const set of Object.values(sets)) {
    const inSet = set.boards.find((b) => b.playing_id === playingId);
    if (inSet) {
      return { matchpoints: inSet.matchpoints, top: inSet.top };
    }
  }
  return {};
}

// The auction and play are written the way players do, West first.
export const WRITTEN_SEATS: readonly Seat[] = ['W', 'N', 'E', 'S'];

export function nextSeat(seat: Seat): Seat {
  return SEATS[(SEATS.indexOf(seat) + 1) % 4];
}

// The four seats in playing order, starting with `first`.
export function clockwiseFrom(first: Seat): Seat[] {
  return [0, 1, 2, 3].map((i) => SEATS[(SEATS.indexOf(first) + i) % 4]);
}

// "♠A", "♥10".
export function cardText(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${rankLabel(card.rank)}`;
}

// One suit of a hand, high to low: "A K 7 3", or "—" for a void.
export function suitRanks(cards: Card[], suit: Suit): string {
  const ranks = sortHand(cards)
    .filter((c) => c.suit === suit)
    .map((c) => rankLabel(c.rank));
  return ranks.length > 0 ? ranks.join(' ') : '—';
}

// The whole hand on one line: "♠ A K 7 3  ♥ Q J 2  ♦ —  ♣ K 8 2".
export function handText(cards: Card[]): string {
  return SUITS.map((suit) => `${SUIT_SYMBOLS[suit]} ${suitRanks(cards, suit)}`).join('  ');
}

// "Ann @ann", "Robot 1 @robot-1 (robot)", or a placeholder for an account
// that's gone.
export function playerLabel(user: PublicUser | null | undefined): string {
  if (!user) {
    return '(account deleted)';
  }
  return `${user.name} @${user.username}${user.is_robot ? ' (robot)' : ''}`;
}

// The first card of the play, if any was played.
export function openingLead(review: PlayingReview): PlayedCard | null {
  return playedCards(review)[0] ?? null;
}

// How an accepted claim ended the play: where it came and how the tricks
// left went. The review doesn't say who claimed, only what declarer ended
// with, so it is told from declarer's side. Null when the play wasn't
// ended by a claim (or there is nothing recorded to place it after).
export function claimNote(review: PlayingReview): string | null {
  const result = review.result;
  if (!result?.claimed || !result.declarer || result.tricks_won === null) {
    return null;
  }
  const tricks = review.tricks ?? [];
  const left = 13 - tricks.length;
  const side = sideOf(result.declarer);
  const won = tricks.filter((t) => sideOf(t.winner) === side).length;
  const taken = result.tricks_won - won;
  const where =
    (review.current_trick ?? []).length > 0
      ? `during trick ${tricks.length + 1}`
      : tricks.length > 0
        ? `after trick ${tricks.length}`
        : 'before the opening lead';
  return `Ended by an accepted claim ${where}: declarer took ${taken} of the last ${left}.`;
}

export interface TrickRow {
  number: number;
  leader: Seat;
  // In the order played.
  cards: PlayedCard[];
  // Null for the trick a claim stopped.
  winner: Seat | null;
}

// Every trick played, then the one a claim stopped (if it had a card).
export function trickRows(review: PlayingReview): TrickRow[] {
  const rows: TrickRow[] = (review.tricks ?? []).map((t, i) => ({
    number: i + 1,
    leader: t.leader,
    cards: t.cards,
    winner: t.winner,
  }));
  const unfinished = review.current_trick ?? [];
  if (unfinished.length > 0) {
    rows.push({ number: rows.length + 1, leader: unfinished[0].seat, cards: unfinished, winner: null });
  }
  return rows;
}

// "N-S 3 of 4 (75%), E-W 1 of 4 (25%)", or null when the page has none.
export function matchpointsText(extras: ExportExtras): string | null {
  const { matchpoints, top } = extras;
  if (!matchpoints || top == null) {
    return null;
  }
  const side = (s: Side) => {
    const percent = matchpointPercent(matchpoints[s], top);
    return `${SIDE_LABELS[s]} ${matchpoints[s]} of ${top}${percent === null ? '' : ` (${percent}%)`}`;
  };
  return `${side('ns')}, ${side('ew')}`;
}

// Text columns, padded with spaces and without trailing blanks.
function columns(cells: string[], width: number): string {
  return cells
    .map((cell) => cell.padEnd(width))
    .join('')
    .trimEnd();
}

// The board as plain text: everything on the review, in reading order.
export function boardText(review: PlayingReview, extras: ExportExtras = {}): string {
  const lines: string[] = [];
  const board = review.board;
  const dealer = board?.dealer ?? null;

  lines.push(
    `${boardInSetText(review.set)} (playing #${review.playing_id ?? '?'})`,
    `Dealer: ${dealer ? SEAT_NAMES[dealer] : '?'} · Vulnerable: ${board ? vulnerabilityLabel(board.vulnerable) : '?'}`,
    '',
    'Players',
    ...SEATS.map((seat) => columns([SEAT_NAMES[seat], playerLabel(review.players[seat])], 7)),
    '',
    'Hands as dealt',
    ...SEATS.map((seat) => columns([SEAT_NAMES[seat], handText(review.deal?.[seat] ?? [])], 7)),
    '',
  );

  if (!isRecorded(review)) {
    lines.push("The auction and play of this board weren't recorded.", '');
    const contract = review.result ? resultContract(review.result) : null;
    lines.push(`Contract: ${contract ?? 'Passed out'}`, '');
  } else {
    lines.push('Auction', columns(WRITTEN_SEATS.map((s) => SEAT_NAMES[s]), 7));
    for (const row of auctionRows(review.auction ?? [], dealer ?? 'W', [...WRITTEN_SEATS])) {
      lines.push(columns(row.map((cell) => (cell.kind === 'call' ? callLabel(cell.bid) : '')), 7));
    }
    lines.push('');
    const alerts = alertLines(review.auction ?? []);
    if (alerts.length > 0) {
      lines.push('Alerts', ...alerts, '');
    }
    const chat = chatLines(review.messages ?? [], review.players, review.auction);
    if (chat.length > 0) {
      lines.push('Chat', ...chat, '');
    }

    const contract = review.contract;
    if (!contract) {
      lines.push('Contract: Passed out', '');
    } else {
      lines.push(`Contract: ${contractLabel(contract)}, dummy ${SEAT_NAMES[contract.dummy]}`);
      const lead = openingLead(review);
      if (lead) {
        lines.push(`Opening lead: ${cardText(lead.card)} by ${SEAT_NAMES[lead.seat]}`);
      }
      lines.push('', 'Play');
      for (const row of trickRows(review)) {
        const cards = row.cards.map(({ seat, card }) => `${seat} ${cardText(card)}`).join(', ');
        const end = row.winner ? `; won by ${SEAT_NAMES[row.winner]}` : ' (not finished)';
        lines.push(`${String(row.number).padStart(2)}. ${SEAT_NAMES[row.leader]} leads: ${cards}${end}`);
      }
      const claim = claimNote(review);
      if (claim) {
        lines.push(claim);
      }
      lines.push('');
    }
  }

  if (review.result) {
    lines.push(`Result: ${resultSummary(review.result)}`);
    if (review.result.declarer && review.result.tricks_won !== null) {
      lines.push(`Declarer took ${review.result.tricks_won} tricks${review.result.claimed ? ', by claim' : ''}.`);
    }
  }
  const matchpoints = matchpointsText(extras);
  if (matchpoints) {
    lines.push(`Matchpoints: ${matchpoints}`);
  }
  const analysis = review.double_dummy;
  if (analysis?.status === 'ready' && analysis.table) {
    lines.push('', 'Double dummy (tricks declarer makes)', ...doubleDummyLines(analysis.table));
    const leads = analysis.leads ? leadSummary(analysis.leads, openingLead(review), null) : null;
    if (leads) {
      lines.push(leads);
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// --- Portable Bridge Notation (PBN 2.1, export format) ---------------------

// "T" for the ten; otherwise the usual letters and digits.
function pbnRank(rank: number): string {
  return rank === 10 ? 'T' : rankLabel(rank);
}

export function pbnCard(card: Card): string {
  return `${card.suit}${pbnRank(card.rank)}`;
}

// "AK73.QJ2..K82": spades to clubs, high to low, a void left empty.
export function pbnHand(cards: Card[]): string {
  const sorted = sortHand(cards);
  return SUITS.map((suit) =>
    sorted
      .filter((c) => c.suit === suit)
      .map((c) => pbnRank(c.rank))
      .join(''),
  ).join('.');
}

// The four hands clockwise from the dealer: "N:… … … …".
export function pbnDeal(deal: Record<Seat, Card[]>, first: Seat): string {
  return `${first}:${clockwiseFrom(first)
    .map((seat) => pbnHand(deal[seat] ?? []))
    .join(' ')}`;
}

// "Pass", "X", "XX", "1C" … "7NT".
export function pbnCall(bid: Bid): string {
  if (!bid.special && bid.level !== null && bid.strain !== null) {
    return `${bid.level}${bid.strain}`;
  }
  return bid.call === 'P' ? 'Pass' : bid.call;
}

const PBN_VULNERABLE: Record<Vulnerability, string> = {
  '': 'None',
  'N-S': 'NS',
  'E-W': 'EW',
  'N-S E-W': 'All',
};

// Quotes and backslashes escaped; tabs and line breaks aren't allowed in a
// string token.
function pbnString(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function tag(name: string, value: string): string {
  return `[${name} "${pbnString(value)}"]`;
}

// The board as a PBN game in export format: the 15 mandatory tags in their
// order (unknown ones "?", the passed-out ones empty), then the auction and
// play sections, then Score. An alerted call carries a note reference
// ("2C =1="), its explanation a Note tag after the auction ("1:Stayman").
// The double dummy table, once solved, is an OptimumResultTable.
// The play lines keep fixed columns, starting
// with the opening leader's; a claim leaves "-" for the unplayed cards of
// the trick it stopped and ends the section with "*".
export function boardPbn(review: PlayingReview): string {
  const board = review.board;
  const result = review.result;
  const contract = review.contract;
  const dealer = board?.dealer ?? 'N';
  const name = (seat: Seat) => review.players[seat]?.username ?? '?';
  const passedOut = !!result && result.contract === null;

  let contractTag = '';
  if (passedOut) {
    contractTag = 'Pass';
  } else if (result?.contract) {
    contractTag = `${pbnCall(result.contract)}${['', 'X', 'XX'][result.doubled ?? 0]}`;
  }

  const lines = [
    '% PBN 2.1',
    '% EXPORT',
    tag('Event', '?'),
    tag('Site', '?'),
    tag('Date', '????.??.??'),
    tag('Board', board ? String(board.number) : '?'),
    tag('West', name('W')),
    tag('North', name('N')),
    tag('East', name('E')),
    tag('South', name('S')),
    tag('Dealer', board ? board.dealer : '?'),
    tag('Vulnerable', board ? PBN_VULNERABLE[board.vulnerable] : '?'),
    tag('Deal', review.deal ? pbnDeal(review.deal, dealer) : '?'),
    tag('Scoring', 'MP'),
    tag('Declarer', result?.declarer ?? ''),
    tag('Contract', contractTag),
    tag('Result', result?.declarer && result.tricks_won !== null ? String(result.tricks_won) : ''),
  ];

  // Supplemental tags follow in alphabetical order: Auction,
  // OptimumResultTable, Play, Score.
  if (isRecorded(review)) {
    lines.push(tag('Auction', dealer));
    const notes: string[] = [];
    const calls = (review.auction ?? []).map((c) => {
      if (!c.alert) {
        return pbnCall(c.bid);
      }
      notes.push(`${notes.length + 1}:${alertText(c.alert)}`);
      return `${pbnCall(c.bid)} =${notes.length}=`;
    });
    for (let i = 0; i < calls.length; i += 4) {
      lines.push(calls.slice(i, i + 4).join(' '));
    }
    lines.push(...notes.map((note) => tag('Note', note)));
  }

  // What each declarer makes in each strain, double dummy (optional).
  const table = review.double_dummy?.status === 'ready' ? review.double_dummy.table : null;
  if (table) {
    lines.push(...pbnOptimumResultTable(table));
  }

  if (isRecorded(review)) {
    if (contract) {
      const leader = nextSeat(contract.declarer);
      const order = clockwiseFrom(leader);
      lines.push(tag('Play', leader));
      const rows = trickRows(review);
      for (const row of rows) {
        lines.push(
          order
            .map((seat) => {
              const played = row.cards.find((c) => c.seat === seat);
              return played ? pbnCard(played.card) : '-';
            })
            .join(' '),
        );
      }
      if (rows.length < 13 || rows[rows.length - 1]?.winner === null) {
        lines.push('*');
      }
    }
  }

  if (result) {
    lines.push(tag('Score', `NS ${result.score_ns}`));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// The review exactly as the app received it, alerts included.
export function boardJson(review: PlayingReview): string {
  return `${JSON.stringify(review, null, 2)}\n`;
}

// "board-7-playing-42.pbn".
export function exportFileName(review: PlayingReview, extension: string): string {
  return `board-${review.board?.number ?? 'x'}-playing-${review.playing_id ?? 'x'}.${extension}`;
}
