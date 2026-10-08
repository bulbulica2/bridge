import type { BoardResult, Card, PlayedCard, Strain } from '@/services/game';
import type { DoubleDummy, DoubleDummyTable, LeadTricks } from '@/services/history';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES, STRAINS, callLabel, strainSymbol } from '@/utils/auction';
import { HAND_SUITS, rankLabel, sortHand, SUIT_NAMES, SUIT_SYMBOLS } from '@/utils/cards';

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

// How declarer did against double dummy, once the table is in: the tricks
// declarer's side took (from the contract and how it went) less the tricks
// double dummy says it makes. 0 means every trick was found; null before
// the analysis is ready, and for a passed-out board.
export function doubleDummyDiff(
  analysis: DoubleDummy | null | undefined,
  result: BoardResult,
): number | null {
  const { contract, declarer, made_by: made } = result;
  if (analysis?.status !== 'ready' || !contract?.level || !contract.strain || !declarer || made === null) {
    return null;
  }
  const tricks = ddTricks(analysis.table, declarer, contract.strain);
  return tricks === null ? null : contract.level + 6 + made - tricks;
}

// The words after the double dummy line: "You found every trick." when
// declarer took what double dummy makes, "Declarer took 1 more." (a gift
// from the defence) or "Declarer took 2 fewer."; "You" when the viewer
// declared. Null with nothing to compare.
export function doubleDummyVerdict(
  analysis: DoubleDummy | null | undefined,
  result: BoardResult,
  mySeat: Seat | null,
): string | null {
  const diff = doubleDummyDiff(analysis, result);
  if (diff === null) {
    return null;
  }
  const who = result.declarer === mySeat ? 'You' : 'Declarer';
  if (diff === 0) {
    return `${who} found every trick.`;
  }
  return `${who} took ${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'}.`;
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

// Whose tricks a lead's figure counts: declarer's (as the backend gives
// them, and as the exports word them) or the defence's (13 less, as the
// review's pills show them, #212).
export type LeadSide = 'declarer' | 'defence';

// The tricks the defence makes double dummy after a lead that leaves
// declarer `declarerTricks`.
export function defenceTricks(declarerTricks: number): number {
  return 13 - declarerTricks;
}

// The opening lead in words: "Your lead ♠K: declarer can make 10. Best was
// ♥2: 9." (another seat's: "West's lead …"), or that it was the best there
// was. With no lead made (a claim before it, an unrecorded play), only the
// best ones. With `side` 'defence' the same counted for the defence: "Your
// lead ♠K: the defence can make 3. Best was ♥2: 4."
export function leadSummary(
  leads: LeadTricks[],
  lead: PlayedCard | null,
  mySeat: Seat | null,
  side: LeadSide = 'declarer',
): string | null {
  const best = bestLeads(leads);
  if (!best) {
    return null;
  }
  const who = side === 'declarer' ? 'declarer' : 'the defence';
  const count = (tricks: number) => (side === 'declarer' ? tricks : defenceTricks(tricks));
  if (leads.every((l) => l.tricks === best.tricks)) {
    return `Every lead lets ${who} make ${count(best.tricks)}.`;
  }
  const bestText = `${orList(best.cards)}: ${count(best.tricks)}`;
  const made = lead ? leads.find((l) => l.card.id === lead.card.id) : undefined;
  if (!lead || !made) {
    return `Best lead ${bestText}.`;
  }
  const whose = lead.seat === mySeat ? 'Your' : `${SEAT_NAMES[lead.seat]}'s`;
  const start = `${whose} lead ${cardName(made.card)}: ${who} can make ${count(made.tricks)}.`;
  return made.tricks === best.tricks
    ? `${start} That was one of the best leads.`
    : `${start} Best was ${bestText}.`;
}

// What one of the opening leader's cards is worth as the lead, for the
// pill on it in the review (#212): the defence's tricks after it, whether
// it is one of the best leads (the most for the defence), and whether it
// is the lead made.
export interface LeadMark {
  tricks: number;
  best: boolean;
  led: boolean;
}

// Every lead's mark, by card id.
export function leadMarks(leads: LeadTricks[], lead: PlayedCard | null): Record<number, LeadMark> {
  const best = bestLeads(leads);
  return Object.fromEntries(
    leads.map((l) => [
      l.card.id,
      { tricks: defenceTricks(l.tricks), best: l.tricks === best?.tricks, led: lead?.card.id === l.card.id },
    ]),
  );
}

// A marked card for a screen reader: "King of spades: the defence makes 4,
// the lead made, a best lead".
export function leadMarkLabel(card: Card, mark: LeadMark): string {
  const parts = [`${card.rank_name} of ${SUIT_NAMES[card.suit]}: the defence makes ${mark.tricks}`];
  if (mark.led) {
    parts.push('the lead made');
  }
  if (mark.best) {
    parts.push('a best lead');
  }
  return parts.join(', ');
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
