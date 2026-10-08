import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { describe, expect, test } from 'vitest'
import AdminBadge from '@/components/AdminBadge.vue'
import BridgeTable from '@/components/BridgeTable.vue'
import CallLabel from '@/components/CallLabel.vue'
import TrickArea from '@/components/TrickArea.vue'
import type { AuctionCall, Bid, Card, PlayedCard, Strain, Suit } from '@/services/game'
import type { Seat } from '@/services/tables'
import { winningSoFar } from '@/utils/play'

// Daylight (#160): the table's plates and last calls, its corners (#171), the
// trick's ring and the call chips.

const RANKS: Record<string, number> = { J: 12, Q: 13, K: 14, A: 15 }
function c(name: string): Card {
  const suit = name[0] as Suit
  const rank = RANKS[name.slice(1)] ?? Number(name.slice(1))
  return { id: 'SHDC'.indexOf(suit) * 20 + rank, suit, rank, rank_name: name.slice(1) }
}

function played(written: string): PlayedCard[] {
  return written.split(', ').map((made) => {
    const [seat, card] = made.split(' ')
    return { seat: seat as Seat, card: c(card) }
  })
}

function bid(call: string, id = 1): Bid {
  const match = /^(\d)(C|D|H|S|NT)$/.exec(call)
  return match
    ? { id, call, level: Number(match[1]), strain: match[2] as Strain, special: false }
    : { id, call, level: null, strain: null, special: true }
}

const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null, is_robot: false },
  E: { id: 2, name: 'R', username: 'robot-2', description: null, is_robot: true },
  S: { id: 3, name: 'Cy', username: 'bulbulica', description: null, is_robot: false },
  W: { id: 4, name: 'Di', username: 'di', description: null, is_robot: false, is_admin: true },
}

describe('winningSoFar', () => {
  test('the highest card of the suit led, or the highest trump', () => {
    expect(winningSoFar([], 'S')).toBeNull()
    expect(winningSoFar(played('W D5'), null)).toBe('W')
    expect(winningSoFar(played('W D5, N DQ, E D3'), 'NT')).toBe('N')
    // Off-suit cards never win without trumps.
    expect(winningSoFar(played('W D5, N SA'), 'NT')).toBe('W')
    expect(winningSoFar(played('W D5, N SA'), null)).toBe('W')
    // A ruff wins; a higher ruff over it too; an off-suit card after it not.
    expect(winningSoFar(played('W D5, N S2'), 'S')).toBe('N')
    expect(winningSoFar(played('W D5, N S2, E S9, S DA'), 'S')).toBe('E')
    expect(winningSoFar(played('W D5, N S2, E H9'), 'S')).toBe('N')
  })
})

describe('TrickArea', () => {
  test("rings the card winning so far, given the contract's strain", () => {
    const wrapper = mount(TrickArea, { props: { cards: played('W DQ, N DA, E D3'), mySeat: 'S', trump: 'H' } })

    expect(wrapper.get('.slot.won').attributes('data-seat')).toBe('N')
    expect(wrapper.findAll('.slot.won')).toHaveLength(1)
  })

  test('without a strain only the finished trick has a winner; with one, the winner given wins', () => {
    const none = mount(TrickArea, { props: { cards: played('W DQ, N DA'), mySeat: 'S' } })
    expect(none.find('.slot.won').exists()).toBe(false)

    const done = mount(TrickArea, {
      props: { cards: played('W DQ, N DA, E D3, S H2'), mySeat: 'S', trump: 'H', winner: 'S' as Seat },
    })
    expect(done.get('.slot.won').attributes('data-seat')).toBe('S')
  })

  test("a dashed place for the viewer's card until it comes", () => {
    const waiting = mount(TrickArea, { props: { cards: played('W DQ'), mySeat: 'S', mySlot: true } })
    expect(waiting.find('.slot-bottom .my-slot').exists()).toBe(true)

    const come = mount(TrickArea, { props: { cards: played('W DQ, N DA, E D3, S D2'), mySeat: 'S', mySlot: true } })
    expect(come.find('.my-slot').exists()).toBe(false)
    expect(mount(TrickArea, { props: { cards: [], mySeat: 'S' } }).find('.my-slot').exists()).toBe(false)
  })
})

