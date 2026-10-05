import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import AwayNotice from '@/components/AwayNotice.vue'
import BridgeTable from '@/components/BridgeTable.vue'
import type { PublicPlaying, SetPosition } from '@/services/game'
import type { BroadcastTable, Seat, TableSeat } from '@/services/tables'
import {
  TURN_SECONDS,
  adminAway,
  awaySeats,
  awayText,
  awayTogetherText,
  formatClock,
  heldText,
  myAwaySeat,
  secondsLeft,
  setAtStake,
} from '@/utils/away'

const NOW = Date.parse('2026-10-03T12:00:00.000Z')

// `left` seconds from NOW, as the backend sends its deadlines.
function inSeconds(left: number): string {
  return new Date(NOW + left * 1000).toISOString()
}

type SeatSpec = { user: number; away?: boolean; robot?: boolean; admin?: boolean }

// Seats as seat -> user id (and whether they are away).
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
      away_since: spec.away ? inSeconds(-30) : null,
      user: {
        id: spec.user,
        name: `User ${spec.user}`,
        username: `user${spec.user}`,
        description: null,
        is_robot: !!spec.robot,
        is_admin: !!spec.admin,
      },
    })),
    free_seats: [],
    set:
      set === null
        ? null
        : { id: 5, number: 3, board: 2, of: 4, finished: false, ended: null, replaced: [], ...set },
  }
}

const FOUR = { N: { user: 1 }, E: { user: 2 }, S: { user: 3 }, W: { user: 4 } }
const PLAYER = { is_admin: false }
const ADMIN = { is_admin: true }

describe('the countdown', () => {
  test('formats seconds as m:ss', () => {
    expect(formatClock(161)).toBe('2:41')
    expect(formatClock(60)).toBe('1:00')
    expect(formatClock(9)).toBe('0:09')
    expect(formatClock(-3)).toBe('0:00')
  })

  test("reads the backend's deadline against the time now, never below zero", () => {
    expect(secondsLeft(inSeconds(161), NOW)).toBe(161)
    expect(secondsLeft(inSeconds(160.2), NOW)).toBe(161)
    expect(secondsLeft(inSeconds(-5), NOW)).toBe(0)
    expect(secondsLeft('not a date', NOW)).toBe(0)
  })

  test('a turn lasts a minute', () => {
    expect(TURN_SECONDS).toBe(60)
  })
})

describe('awayText', () => {
  test('names the seat, and what the turn clock will cost once the turn reaches them', () => {
    expect(awayText({ seat: 'E', user: PLAYER })).toBe(
      "East is away. If they don't play within 1:00 of their turn, a robot takes their seat.",
    )
  })

  test('an admin has no turn clock: the table just waits for them', () => {
    expect(awayText({ seat: 'S', user: ADMIN })).toBe('South is away. The table waits for them.')
  })

  test("heldText words the viewer's own held seat, and an admin's", () => {
    expect(heldText({ seat: 'S', user: PLAYER })).toBe(
      "Your seat is held. If you aren't back to play within 1:00 of your turn, a robot takes it for the rest of the set.",
    )
    expect(heldText({ seat: 'S', user: ADMIN })).toBe('Your seat is held while you are away.')
  })

  test('awayTogetherText tells several seats in one line', () => {
    const seats = [{ seat: 'S' as Seat }, { seat: 'W' as Seat }]

    expect(awayTogetherText(seats)).toBe(
      "South and West are away. Whoever doesn't play within 1:00 of their turn is replaced by a robot.",
    )
    expect(awayTogetherText([{ seat: 'N' }, ...seats])).toMatch(/^North, South and West are away\./)
  })
})

describe('away seats', () => {
  test("lists the away seats but the viewer's own", () => {
    const table = makeTable({ ...FOUR, E: { user: 2, away: true }, S: { user: 3, away: true } })

    expect(awaySeats(table).map((s) => s.seat)).toEqual(['E', 'S'])
    expect(awaySeats(table, 3).map((s) => s.seat)).toEqual(['E'])
    expect(myAwaySeat(table, 3)?.seat).toBe('S')
    expect(myAwaySeat(table, 1)).toBeNull()
  })
})

