import type { BoardResult, Card, PlayedCard, Strain } from '@/services/game';
import type { DoubleDummy, DoubleDummyTable, LeadTricks } from '@/services/history';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES, STRAINS, callLabel, strainSymbol } from '@/utils/auction';
import { HAND_SUITS, rankLabel, sortHand, SUIT_SYMBOLS } from '@/utils/cards';

// A finished board's double dummy analysis, worked out by the backend's
// solver (bridge_backend docs/GAME-RULES.md §6, Double dummy): this only
// words it. The numbers are tricks (0–13), not levels.

export const DOUBLE_DUMMY_PENDING = 'Double dummy analysis is being worked out…';
// `unavailable` is the server's, not the board's: it has no solver set up
// (bridge_backend docs/GAME-RULES.md §6), for every board alike.
export const DOUBLE_DUMMY_UNAVAILABLE = "Double dummy analysis isn't set up on this server.";

// The table's rows, as it is usually drawn: the declarers down the side…
export const DD_SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
// …and the strains across, lowest first: ♣ ♦ ♥ ♠ NT.
export const DD_STRAINS: readonly Strain[] = STRAINS;

// The tricks `declarer` makes in `strain`, if the table is in.
export function ddTricks(
  table: DoubleDummyTable | null | undefined,
  declarer: Seat,
  strain: Strain,
): number | null {
  return table?.[declarer]?.[strain] ?? null;
}

// The result panel's line: "Double dummy: 4♠ by South makes 10", the note
// while it is being solved or on a server without a solver, or null (a
// passed-out board, not read yet).
export function doubleDummyLine(
  analysis: DoubleDummy | null | undefined,
  result: BoardResult,
): string | null {
  if (!analysis || !result.contract || !result.declarer || result.contract.strain === null) {
    return null;
  }
  if (analysis.status === 'pending') {
    return DOUBLE_DUMMY_PENDING;
  }
  if (analysis.status === 'unavailable') {
    return DOUBLE_DUMMY_UNAVAILABLE;
  }
  const tricks = ddTricks(analysis.table, result.declarer, result.contract.strain);
  if (analysis.status !== 'ready' || tricks === null) {
    return null;
  }
  return `Double dummy: ${callLabel(result.contract)} by ${SEAT_NAMES[result.declarer]} makes ${tricks}`;
}

// "♠K".
function cardName(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${rankLabel(card.rank)}`;
}

// "♥2", "♥2 or ♣7", "♥2, ♦3 or ♣7".
function orList(cards: Card[]): string {
  const names = cards.map(cardName);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];
}

// The leader's cards in the order the hand is held (♥ ♣ ♦ ♠, high to low),
// each with its tricks.
export function leadsInHandOrder(leads: LeadTricks[]): LeadTricks[] {
  const order = sortHand(
    leads.map((l) => l.card),
    HAND_SUITS,
  );
  return order.map((card) => leads.find((l) => l.card.id === card.id)!);
}

// The fewest tricks any lead holds declarer to, and the cards that do it.
export function bestLeads(leads: LeadTricks[]): { tricks: number; cards: Card[] } | null {
  if (leads.length === 0) {
    return null;
  }
  const tricks = Math.min(...leads.map((l) => l.tricks));
  const cards = leadsInHandOrder(leads)
    .filter((l) => l.tricks === tricks)
    .map((l) => l.card);
  return { tricks, cards };
}

// The opening lead in words: "Your lead ♠K: declarer can make 10. Best was
// ♥2: 9." (another seat's: "West's lead …"), or that it was the best there
// was. With no lead made (a claim before it, an unrecorded play), only the
// best ones.
export function leadSummary(
  leads: LeadTricks[],
  lead: PlayedCard | null,
  mySeat: Seat | null,
): string | null {
  const best = bestLeads(leads);
  if (!best) {
    return null;
  }
  if (leads.every((l) => l.tricks === best.tricks)) {
    return `Every lead lets declarer make ${best.tricks}.`;
  }
  const bestText = `${orList(best.cards)}: ${best.tricks}`;
  const made = lead ? leads.find((l) => l.card.id === lead.card.id) : undefined;
  if (!lead || !made) {
    return `Best lead ${bestText}.`;
  }
  const whose = lead.seat === mySeat ? 'Your' : `${SEAT_NAMES[lead.seat]}'s`;
  const start = `${whose} lead ${cardName(made.card)}: declarer can make ${made.tricks}.`;
  return made.tricks === best.tricks
    ? `${start} That was one of the best leads.`
    : `${start} Best was ${bestText}.`;
}

// The table as text columns for the text export: a header, then one row
// per declarer.
export function doubleDummyLines(table: DoubleDummyTable): string[] {
  const cell = (value: string) => value.padStart(4);
  return [
    `${'    '}${DD_STRAINS.map((s) => cell(strainSymbol(s))).join('')}`,
    ...DD_SEATS.map(
      (seat) => `${seat.padEnd(4)}${DD_STRAINS.map((s) => cell(String(table[seat][s]))).join('')}`,
    ),
  ];
}

// PBN's optional OptimumResultTable (PBN 2.1, a supplemental table tag):
// the tag with its column format, then one "N NT  6" row per declarer and
// strain, declarers N S E W and strains NT S H D C, as double dummy
// solvers write it.
export function pbnOptimumResultTable(table: DoubleDummyTable): string[] {
  const seats: Seat[] = ['N', 'S', 'E', 'W'];
  const strains: Strain[] = ['NT', 'S', 'H', 'D', 'C'];
  return [
    '[OptimumResultTable "Declarer;Denomination\\2R;Result\\2R"]',
    ...seats.flatMap((seat) =>
      strains.map((strain) => `${seat} ${strain.padStart(2)} ${String(table[seat][strain]).padStart(2)}`),
    ),
  ];
}
