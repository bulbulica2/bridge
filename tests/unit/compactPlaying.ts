import type { Card, CompactPlaying, PublicPlaying } from '@/services/game'
import type { Seat } from '@/services/tables'

// What the backend's PlayingResource::compact() makes of an HTTP state: the
// `PlayingUpdated` the table channel carries (bridge_backend docs/API.md,
// Event PlayingUpdated). Tests push this and expect the HTTP state back.
export function compactOf(state: PublicPlaying): CompactPlaying {
  const ids = (cards: Card[]) => cards.map((card) => card.id)
  return {
    ...state,
    auction: state.auction && state.auction.map((call) => call.bid.id),
    contract: state.contract && { ...state.contract, bid: state.contract.bid.id },
    tricks:
      state.tricks &&
      state.tricks.map((t) => ({ leader: t.leader, cards: t.cards.map((p) => p.card.id), winner: t.winner })),
    current_trick: state.current_trick && {
      leader: state.current_trick[0]?.seat ?? null,
      cards: state.current_trick.map((p) => p.card.id),
    },
    dummy_hand: state.dummy_hand && ids(state.dummy_hand),
    claim: state.claim && { ...state.claim, hand: ids(state.claim.hand) },
    result: state.result && { ...state.result, contract: state.result.contract?.id ?? null },
    deal:
      state.deal &&
      (Object.fromEntries(Object.entries(state.deal).map(([seat, cards]) => [seat, ids(cards)])) as Record<
        Seat,
        number[]
      >),
  }
}
