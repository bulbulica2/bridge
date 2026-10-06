import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import AwayNotice from '@/components/AwayNotice.vue'
import AwaySeatTag from '@/components/AwaySeatTag.vue'
import BridgeTable from '@/components/BridgeTable.vue'
import { useAwayTags } from '@/composables/useAwayTags'
import type { PublicPlaying, SetPosition } from '@/services/game'
import type { BroadcastTable, Seat, TableSeat } from '@/services/tables'
import {
  ADMIN_AWAY_NOTE,
  AWAY_NOTE,
  AWAY_REPLACE_SECONDS,
  TURN_SECONDS,
  adminAway,
  awayClockRuns,
  awayNote,
  awaySeats,
  awayTag,
  awayTagText,
  awayTags,
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

// `away`: the seat's clock (`replace_at`) runs out `clock` seconds from NOW
// (42 by default); an admin away has none.
type SeatSpec = { user: number; away?: boolean; clock?: number; robot?: boolean; admin?: boolean }

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
      replace_at: spec.away && !spec.admin ? inSeconds(spec.clock ?? 42) : null,
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
  } as BroadcastTable
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

  test('a turn lasts a minute, an away seat is kept two', () => {
    expect(TURN_SECONDS).toBe(60)
    expect(AWAY_REPLACE_SECONDS).toBe(120)
  })
})

describe('the away seat tag', () => {
  test('counts down to replace_at, red in the last 15 seconds', () => {
    expect(awayTag({ replace_at: inSeconds(42) }, NOW)).toEqual({ seconds: 42, urgent: false })
    expect(awayTag({ replace_at: inSeconds(16) }, NOW)).toEqual({ seconds: 16, urgent: false })
    expect(awayTag({ replace_at: inSeconds(15) }, NOW)).toEqual({ seconds: 15, urgent: true })
    expect(awayTag({ replace_at: inSeconds(-3) }, NOW)).toEqual({ seconds: 0, urgent: true })
  })

  test('a seat with no clock (an admin) has a plain tag', () => {
    expect(awayTag({ replace_at: null }, NOW)).toEqual({ seconds: null, urgent: false })
  })

  test('reads "away · 0:42", "replacing…" at 0, a plain "away" without a clock', () => {
    expect(awayTagText({ seconds: 42, urgent: false })).toBe('away · 0:42')
    expect(awayTagText({ seconds: 102, urgent: false })).toBe('away · 1:42')
    expect(awayTagText({ seconds: 0, urgent: true })).toBe('replacing…')
    expect(awayTagText({ seconds: null, urgent: false })).toBe('away')
  })

  test("tags every away seat but the viewer's", () => {
    const table = makeTable({
      N: { user: 1, away: true },
      E: { user: 2, away: true },
      S: { user: 3, away: true },
      W: { user: 4, away: true, admin: true },
    })

    expect(awayTags(table, 3, NOW)).toEqual({
      N: { seconds: 42, urgent: false },
      E: { seconds: 42, urgent: false },
      W: { seconds: null, urgent: false },
    })
    expect(awayTags(makeTable(FOUR), 3, NOW)).toEqual({})
  })

  test('a clock runs only while an away seat has one', () => {
    expect(awayClockRuns(null)).toBe(false)
    expect(awayClockRuns(makeTable(FOUR))).toBe(false)
    expect(awayClockRuns(makeTable({ ...FOUR, N: { user: 1, away: true, admin: true } }))).toBe(false)
    expect(awayClockRuns(makeTable({ ...FOUR, E: { user: 2, away: true } }))).toBe(true)
  })
})