describe('BridgeTable plates', () => {
  function mountTable(props: Record<string, unknown> = {}) {
    return mount(BridgeTable, {
      props: { players: PLAYERS, mySeat: 'S', board: null, turn: null, ...props },
    })
  }

  test("the centre's board line: the label given, else none, never the board's number", () => {
    const board = { id: 1, number: 12, dealer: 'W', vulnerable: 'E-W' }

    const left = mountTable({ board })
    expect(left.find('.board-number').exists()).toBe(false)
    expect(left.get('.centre').text()).not.toContain('12')
    expect(mountTable({ board, boardLabel: 'Board 2 of 4' }).get('.board-number').text()).toBe('Board 2 of 4')
    const none = mountTable({ board, boardLabel: null })
    expect(none.find('.board-number').exists()).toBe(false)
    expect(none.get('.board-line').text()).toBe('Dealer W')
  })

  test("each seat is a plate: initials (a robot's icon), name, seat and the badges", () => {
    const wrapper = mountTable({ board: { id: 1, number: 2, dealer: 'W', vulnerable: 'E-W' } })

    const south = wrapper.get('.side-bottom')
    expect(south.get('.avatar').text()).toBe('BU')
    expect(south.get('.seat-name').text()).toBe('South')
    expect(south.get('.seat-you').text()).toBe('you')
    expect(south.classes()).toContain('not-vul')

    const east = wrapper.get('.side-right')
    expect(east.get('.avatar').classes()).toContain('avatar-robot')
    expect(east.find('.robot-icon').exists()).toBe(true)
    expect(east.classes()).toContain('vul')

    const west = wrapper.get('.side-left')
    expect(west.find('.admin-badge').exists()).toBe(true)
    expect(west.get('.dealer').text()).toBe('D')
    expect(west.get('.dealer').attributes('aria-label')).toBe('dealer')
    expect(west.get('.dealer').attributes('role')).toBe('img')
    expect(wrapper.findAll('.dealer')).toHaveLength(1)
  })

  test('the dealer badge follows the board, and there is none without one', () => {
    const wrapper = mountTable({ board: { id: 1, number: 3, dealer: 'S', vulnerable: '' } })

    expect(wrapper.get('[data-seat="S"] .dealer').text()).toBe('D')
    expect(wrapper.findAll('.dealer')).toHaveLength(1)
    expect(mountTable().find('.dealer').exists()).toBe(false)
  })

  test('the four corners hold what the page puts there, and only those it fills', () => {
    const wrapper = mount(BridgeTable, {
      props: { players: PLAYERS, mySeat: 'S', board: null, turn: null },
      slots: {
        'top-left': () => h('span', { class: 'tl' }, 'Vul: E-W'),
        'top-right': () => h('span', { class: 'tr' }, '2♠ by North'),
        'bottom-left': () => h('button', { class: 'bl' }, 'Auction'),
        'bottom-right': () => h('button', { class: 'br' }, 'Claim'),
      },
    })

    expect(wrapper.get('.bridge-table').classes()).toContain('with-corners')
    expect(wrapper.findAll('.corner')).toHaveLength(4)
    expect(wrapper.get('.corner-top-left .tl').text()).toBe('Vul: E-W')
    expect(wrapper.get('.corner-top-right .tr').text()).toBe('2♠ by North')
    expect(wrapper.get('.corner-bottom-left .bl').text()).toBe('Auction')
    expect(wrapper.get('.corner-bottom-right .br').text()).toBe('Claim')
    // The corners lie over the panel, outside every seat and the centre.
    expect(wrapper.find('.seat .corner').exists()).toBe(false)
    expect(wrapper.find('.centre .corner').exists()).toBe(false)

    const one = mount(BridgeTable, {
      props: { players: PLAYERS, mySeat: 'S', board: null, turn: null, wide: true },
      slots: { 'bottom-right': () => h('button', 'Claim') },
    })
    expect(one.findAll('.corner')).toHaveLength(1)
    expect(one.find('.corner-bottom-right').exists()).toBe(true)
    expect(one.get('.bridge-table').classes()).toEqual(expect.arrayContaining(['with-corners', 'table-wide']))
  })

  test("topLeftRoom: the top-left corner lies in partner's seat, the others over the panel", () => {
    const slots = {
      'top-left': () => h('span', { class: 'tl' }, '2♠ by North'),
      'top-right': () => h('button', { class: 'tr' }, 'Last trick'),
    }
    const wrapper = mount(BridgeTable, {
      props: { players: PLAYERS, mySeat: 'S', board: null, turn: 'W', topLeftRoom: true },
      slots,
    })

    expect(wrapper.get('.bridge-table').classes()).toEqual(expect.arrayContaining(['with-corners', 'room-top-left']))
    expect(wrapper.findAll('.corner-top-left')).toHaveLength(1)
    const seat = wrapper.get('.side-top')
    expect(seat.get('.corner-top-left .tl').text()).toBe('2♠ by North')
    // First in the seat (read before partner), then the plate and the turn
    // line, before any hand.
    expect([...seat.element.children].map((el) => el.className)).toEqual([
      'corner corner-top-left',
      'plate-row',
      'turn-slot',
    ])
    // Last trick alone stays over the panel.
    expect(wrapper.find('.bridge-table > .corner-top-right .tr').exists()).toBe(true)
    expect(wrapper.findAll('.seat .corner')).toHaveLength(1)

    // Nothing to make room for: no class, and no corner in the seat.
    const empty = mount(BridgeTable, {
      props: { players: PLAYERS, mySeat: 'S', board: null, turn: null, topLeftRoom: true },
      slots: { 'top-right': slots['top-right'] },
    })
    expect(empty.get('.bridge-table').classes()).not.toContain('room-top-left')
    expect(empty.find('.corner-top-left').exists()).toBe(false)
    expect(empty.find('.bridge-table > .corner-top-right .tr').exists()).toBe(true)
  })

  test('no corners: nothing laid over the table and no room kept for them', () => {
    const wrapper = mountTable()

    expect(wrapper.find('.corner').exists()).toBe(false)
    expect(wrapper.get('.bridge-table').classes()).not.toContain('with-corners')
  })

  test('an empty seat is dashed and named', () => {
    const wrapper = mountTable({ players: { S: PLAYERS.S } })

    expect(wrapper.get('.side-top .seat-empty').text()).toBe('Empty · North')
    expect(wrapper.findAll('.seat-empty')).toHaveLength(3)
  })

  test('the seats that pressed Start get a tick', () => {
    const wrapper = mountTable({ ready: ['N', 'S'] })

    expect(wrapper.get('[data-seat="N"]').classes()).toContain('seat-ready')
    expect(wrapper.findAll('.seat-ready-mark')).toHaveLength(2)
    expect(wrapper.get('[data-seat="N"] .seat-ready-mark').attributes('aria-label')).toBe('ready')
    expect(wrapper.find('[data-seat="E"] .seat-ready-mark').exists()).toBe(false)
  })

  test("the seat on turn and an away seat are marked on the plate's seat", () => {
    const wrapper = mountTable({ turn: 'N', away: { E: { seconds: 12, urgent: true } } })

    expect(wrapper.get('[data-seat="N"]').classes()).toContain('seat-turn')
    expect(wrapper.get('[data-seat="E"]').classes()).toContain('seat-away')
    expect(wrapper.get('[data-seat="E"] .seat-away-tag').text()).toBe('away · 0:12')
  })

  test("during the auction each seat's last call sits by its plate, an opponent's alert marked", () => {
    const calls: AuctionCall[] = [
      { seat: 'W', bid: bid('P', 1) },
      { seat: 'N', bid: bid('1C', 2), alert: { explanation: 'Could be short' } },
      { seat: 'E', bid: bid('2D', 3), alert: { explanation: 'Weak' } },
      { seat: 'S', bid: bid('P', 1) },
      { seat: 'W', bid: bid('X', 4) },
    ]
    const wrapper = mountTable({ calls })

    // Every seat keeps the place, called or not.
    expect(wrapper.findAll('.last-call')).toHaveLength(4)
    expect(wrapper.get('[data-seat="W"] .last-call').text()).toBe('X')
    expect(wrapper.get('[data-seat="E"] .last-call-chip').classes()).toContain('alerted')
    expect(wrapper.get('[data-seat="E"] .alert-mark').text()).toBe('!')
    // Partner's alert stays hidden during the auction.
    expect(wrapper.get('[data-seat="N"] .last-call').text()).toBe('1♣')
    expect(wrapper.find('[data-seat="N"] .alert-mark').exists()).toBe(false)
    expect(wrapper.get('[data-seat="S"] .last-call .call').classes()).toEqual(
      expect.arrayContaining(['chip', 'pass']),
    )

    const empty = mountTable({ calls: [] })
    expect(empty.findAll('.last-call')).toHaveLength(4)
    expect(empty.find('.last-call-chip').exists()).toBe(false)
    expect(mountTable().find('.last-call').exists()).toBe(false)
  })

  test("a robot partner's alerted last call is marked during the auction (#203)", () => {
    const calls: AuctionCall[] = [
      { seat: 'N', bid: bid('1NT', 2) },
      { seat: 'E', bid: bid('P', 1) },
      { seat: 'S', bid: bid('2C', 3) },
      { seat: 'W', bid: bid('P', 1) },
      { seat: 'N', bid: bid('2D', 4), alert: { explanation: 'No four-card major' } },
    ]
    const robot = { ...PLAYERS.N, is_robot: true }
    const wrapper = mountTable({ calls, players: { ...PLAYERS, N: robot } })

    expect(wrapper.get('[data-seat="N"] .last-call-chip').classes()).toContain('alerted')
    expect(wrapper.get('[data-seat="N"] .alert-mark').text()).toBe('!')
  })
})

describe('CallLabel chips', () => {
  test('a chip takes its colour from the call', () => {
    const chip = (call: string) => mount(CallLabel, { props: { bid: bid(call), chip: true } }).get('.call')

    expect(chip('2H').classes()).toEqual(expect.arrayContaining(['chip', 'red']))
    expect(chip('P').classes()).toEqual(expect.arrayContaining(['chip', 'pass']))
    expect(chip('X').classes()).toEqual(expect.arrayContaining(['chip', 'double']))
    expect(chip('XX').classes()).toEqual(expect.arrayContaining(['chip', 'redouble']))
    expect(mount(CallLabel, { props: { bid: bid('3NT') } }).get('.call').classes()).not.toContain('chip')
  })
})

describe('AdminBadge', () => {
  test("Daylight's tag has no icon", () => {
    expect(mount(AdminBadge).find('ion-icon').exists()).toBe(false)
  })
})
