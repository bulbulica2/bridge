import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { Bid, Card, CompactPlaying, PlayedCard, PublicPlaying } from '@/services/game';

// `PlayingUpdated` writes cards and calls as ids (bridge_backend docs/API.md,
// Event PlayingUpdated); this turns one back into the shape GET
// /tables/{id}/playing answers with, which the rest of the app reads.

// The seat `steps` places clockwise (N → E → S → W) from `seat`.
export function clockwise(seat: Seat, steps: number): Seat {
  return SEATS[(SEATS.indexOf(seat) + steps) % 4];
}

// An id missing from the list we hold means the list is stale: the event
// can't be read, and the caller reloads the state instead.
function lookUp<T>(list: ReadonlyMap<number, T>, id: number, what: string): T {
  const found = list.get(id);
  if (found === undefined) {
    throw new Error(`Unknown ${what} id ${id}`);
  }
  return found;
}

export function expandPlaying(
  p: CompactPlaying,
  cardsById: ReadonlyMap<number, Card>,
  bidsById: ReadonlyMap<number, Bid>,
): PublicPlaying {
  const card = (id: number) => lookUp(cardsById, id, 'card');
  const bid = (id: number) => lookUp(bidsById, id, 'bid');
  const hand = (ids: number[]) => ids.map(card);
  const plays = (leader: Seat | null, ids: number[]): PlayedCard[] =>
    leader === null ? [] : ids.map((id, i) => ({ seat: clockwise(leader, i), card: card(id) }));
  const dealer = p.board?.dealer ?? 'N';

  return {
    ...p,
    auction: p.auction && p.auction.map((id, i) => ({ seat: clockwise(dealer, i), bid: bid(id) })),
    contract: p.contract && { ...p.contract, bid: bid(p.contract.bid) },
    tricks:
      p.tricks &&
      p.tricks.map((t, i) => ({
        round: i + 1,
        leader: t.leader,
        cards: plays(t.leader, t.cards),
        winner: t.winner,
      })),
    current_trick: p.current_trick && plays(p.current_trick.leader, p.current_trick.cards),
    dummy_hand: p.dummy_hand && hand(p.dummy_hand),
    claim: p.claim && { ...p.claim, hand: hand(p.claim.hand) },
    result: p.result && {
      ...p.result,
      contract: p.result.contract === null ? null : bid(p.result.contract),
    },
    deal:
      p.deal &&
      (Object.fromEntries(
        Object.entries(p.deal).map(([seat, ids]) => [seat, hand(ids)]),
      ) as Record<Seat, Card[]>),
  };
}
