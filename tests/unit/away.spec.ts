import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import AwayNotice from '@/components/AwayNotice.vue'
import BridgeTable from '@/components/BridgeTable.vue'
import type { PublicPlaying, SetPosition } from '@/services/game'
import type { BroadcastTable, Seat, TableSeat } from '@/services/tables'
import {
  awaySeats,
  awayText,
  formatClock,
  heldText,
  lostSetText,
  myAwaySeat,
  secondsLeft,
  setAtStake,
} from '@/utils/away'

const NOW = Date.parse('2026-10-03T12:00:00.000Z')

// `left` seconds from NOW, as the backend sends forfeit_at.
function inSeconds(left: number): string {
  return new Date(NOW + left * 1000).toISOString()
}

type SeatSpec = { user: number; away?: number | 'no-deadline'; robot?: boolean }

// Seats as seat -> user id (and how many seconds are left if away).
function makeTable(
  seats: Partial<Record<Seat, SeatSpec>>,
  set: Partial<SetPosition> | null = {},
): BroadcastTable {
  return {
    id: 4,
    name: 'Friday club',
    created_by: 1,
    moderated_by: 1,
    board_id: 9,
    unattended_since: null,
    created_at: '2026-10-03T11:00:00.000000Z',
    updated_at: '2026-10-03T11:00:00.000000Z',
    seats: (Object.entries(seats) as [Seat, SeatSpec][]).map(([seat, spec], i) => ({
      id: i + 1,
      table_id: 4,
      user_id: spec.user,
      seat,
      ready: false,
      away_since: spec.away !== undefined ? inSeconds(-30) : null,
      forfeit_at: typeof spec.away === 'number' ? inSeconds(spec.away) : null,
      user: {
        id: spec.user,
        name: `User ${spec.user}`,
        username: `user${spec.user}`,
        description: null,
        is_robot: !!spec.robot,
      },
    })),
    free_seats: [],
    set:
      set === null
        ? null
        : { id: 5, number: 3, board: 2, of: 4, finished: false, ended: null, forfeited_by: null, ...set },
  }
}

const FOUR = { N: { user: 1 }, E: { user: 2 }, S: { user: 3 }, W: { user: 4 } }

describe('the countdown', () => {
  test('formats seconds as m:ss', () => {
    expect(formatClock(161)).toBe('2:41')
    expect(formatClock(60)).toBe('1:00')
    expect(formatClock(9)).toBe('0:09')
    expect(formatClock(-3)).toBe('0:00')
  })

  test("reads the backend's forfeit_at against the time now, never below zero", () => {
    expect(secondsLeft(inSeconds(161), NOW)).toBe(161)
    expect(secondsLeft(inSeconds(160.2), NOW)).toBe(161)
    expect(secondsLeft(inSeconds(-5), NOW)).toBe(0)
    expect(secondsLeft('not a date', NOW)).toBe(0)
  })
})

describe('awayText', () => {
  test("names the seat and the side that loses the set, with the time left", () => {
    const seat = { seat: 'E' as Seat, forfeit_at: inSeconds(161) }

    expect(awayText(seat, NOW)).toBe('East is away. E-W lose the set in 2:41 unless they come back.')
    expect(awayText({ ...seat, seat: 'N' }, NOW)).toBe(
      'North is away. N-S lose the set in 2:41 unless they come back.',
    )
  })

  test('says time is up once the deadline has passed, until the backend acts', () => {
    expect(awayText({ seat: 'W', forfeit_at: inSeconds(-2) }, NOW)).toBe(
      'West is away. E-W lose the set any moment now.',
    )
  })

  test('without a deadline (an admin away) the table just waits', () => {
    expect(awayText({ seat: 'S', forfeit_at: null }, NOW)).toBe('South is away. The table waits for them.')
  })

  test('heldText words the viewer\'s own held seat', () => {
    expect(heldText({ seat: 'S', forfeit_at: inSeconds(100) }, NOW)).toBe(
      'Your seat is held. N-S lose the set in 1:40 unless you come back.',
    )
    expect(heldText({ seat: 'S', forfeit_at: null }, NOW)).toBe('Your seat is held while you are away.')
  })

  test('lostSetText names the side and the set', () => {
    expect(lostSetText({ id: 5, number: 3, side: 'ew', tableId: 4 })).toBe(
      'You were away too long: E-W lost set 3 by forfeit.',
    )
  })
})