describe('setAtStake', () => {
  test('mid-set, a Leave holds the seat', () => {
    expect(setAtStake(makeTable(FOUR), null, 2)).toEqual({ number: 3, seat: 'E', side: 'ew', held: true })
  })

  test('nothing is at stake outside a set, or for someone not seated', () => {
    expect(setAtStake(makeTable(FOUR, null), null, 2)).toBeNull()
    expect(setAtStake(makeTable(FOUR, { finished: true, ended: 'completed' }), null, 2)).toBeNull()
    expect(setAtStake(makeTable(FOUR), null, 99)).toBeNull()
  })

  test("the board's own set says the last board has finished, which the table doesn't", () => {
    const playing = {
      set: { id: 5, number: 3, board: 4, of: 4, finished: true, ended: 'completed', replaced: [] },
    } as PublicPlaying

    expect(setAtStake(makeTable(FOUR, { board: 4 }), playing, 2)).toBeNull()
  })

  test("an admin's seat is never held, nor anyone's while an admin is away", () => {
    expect(setAtStake(makeTable(FOUR), null, 2, true)?.held).toBe(false)
    const away = makeTable({ ...FOUR, N: { user: 1, away: true, admin: true } })
    expect(adminAway(away)).toBe(true)
    expect(setAtStake(away, null, 2)?.held).toBe(false)
  })

  test('another player away, or an admin seated but here, changes nothing', () => {
    const playerAway = makeTable({ ...FOUR, N: { user: 1, away: true } })
    expect(adminAway(playerAway)).toBe(false)
    expect(setAtStake(playerAway, null, 2)?.held).toBe(true)
    const adminHere = makeTable({ ...FOUR, N: { user: 1, admin: true }, S: { user: 3, away: true } })
    expect(adminAway(adminHere)).toBe(false)
  })
})

describe('AwayNotice', () => {
  test('says who is away, leaving the viewer out, with no countdown', () => {
    const table = makeTable({ ...FOUR, E: { user: 2, away: true }, S: { user: 3, away: true } })
    const wrapper = mount(AwayNotice, { props: { table, me: 3 } })

    expect(wrapper.findAll('.away-line').map((l) => l.text())).toEqual([
      "East is away. If they don't play within 1:00 of their turn, a robot takes their seat.",
    ])
    expect(wrapper.text()).not.toMatch(/\d:\d\d(?! of)/)
  })

  test('clears the moment they are back', async () => {
    const away = makeTable({ ...FOUR, E: { user: 2, away: true } })
    const wrapper = mount(AwayNotice, { props: { table: away, me: 1 } })
    expect(wrapper.find('.away-notice').exists()).toBe(true)

    await wrapper.setProps({ table: makeTable(FOUR) })
    expect(wrapper.find('.away-notice').exists()).toBe(false)
  })

  test('several away seats share one line', () => {
    const table = makeTable({
      ...FOUR,
      W: { user: 4, away: true },
      E: { user: 2, away: true },
      S: { user: 3, away: true },
    })
    const wrapper = mount(AwayNotice, { props: { table, me: 1 } })

    expect(wrapper.findAll('.away-line').map((l) => l.text())).toEqual([
      "East, South and West are away. Whoever doesn't play within 1:00 of their turn is replaced by a robot.",
    ])
  })

  test('an away admin gets a line of their own: the table waits for them', () => {
    const table = makeTable({
      ...FOUR,
      N: { user: 1, away: true, admin: true },
      E: { user: 2, away: true },
    })
    const wrapper = mount(AwayNotice, { props: { table, me: 3 } })

    expect(wrapper.findAll('.away-line').map((l) => l.text())).toEqual([
      'North is away. The table waits for them.',
      "East is away. If they don't play within 1:00 of their turn, a robot takes their seat.",
    ])
  })

  test('nothing for no table', () => {
    const wrapper = mount(AwayNotice, { props: { table: null, me: 1 } })

    expect(wrapper.find('.away-notice').exists()).toBe(false)
  })

  test("with `held`, the viewer's own held seat only", () => {
    const table = makeTable({ ...FOUR, E: { user: 2, away: true }, S: { user: 3, away: true } })
    const wrapper = mount(AwayNotice, { props: { table, me: 3, held: true } })

    expect(wrapper.findAll('.away-line').map((l) => l.text())).toEqual([
      "Your seat is held. If you aren't back to play within 1:00 of your turn, a robot takes it for the rest of the set.",
    ])
  })

  test('with `held` and our seat not away, nothing', () => {
    const wrapper = mount(AwayNotice, { props: { table: makeTable(FOUR), me: 3, held: true } })

    expect(wrapper.find('.away-notice').exists()).toBe(false)
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
