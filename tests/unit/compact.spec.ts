import { describe, expect, test } from 'vitest'
import { clockwise, expandPlaying } from '@/utils/compact'
import type { Bid, Card, CompactPlaying, PublicPlaying, Suit } from '@/services/game'
import type { Seat } from '@/services/tables'
import { compactOf } from './compactPlaying'

// A deck as GET /cards serves it: ids 1–52, clubs first, 2 up to the ace (15).
const SUITS: Suit[] = ['C', 'D', 'H', 'S']
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15]
const DECK: Card[] = SUITS.flatMap((suit, s) =>
  RANKS.map((rank, r) => ({ id: s * 13 + r + 1, suit, rank, rank_name: String(rank) })),
)
const CARDS = new Map(DECK.map((card) => [card.id, card]))

const PASS: Bid = { id: 1, call: 'P', level: null, strain: null, special: true }
const ONE_SPADE: Bid = { id: 7, call: '1S', level: 1, strain: 'S', special: false }
const FOUR_SPADES: Bid = { id: 22, call: '4S', level: 4, strain: 'S', special: false }
const BIDS = new Map([PASS, ONE_SPADE, FOUR_SPADES].map((bid) => [bid.id, bid]))

const c = (id: number) => DECK[id - 1]
const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', is_robot: false, is_admin: false },
  E: { id: 2, name: 'Bob', username: 'bob', is_robot: false, is_admin: false },
  S: { id: 3, name: 'Cy', username: 'cy', is_robot: false, is_admin: false },
  W: { id: 4, name: 'Di', username: 'di', is_robot: false, is_admin: false },
}

function waiting(): PublicPlaying {
  return {
    phase: 'waiting',
    playing_id: null,
    set: null,
    board: null,
    players: null,
    turn: null,
    acting_user_id: null,
    auction: null,
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    claim: null,
    claim_locked: false,
    result: null,
    deal: null,
    ready: null,
  }
}

// West deals; East declares 4♠ after a 1♠ opening; two tricks are in, the
// second led by North (so its cards go round past West to North again), and
// the third has two cards down. East claims the rest.
function inPlay(): PublicPlaying {
  return {
    ...waiting(),
    phase: 'play',
    playing_id: 42,
    set: { id: 5, number: 1, board: 2, of: 4, finished: false, ended: null, forfeited_by: null },
    board: { id: 7, number: 7, dealer: 'W', vulnerable: 'N-S E-W' },
    players: PLAYERS,
    turn: 'W',
    acting_user_id: 4,
    auction: [
      { seat: 'W', bid: PASS },
      { seat: 'N', bid: PASS },
      { seat: 'E', bid: ONE_SPADE },
      { seat: 'S', bid: PASS },
      { seat: 'W', bid: FOUR_SPADES },
      { seat: 'N', bid: PASS },
      { seat: 'E', bid: PASS },
      { seat: 'S', bid: PASS },
    ],
    contract: { bid: FOUR_SPADES, doubled: 0, declarer: 'E', dummy: 'W' },
    tricks: [
      {
        round: 1,
        leader: 'S',
        cards: [
          { seat: 'S', card: c(13) },
          { seat: 'W', card: c(2) },
          { seat: 'N', card: c(5) },
          { seat: 'E', card: c(1) },
        ],
        winner: 'S',
      },
      {
        round: 2,
        leader: 'N',
        cards: [
          { seat: 'N', card: c(26) },
          { seat: 'E', card: c(14) },
          { seat: 'S', card: c(15) },
          { seat: 'W', card: c(16) },
        ],
        winner: 'N',
      },
    ],
    current_trick: [
      { seat: 'W', card: c(40) },
      { seat: 'N', card: c(41) },
    ],
    tricks_won: { ns: 2, ew: 0 },
    dummy_hand: [c(52), c(51), c(30)],
    claim: { seat: 'E', tricks: 10, hand: [c(50), c(49)], accepted: ['S'] },
  }
}

// East's claim was refused: nobody claims until the next card (bb#115).
function locked(): PublicPlaying {
  return { ...inPlay(), claim: null, claim_locked: true }
}