describe('awayNote and heldText', () => {
  test('one line however many are away, none when nobody is', () => {
    expect(awayNote(makeTable(FOUR), 3)).toBeNull()
    expect(awayNote(makeTable({ ...FOUR, E: { user: 2, away: true } }), 3)).toBe(AWAY_NOTE)
    expect(
      awayNote(makeTable({ ...FOUR, E: { user: 2, away: true }, W: { user: 4, away: true } }), 3),
    ).toBe(AWAY_NOTE)
    expect(AWAY_NOTE).toBe('Away players are replaced by a robot when their clock runs out.')
  })

  test("only an admin away: the table waits; the viewer's own away seat says nothing", () => {
    expect(awayNote(makeTable({ ...FOUR, N: { user: 1, away: true, admin: true } }), 3)).toBe(
      ADMIN_AWAY_NOTE,
    )
    expect(
      awayNote(
        makeTable({ ...FOUR, N: { user: 1, away: true, admin: true }, E: { user: 2, away: true } }),
        3,
      ),
    ).toBe(AWAY_NOTE)
    expect(awayNote(makeTable({ ...FOUR, S: { user: 3, away: true } }), 3)).toBeNull()
  })

  test("the viewer's own held seat, with its clock", () => {
    const table = { id: 4, name: 'Friday club' }
    const seat = { replace_at: inSeconds(42), user: PLAYER }

    expect(heldText(seat, table, NOW)).toBe(
      "You're away from Friday club: a robot takes your seat in 0:42 unless you come back.",
    )
    expect(heldText({ ...seat, replace_at: inSeconds(-1) }, table, NOW)).toBe(
      "You're away from Friday club: a robot is taking your seat…",
    )
    expect(heldText({ ...seat, replace_at: null }, { id: 4, name: null }, NOW)).toBe(
      "You're away from table #4: come back before a robot takes your seat.",
    )
    expect(heldText({ replace_at: null, user: ADMIN }, table, NOW)).toBe(
      "You're away from Friday club: your seat is held until you come back.",
    )
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
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function lines(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('.away-line').map((l) => l.text())
  }

  test.each([
    ['one', { E: { user: 2, away: true } }],
    ['two', { E: { user: 2, away: true }, W: { user: 4, away: true } }],
    ['three', { N: { user: 1, away: true }, E: { user: 2, away: true }, W: { user: 4, away: true } }],
  ])('%s away: one short line, never a countdown', (_, away) => {
    const wrapper = mount(AwayNotice, { props: { table: makeTable({ ...FOUR, ...away }), me: 3 } })

    expect(lines(wrapper)).toEqual([AWAY_NOTE])
    expect(wrapper.text()).not.toMatch(/\d:\d\d/)
  })

  test('leaves the viewer out, and clears the moment they are back', async () => {
    const mine = mount(AwayNotice, {
      props: { table: makeTable({ ...FOUR, S: { user: 3, away: true } }), me: 3 },
    })
    expect(mine.find('.away-notice').exists()).toBe(false)

    const wrapper = mount(AwayNotice, {
      props: { table: makeTable({ ...FOUR, E: { user: 2, away: true } }), me: 1 },
    })
    expect(wrapper.find('.away-notice').exists()).toBe(true)
    await wrapper.setProps({ table: makeTable(FOUR) })
    expect(wrapper.find('.away-notice').exists()).toBe(false)
  })

  test('only an admin away: the table waits for them', () => {
    const table = makeTable({ ...FOUR, N: { user: 1, away: true, admin: true } })

    expect(lines(mount(AwayNotice, { props: { table, me: 3 } }))).toEqual([ADMIN_AWAY_NOTE])
  })

  test('nothing for no table', () => {
    const wrapper = mount(AwayNotice, { props: { table: null, me: 1 } })

    expect(wrapper.find('.away-notice').exists()).toBe(false)
  })

  test("with `held`, the viewer's own held seat only, counting down", async () => {
    const table = makeTable({ ...FOUR, E: { user: 2, away: true }, S: { user: 3, away: true, clock: 42 } })
    const wrapper = mount(AwayNotice, { props: { table, me: 3, held: true } })

    expect(lines(wrapper)).toEqual([
      "You're away from Friday club: a robot takes your seat in 0:42 unless you come back.",
    ])
    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(lines(wrapper)).toEqual([
      "You're away from Friday club: a robot takes your seat in 0:40 unless you come back.",
    ])
  })

  test('with `held` and our seat not away, nothing', () => {
    const wrapper = mount(AwayNotice, { props: { table: makeTable(FOUR), me: 3, held: true } })

    expect(wrapper.find('.away-notice').exists()).toBe(false)
  })
})

describe('AwaySeatTag', () => {
  test('the countdown, red in its last seconds, "replacing…" at 0, an admin plain', async () => {
    const wrapper = mount(AwaySeatTag, { props: { tag: { seconds: 42, urgent: false } } })
    expect(wrapper.text()).toBe('away · 0:42')
    expect(wrapper.classes()).not.toContain('away-tag-urgent')
    expect(wrapper.attributes('title')).toContain('a robot takes the seat')

    await wrapper.setProps({ tag: { seconds: 9, urgent: true } })
    expect(wrapper.text()).toBe('away · 0:09')
    expect(wrapper.classes()).toContain('away-tag-urgent')

    await wrapper.setProps({ tag: { seconds: 0, urgent: true } })
    expect(wrapper.text()).toBe('replacing…')

    await wrapper.setProps({ tag: { seconds: null, urgent: false } })
    expect(wrapper.text()).toBe('away')
    expect(wrapper.classes()).not.toContain('away-tag-urgent')
    expect(wrapper.attributes('title')).toContain('waits for them')
  })
})

describe('useAwayTags', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('every away seat counts down on one clock; one coming back drops their tag', () => {
    const scope = effectScope()
    const table = ref<BroadcastTable | null>(
      makeTable({
        N: { user: 1, away: true },
        E: { user: 2, away: true },
        S: { user: 3 },
        W: { user: 4, away: true },
      }),
    )
    const tags = scope.run(() => useAwayTags(() => table.value, () => 3))!

    expect(tags.value).toEqual({
      N: { seconds: 42, urgent: false },
      E: { seconds: 42, urgent: false },
      W: { seconds: 42, urgent: false },
    })

    vi.advanceTimersByTime(30_000)
    expect(Object.values(tags.value).map((t) => t?.seconds)).toEqual([12, 12, 12])
    expect(tags.value.N?.urgent).toBe(true)

    // East comes back: the other two keep counting.
    table.value = makeTable({
      N: { user: 1, away: true, clock: 12 },
      E: { user: 2 },
      S: { user: 3 },
      W: { user: 4, away: true, clock: 12 },
    })
    expect(Object.keys(tags.value)).toEqual(['N', 'W'])

    table.value = null
    expect(tags.value).toEqual({})
    scope.stop()
  })
})

describe('BridgeTable away mark', () => {
  test('tags and dashes the away seats only, each with its clock', () => {
    const players = Object.fromEntries(
      makeTable(FOUR).seats.map((s: TableSeat) => [s.seat, s.user]),
    )
    const wrapper = mount(BridgeTable, {
      props: {
        players,
        mySeat: 'S',
        board: null,
        turn: null,
        away: {
          E: { seconds: 42, urgent: false },
          N: { seconds: 7, urgent: true },
          W: { seconds: null, urgent: false },
        },
      },
    })

    const east = wrapper.get('[data-seat="E"]')
    expect(east.classes()).toContain('seat-away')
    expect(east.get('.seat-away-tag').text()).toBe('away · 0:42')
    const north = wrapper.get('[data-seat="N"] .seat-away-tag')
    expect(north.text()).toBe('away · 0:07')
    expect(north.classes()).toContain('away-tag-urgent')
    expect(wrapper.get('[data-seat="W"] .seat-away-tag').text()).toBe('away')
    expect(wrapper.get('[data-seat="S"]').find('.seat-away-tag').exists()).toBe(false)
  })
})