describe('away seats', () => {
  test('lists the away seats but the viewer\'s own', () => {
    const table = makeTable({ ...FOUR, E: { user: 2, away: 100 }, S: { user: 3, away: 50 } })

    expect(awaySeats(table).map((s) => s.seat)).toEqual(['E', 'S'])
    expect(awaySeats(table, 3).map((s) => s.seat)).toEqual(['E'])
    expect(myAwaySeat(table, 3)?.seat).toBe('S')
    expect(myAwaySeat(table, 1)).toBeNull()
  })
})

describe('setAtStake', () => {
  test('mid-set, walking out costs the user\'s side the set', () => {
    expect(setAtStake(makeTable(FOUR), null, 2)).toEqual({ number: 3, seat: 'E', side: 'ew', forfeits: true })
  })

  test('nothing is at stake outside a set, or for someone not seated', () => {
    expect(setAtStake(makeTable(FOUR, null), null, 2)).toBeNull()
    expect(setAtStake(makeTable(FOUR, { finished: true, ended: 'completed' }), null, 2)).toBeNull()
    expect(setAtStake(makeTable(FOUR), null, 99)).toBeNull()
  })

  test("the board's own set says the last board has finished, which the table doesn't", () => {
    const playing = { set: { id: 5, number: 3, board: 4, of: 4, finished: true, ended: 'completed' } } as PublicPlaying

    expect(setAtStake(makeTable(FOUR, { board: 4 }), playing, 2)).toBeNull()
  })

  test('an admin never forfeits, and nobody does while an admin is away', () => {
    expect(setAtStake(makeTable(FOUR), null, 2, true)?.forfeits).toBe(false)
    const adminAway = makeTable({ ...FOUR, N: { user: 1, away: 'no-deadline' } })
    expect(setAtStake(adminAway, null, 2)?.forfeits).toBe(false)
  })
})

describe('AwayNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('counts down every second from forfeit_at, and leaves the viewer out', async () => {
    const table = makeTable({ ...FOUR, E: { user: 2, away: 161 }, S: { user: 3, away: 90 } })
    const wrapper = mount(AwayNotice, { props: { table, me: 3 } })

    expect(wrapper.findAll('.away-line').map((l) => l.text())).toEqual([
      'East is away. E-W lose the set in 2:41 unless they come back.',
    ])

    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.get('.away-line').text()).toContain('in 2:39')
  })

  test('the last minute is urgent', () => {
    const table = makeTable({ ...FOUR, W: { user: 4, away: 45 } })
    const wrapper = mount(AwayNotice, { props: { table, me: 1 } })

    expect(wrapper.get('.away-line').classes()).toContain('away-urgent')
  })

  test('clears the moment they are back', async () => {
    const away = makeTable({ ...FOUR, E: { user: 2, away: 161 } })
    const wrapper = mount(AwayNotice, { props: { table: away, me: 1 } })
    expect(wrapper.find('.away-notice').exists()).toBe(true)

    await wrapper.setProps({ table: makeTable(FOUR) })
    expect(wrapper.find('.away-notice').exists()).toBe(false)
  })

  test('with `held`, the viewer\'s own held seat', () => {
    const table = makeTable({ ...FOUR, S: { user: 3, away: 100 } })
    const wrapper = mount(AwayNotice, { props: { table, me: 3, held: true } })

    expect(wrapper.get('.away-line').text()).toBe(
      'Your seat is held. N-S lose the set in 1:40 unless you come back.',
    )
  })
})

describe('BridgeTable away mark', () => {
  test('tags and dashes the away seats only', () => {
    const players = Object.fromEntries(
      makeTable(FOUR).seats.map((s: TableSeat) => [s.seat, s.user]),
    )
    const wrapper = mount(BridgeTable, {
      props: { players, mySeat: 'S', board: null, turn: null, away: ['E'] },
    })

    const east = wrapper.get('[data-seat="E"]')
    expect(east.classes()).toContain('seat-away')
    expect(east.get('.seat-away-tag').text()).toBe('away')
    expect(wrapper.get('[data-seat="W"]').find('.seat-away-tag').exists()).toBe(false)
  })
})