function finished(): PublicPlaying {
  const deal = {} as Record<Seat, Card[]>
  ;(['N', 'E', 'S', 'W'] as Seat[]).forEach((seat, i) => {
    deal[seat] = DECK.slice(i * 13, i * 13 + 13)
  })
  return {
    ...inPlay(),
    phase: 'finished',
    turn: null,
    acting_user_id: null,
    current_trick: [],
    dummy_hand: null,
    claim: null,
    result: {
      contract: FOUR_SPADES,
      doubled: 0,
      declarer: 'E',
      tricks_won: 10,
      score_ns: -620,
      made_by: 0,
      claimed: true,
    },
    deal,
    ready: ['N'],
  }
}

describe('clockwise', () => {
  test('goes N → E → S → W and round again', () => {
    expect(clockwise('N', 0)).toBe('N')
    expect(clockwise('N', 1)).toBe('E')
    expect(clockwise('S', 2)).toBe('N')
    expect(clockwise('W', 1)).toBe('N')
    expect(clockwise('E', 7)).toBe('N')
  })
})

describe('expandPlaying', () => {
  test.each([
    ['waiting', waiting],
    ['in play, with a claim pending', inPlay],
    ['in play, claims locked after a refused one', locked],
    ['finished by claim', finished],
  ])('gives back the HTTP state exactly: %s', (_, state) => {
    expect(expandPlaying(compactOf(state()), CARDS, BIDS)).toEqual(state())
  })

  test("reads the backend's own example", () => {
    const example: CompactPlaying = {
      ...waiting(),
      phase: 'play',
      playing_id: 42,
      board: { id: 7, number: 7, dealer: 'S', vulnerable: 'N-S E-W' },
      players: PLAYERS,
      turn: 'N',
      acting_user_id: 3,
      auction: [7, 1, 1, 1],
      contract: { bid: 7, doubled: 0, declarer: 'S', dummy: 'N' },
      tricks: [{ leader: 'W', cards: [33, 9, 45, 27], winner: 'E' }],
      current_trick: { leader: 'E', cards: [8, 6, 12] },
      tricks_won: { ns: 0, ew: 1 },
      dummy_hand: [52, 50],
    }

    const state = expandPlaying(example, CARDS, BIDS)

    expect(state.auction?.map((call) => [call.seat, call.bid.call])).toEqual([
      ['S', '1S'],
      ['W', 'P'],
      ['N', 'P'],
      ['E', 'P'],
    ])
    expect(state.contract?.bid).toEqual(ONE_SPADE)
    expect(state.tricks?.[0].round).toBe(1)
    expect(state.tricks?.[0].cards.map((p) => [p.seat, p.card.id])).toEqual([
      ['W', 33],
      ['N', 9],
      ['E', 45],
      ['S', 27],
    ])
    expect(state.current_trick?.map((p) => p.seat)).toEqual(['E', 'S', 'W'])
    expect(state.dummy_hand).toEqual([c(52), c(50)])
  })

  test('carries claim_locked as it came', () => {
    expect(expandPlaying(compactOf(locked()), CARDS, BIDS).claim_locked).toBe(true)
    expect(expandPlaying(compactOf(inPlay()), CARDS, BIDS).claim_locked).toBe(false)
  })

  test('a trick nobody has led to yet is empty', () => {
    const compact = { ...compactOf(inPlay()), current_trick: { leader: null, cards: [] } }

    expect(expandPlaying(compact, CARDS, BIDS).current_trick).toEqual([])
  })

  test('a passed-out board has no contract in its result', () => {
    const passedOut: PublicPlaying = {
      ...finished(),
      auction: [PASS, PASS, PASS, PASS].map((bid, i) => ({ seat: clockwise('W', i), bid })),
      contract: null,
      tricks: [],
      result: {
        contract: null,
        doubled: null,
        declarer: null,
        tricks_won: null,
        score_ns: 0,
        made_by: null,
        claimed: false,
      },
    }

    expect(expandPlaying(compactOf(passedOut), CARDS, BIDS)).toEqual(passedOut)
  })

  test('an id the lists lack is an error, not a hole in the state', () => {
    expect(() => expandPlaying({ ...compactOf(inPlay()), dummy_hand: [99] }, CARDS, BIDS)).toThrow(
      'Unknown card id 99',
    )
    expect(() => expandPlaying({ ...compactOf(inPlay()), auction: [99] }, CARDS, BIDS)).toThrow(
      'Unknown bid id 99',
    )
  })
})
