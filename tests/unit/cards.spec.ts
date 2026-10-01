import { describe, expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import DummyColumns from '@/components/DummyColumns.vue'
import HandView from '@/components/HandView.vue'
import type { Card, Suit } from '@/services/game'
import type { Seat } from '@/services/tables'
import {
  groupBySuit,
  isVulnerable,
  longestSuit,
  rankLabel,
  screenSide,
  seatAt,
  sortHand,
  vulnerabilityLabel,
} from '@/utils/cards'

let nextId = 1
function card(suit: Suit, rank: number): Card {
  return { id: nextId++, suit, rank, rank_name: String(rank) }
}

describe('card labels', () => {
  test('maps the backend ranks to labels, skipping 11', () => {
    expect([2, 9, 10, 12, 13, 14, 15].map(rankLabel)).toEqual(['2', '9', '10', 'J', 'Q', 'K', 'A'])
  })
})

describe('sorting a hand', () => {
  test('orders spades, hearts, diamonds, clubs, high to low within a suit', () => {
    const hand = [card('C', 15), card('H', 2), card('S', 10), card('D', 12), card('S', 15), card('H', 14)]

    expect(sortHand(hand).map((c) => `${c.suit}${rankLabel(c.rank)}`)).toEqual([
      'SA', 'S10', 'HK', 'H2', 'DJ', 'CA',
    ])
  })

  test('groups by suit in bridge order and leaves out void suits', () => {
    const groups = groupBySuit([card('C', 3), card('S', 4), card('C', 12), card('S', 13)])

    expect(groups.map((g) => g.suit)).toEqual(['S', 'C'])
    expect(groups[1].cards.map((c) => c.rank)).toEqual([12, 3])
  })

  test('HandView shows the cards grouped and sorted, with labels, not numbers', () => {
    const wrapper = mount(HandView, {
      props: { cards: [card('D', 12), card('S', 2), card('D', 15), card('H', 10)] },
    })

    const groups = wrapper.findAll('.suit-group')
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.findAll('.rank').map((r) => r.text()))).toEqual([['2'], ['10'], ['A', 'J']])
    expect(wrapper.findAll('.playing-card.red')).toHaveLength(3)
  })
})

describe('suit columns', () => {
  const hand = () => [card('S', 15), card('S', 13), card('S', 2), card('H', 10), card('C', 4)]
  // Every line under a column's suit symbol: ranks, a void's dash, blanks.
  const lines = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('.column').map((column) => column.findAll('.rank, .void').length)

  test('longestSuit counts the longest suit', () => {
    expect(longestSuit(hand())).toBe(3)
    expect(longestSuit([])).toBe(0)
  })

  test('without rows each column is as long as its suit', () => {
    const wrapper = mount(DummyColumns, { props: { cards: hand() } })

    expect(lines(wrapper)).toEqual([3, 1, 1, 1])
    expect(wrapper.find('.filler').exists()).toBe(false)
  })

  test('rows pads every column with hidden blanks to the same length', () => {
    const wrapper = mount(DummyColumns, { props: { cards: hand().slice(1), rows: 5 } })

    expect(lines(wrapper)).toEqual([5, 5, 5, 5])
    expect(wrapper.findAll('.column')[0].findAll('.filler')).toHaveLength(3)
    expect(wrapper.findAll('.column')[2].find('.void').exists()).toBe(true)
    expect(wrapper.findAll('.filler').every((f) => f.attributes('aria-hidden') === 'true')).toBe(true)
  })
})

describe('seat rotation', () => {
  test.each<[Seat, Seat, Seat, Seat]>([
    // me, left, partner, right: clockwise play puts the next seat on the left
    ['S', 'W', 'N', 'E'],
    ['N', 'E', 'S', 'W'],
    ['E', 'S', 'W', 'N'],
    ['W', 'N', 'E', 'S'],
  ])('%s sees %s on the left, %s opposite, %s on the right', (me, left, partner, right) => {
    expect(screenSide(me, me)).toBe('bottom')
    expect(seatAt('left', me)).toBe(left)
    expect(seatAt('top', me)).toBe(partner)
    expect(seatAt('right', me)).toBe(right)
  })

  test('without a seat the table is drawn from South', () => {
    expect(seatAt('top', null)).toBe('N')
    expect(seatAt('bottom', null)).toBe('S')
  })
})

describe('vulnerability', () => {
  test('marks the vulnerable sides', () => {
    expect(isVulnerable('N', 'N-S')).toBe(true)
    expect(isVulnerable('E', 'N-S')).toBe(false)
    expect(isVulnerable('W', 'E-W')).toBe(true)
    expect((['N', 'E', 'S', 'W'] as Seat[]).every((s) => isVulnerable(s, 'N-S E-W'))).toBe(true)
    expect((['N', 'E', 'S', 'W'] as Seat[]).some((s) => isVulnerable(s, ''))).toBe(false)
  })

  test('labels it for the board', () => {
    expect(['', 'N-S', 'E-W', 'N-S E-W'].map((v) => vulnerabilityLabel(v as never))).toEqual([
      'None', 'N-S', 'E-W', 'Both',
    ])
  })
})
