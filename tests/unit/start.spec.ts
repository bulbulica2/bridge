import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import StartBox from '@/components/StartBox.vue'
import * as echo from '@/services/echo'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Playing } from '@/services/game'
import type { BroadcastTable, Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { START_TIMEOUT_NOTICE, startRevokedText, useTablesStore } from '@/stores/tables'
import { showToast } from '@/utils/toast'
import { isReady, startClock, startClockText, startNeeded, startWaiting } from '@/utils/start'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
  listTables: vi.fn(),
  startTable: vi.fn(),
  cancelStart: vi.fn(),
  sendHeartbeat: vi.fn(),
}))
vi.mock('@/services/game', async (importOriginal) => ({
  ...(await importOriginal<typeof gameService>()),
  getPlaying: vi.fn(),
}))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn() }))

// The user is ana (id 1). Seats are seat -> username; `robot-…` usernames
// are robots, eve is an admin, and `ready` lists the humans who have pressed Start.
const IDS: Record<string, number> = { ana: 1, bob: 2, cy: 3, eve: 7, 'robot-1': 101, 'robot-2': 102, 'robot-3': 103 }
const idOf = (username: string) => IDS[username]

function makeTable(
  seats: Partial<Record<Seat, string>>,
  ready: string[] = [],
  extra: Partial<Table> = {},
): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id: 5,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: null,
    unattended_since: null,
    created_at: '',
    updated_at: '',
    seats: taken.map(([seat, username], i) => ({
      id: i + 1,
      table_id: 5,
      user_id: idOf(username),
      seat,
      ready: username.startsWith('robot-') || ready.includes(username),
      away_since: null,
      replace_at: null,
      start_deadline: null,
      user: {
        id: idOf(username),
        name: username,
        username,
        description: null,
        is_robot: username.startsWith('robot-'),
        is_admin: username === 'eve',
      },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: true,
    ...extra,
  }
}

// The table with the Start timer running on `seat` until `deadline`.
function timed(table: Table, seat: Seat, deadline: string): Table {
  return {
    ...table,
    seats: table.seats.map((s) => (s.seat === seat ? { ...s, start_deadline: deadline } : s)),
  }
}

const WITH_ROBOTS = { N: 'robot-1', E: 'robot-2', S: 'ana', W: 'robot-3' }
const TWO_HUMANS = { N: 'robot-1', E: 'bob', S: 'ana', W: 'robot-3' }

// A state of the table's board: only the parts the Start logic reads matter.
function stateOf(table: Table, overrides: Partial<Playing> = {}): Playing {
  const players = Object.fromEntries(table.seats.map((s) => [s.seat, s.user])) as Playing['players']
  return {
    phase: 'auction',
    playing_id: 42,
    board: { id: 8, number: 8, dealer: 'N', vulnerable: '' },
    players,
    turn: 'N',
    acting_user_id: table.seats.find((s) => s.seat === 'N')!.user_id,
    auction: [],
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    claim: null,
    result: null,
    deal: null,
    ready: null,
    my_seat: 'S',
    hand: [],
    ...overrides,
  }
}

function logIn() {
  useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
}

// What Reverb would call when a TableUpdated arrives on the table's channel.
function pushUpdate(table: BroadcastTable) {
  const calls = vi.mocked(echo.listenToTable).mock.calls
  const [, onUpdate] = calls[calls.length - 1]
  onUpdate(table)
}

describe('start helpers', () => {
  beforeEach(() => setActivePinia(createPinia()))

  test('robots are always ready, humans once they press', () => {
    const table = makeTable(TWO_HUMANS, ['bob'])
    expect(table.seats.map((s) => isReady(s))).toEqual([true, true, false, true])
    expect(isReady({ ...table.seats[0], ready: false })).toBe(true)
  })

  test('a table without a board waits for Start', () => {
    expect(startNeeded(makeTable({ S: 'ana' }), null)).toBe(true)
  })

  test('never during a board, nor while its phase is unknown', () => {
    const table = makeTable(WITH_ROBOTS, [], { board_id: 8 })
    expect(startNeeded(table, stateOf(table))).toBe(false)
    expect(startNeeded(table, stateOf(table, { phase: 'play' }))).toBe(false)
    expect(startNeeded(table, null)).toBe(false)
  })

  test('a finished board: Next for the same four, Start once one was replaced', () => {
    const table = makeTable(TWO_HUMANS, [], { board_id: 8 })
    const done = stateOf(table, { phase: 'finished' })
    expect(startNeeded(table, done)).toBe(false)

    const refilled = makeTable({ ...TWO_HUMANS, E: 'cy' }, [], { board_id: 8 })
    expect(startNeeded(refilled, done)).toBe(true)
    const short = makeTable({ N: 'robot-1', S: 'ana', W: 'robot-3' }, [], { board_id: 8 })
    expect(startNeeded(short, done)).toBe(true)
    // A board we hold that isn't the table's (an old one) says nothing.
    expect(startNeeded(refilled, { ...done, board: { ...done.board!, id: 3 } })).toBe(false)
  })

  test("the set's last board: Start for the next set, though the same four sit there", () => {
    const set = { id: 5, number: 1, board: 4, of: 4, finished: false, ended: null, replaced: [] }
    const table = makeTable(TWO_HUMANS, [], { board_id: 8, set })
    const over = { ...set, finished: true, ended: 'completed' as const }
    // A board finishing sends no TableUpdated: the board's own set says it.
    expect(startNeeded(table, stateOf(table, { phase: 'finished', set: over }))).toBe(true)
    // A set broken off between boards comes with the table instead.
    expect(startNeeded({ ...table, set: over }, stateOf(table, { phase: 'finished', set }))).toBe(true)
    // Board 3 of 4: Next.
    const third = { ...set, board: 3 }
    expect(startNeeded(table, stateOf(table, { phase: 'finished', set: third }))).toBe(false)
  })

  test('who the board waits for', () => {
    expect(startWaiting(makeTable(WITH_ROBOTS), 1)).toBe('Waiting for you to press Start.')
    expect(startWaiting(makeTable(TWO_HUMANS, ['ana']), 1)).toBe(
      'Waiting for East (bob) to press Start.',
    )
    expect(startWaiting(makeTable({ N: 'cy', E: 'bob', S: 'ana', W: 'robot-3' }), 1)).toBe(
      'Waiting for North (cy), East (bob) and you to press Start.',
    )
    expect(startWaiting(makeTable({ S: 'ana', W: 'robot-3' }, ['ana']), 1)).toBe(
      'Waiting for 2 more players.',
    )
    expect(startWaiting(makeTable({ E: 'bob', S: 'ana', W: 'robot-3' }, ['ana']), 1)).toBe(
      'Waiting for a fourth player, and for East (bob) to press Start.',
    )
    expect(startWaiting(makeTable(TWO_HUMANS, ['ana', 'bob']), 1)).toBeNull()
  })
})

describe('StartBox.vue', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.useRealTimers())

  test('before pressing: Start, and who the board waits for', async () => {
    const wrapper = mount(StartBox, { props: { table: makeTable(TWO_HUMANS, ['bob']), me: 1 } })

    expect(wrapper.text()).toContain('Ready to play?')
    expect(wrapper.text()).toContain('Waiting for you to press Start.')
    expect(wrapper.find('.start-cancel').exists()).toBe(false)
    expect(wrapper.find('.start-clock').exists()).toBe(false)

    await wrapper.get('.start-button').trigger('click')
    expect(wrapper.emitted('start')).toHaveLength(1)
  })

  test('after pressing: waiting for the others, with Cancel', async () => {
    const wrapper = mount(StartBox, { props: { table: makeTable(TWO_HUMANS, ['ana']), me: 1 } })

    expect(wrapper.text()).toContain('Waiting for the others…')
    expect(wrapper.text()).toContain('Waiting for East (bob) to press Start.')
    expect(wrapper.find('.start-button').exists()).toBe(false)

    await wrapper.get('.start-cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  test('busy: both buttons spin and hold', () => {
    const before = mount(StartBox, { props: { table: makeTable(TWO_HUMANS), me: 1, busy: true } })
    const after = mount(StartBox, { props: { table: makeTable(TWO_HUMANS, ['ana']), me: 1, busy: true } })

    for (const [wrapper, button] of [[before, '.start-button'], [after, '.start-cancel']] as const) {
      expect(wrapper.getComponent(button).props('disabled')).toBe(true)
      expect(wrapper.get(button).find('ion-spinner').exists()).toBe(true)
    }
  })

  test('the Start timer on our seat counts down in orange, red under 5 s', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    const table = timed(makeTable(TWO_HUMANS, ['bob']), 'S', '2026-10-08T12:00:12Z')
    const wrapper = mount(StartBox, { props: { table, me: 1 } })

    const clock = wrapper.get('.start-clock')
    expect(clock.text()).toBe('Press Start · 0:12')
    expect(clock.attributes('role')).toBe('timer')
    expect(clock.classes()).toContain('start-clock-mine')
    expect(clock.classes()).not.toContain('start-clock-urgent')

    await vi.advanceTimersByTimeAsync(8000)
    expect(wrapper.get('.start-clock').text()).toBe('Press Start · 0:04')
    expect(wrapper.get('.start-clock').classes()).toContain('start-clock-urgent')
    wrapper.unmount()
  })

  test("another player's Start timer: whom we wait for, never red", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    const table = timed(makeTable(TWO_HUMANS, ['ana']), 'E', '2026-10-08T12:00:03Z')
    const wrapper = mount(StartBox, { props: { table, me: 1 } })

    const clock = wrapper.get('.start-clock')
    expect(clock.text()).toBe('Waiting for East · 0:03')
    expect(clock.classes()).not.toContain('start-clock-mine')
    expect(clock.classes()).not.toContain('start-clock-urgent')

    // The deadline gone (Start pressed, or the condition broken): no clock.
    await wrapper.setProps({ table: makeTable(TWO_HUMANS, ['ana']) })
    expect(wrapper.find('.start-clock').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('the Start timer helpers', () => {
  test('the timed seat, ours or not, counted from its deadline', () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    expect(startClock(makeTable(TWO_HUMANS), 1, now)).toBeNull()

    const mine = timed(makeTable(TWO_HUMANS, ['bob']), 'S', '2026-10-08T12:00:04.200Z')
    expect(startClock(mine, 1, now)).toEqual({ seat: 'S', seconds: 5, mine: true, urgent: false })
    expect(startClock(mine, 1, now + 1000)).toEqual({ seat: 'S', seconds: 4, mine: true, urgent: true })
    // Past it: 0, until the seat is freed.
    expect(startClock(mine, 1, now + 60_000)!.seconds).toBe(0)

    const theirs = timed(makeTable(TWO_HUMANS, ['ana']), 'E', '2026-10-08T12:00:02Z')
    expect(startClock(theirs, 1, now)).toEqual({ seat: 'E', seconds: 2, mine: false, urgent: false })
  })

  test('the words', () => {
    expect(startClockText({ seat: 'S', seconds: 12, mine: true, urgent: false })).toBe('Press Start · 0:12')
    expect(startClockText({ seat: 'W', seconds: 61, mine: false, urgent: false })).toBe('Waiting for West · 1:01')
  })
})

describe('tables store start', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    logIn()
    vi.mocked(tablesService.sendHeartbeat).mockResolvedValue(undefined)
    vi.mocked(tablesService.listTables).mockResolvedValue([])
  })

  afterEach(() => useTablesStore().unwatchTable())

  test('a Start that waits marks our seat', async () => {
    const store = useTablesStore()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(TWO_HUMANS))
    await store.loadTable(5)
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...makeTable(TWO_HUMANS, ['ana']), playing: null })

    await store.start(5)

    expect(tablesService.startTable).toHaveBeenCalledWith(5)
    expect(store.currentTable!.seats.find((s) => s.user_id === 1)!.ready).toBe(true)
    expect(store.currentTable).not.toHaveProperty('playing')
    expect(useGameStore().playing).toBeNull()
  })

  test('the Start that deals hands the new board to the game store', async () => {
    const store = useTablesStore()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(WITH_ROBOTS))
    await store.loadTable(5)
    const dealt = makeTable(WITH_ROBOTS, [], { board_id: 8 })
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...dealt, playing: stateOf(dealt) })

    await store.start(5)

    expect(store.currentTable!.board_id).toBe(8)
    const game = useGameStore()
    expect(game.tableId).toBe(5)
    expect(game.playing).toEqual(stateOf(dealt))
  })

  test('an answer a broadcast overtook is not applied', async () => {
    const store = useTablesStore()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(TWO_HUMANS))
    await store.loadTable(5)
    // Bob's Start lands while ours is on its way and deals the board; our
    // answer, from before his, still says we wait for him.
    const dealt = makeTable(TWO_HUMANS, [], { board_id: 8 })
    let answer!: (value: tablesService.StartedTable) => void
    vi.mocked(tablesService.startTable).mockReturnValue(new Promise((resolve) => (answer = resolve)))

    const request = store.start(5)
    pushUpdate(dealt)
    answer({ ...makeTable(TWO_HUMANS, ['ana']), playing: null })
    await request

    expect(store.currentTable!.board_id).toBe(8)
  })

  test('cancelStart takes our Start back', async () => {
    const store = useTablesStore()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(TWO_HUMANS, ['ana']))
    await store.loadTable(5)
    vi.mocked(tablesService.cancelStart).mockResolvedValue(makeTable(TWO_HUMANS))

    await store.cancelStart(5)

    expect(tablesService.cancelStart).toHaveBeenCalledWith(5)
    expect(store.currentTable!.seats.find((s) => s.user_id === 1)!.ready).toBe(false)
  })
})

describe('tables store: the Start timer and the set time (bb#142)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    logIn()
    vi.mocked(tablesService.sendHeartbeat).mockResolvedValue(undefined)
  })

  afterEach(() => useTablesStore().unwatchTable())

  async function watching(table: Table) {
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    const store = useTablesStore()
    await store.loadTable(5)
    return store
  }

  test('a new set time taking our Start back is told; the same time, or not ready, is not', async () => {
    await watching(makeTable(TWO_HUMANS, ['ana']))

    // Bob takes his own Start back: nothing about the set time.
    pushUpdate(makeTable(TWO_HUMANS, ['ana', 'bob']))
    pushUpdate(makeTable(TWO_HUMANS, ['ana']))
    expect(showToast).not.toHaveBeenCalled()

    pushUpdate(makeTable(TWO_HUMANS, [], { set_minutes: 8 }))
    expect(showToast).toHaveBeenCalledWith(startRevokedText(8), 'warning')
    expect(startRevokedText(8)).toBe('The set time changed to 8 min: press Start again.')

    // Changed again while we hadn't pressed: nothing to take back.
    vi.mocked(showToast).mockClear()
    pushUpdate(makeTable(TWO_HUMANS, [], { set_minutes: 12 }))
    expect(showToast).not.toHaveBeenCalled()
  })

  test('our seat freed while its Start timer ran is told as such', async () => {
    const store = await watching(timed(makeTable(TWO_HUMANS, ['bob']), 'S', '2026-10-08T12:00:15Z'))

    pushUpdate(makeTable({ N: 'robot-1', E: 'bob', W: 'robot-3' }, ['bob']))

    expect(showToast).toHaveBeenCalledWith(START_TIMEOUT_NOTICE, 'warning')
    expect(store.kickedFrom).toBe(5)
    expect(echo.leaveTable).toHaveBeenCalledWith(5)
  })

  test('UnseatedFromTable first: the seat goes from our copies, the channel too, the page leaves', async () => {
    const store = await watching(timed(makeTable(TWO_HUMANS, ['bob']), 'S', '2026-10-08T12:00:15Z'))
    store.tables = [store.currentTable!]

    // A table that doesn't allow kibitzers (#182): back to the lobby.
    store.applyUnseated({ table_id: 5, reason: 'start_timeout', kibitzing: false })

    expect(echo.leaveTable).toHaveBeenCalledWith(5)
    expect(store.watchedTableId).toBeNull()
    expect(store.kickedFrom).toBe(5)
    expect(store.myTable).toBeNull()
    expect(store.currentTable!.free_seats).toEqual(['S'])
    expect(store.tables[0].seats.map((s) => s.seat)).toEqual(['N', 'E', 'W'])
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith(START_TIMEOUT_NOTICE, 'warning')

    // The table's TableUpdated after it changes nothing more.
    pushUpdate(makeTable({ N: 'robot-1', E: 'bob', W: 'robot-3' }, ['bob']))
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  test('UnseatedFromTable after the TableUpdated told it: once only', async () => {
    const store = await watching(timed(makeTable(TWO_HUMANS, ['bob']), 'S', '2026-10-08T12:00:15Z'))
    pushUpdate(makeTable({ N: 'robot-1', E: 'bob', W: 'robot-3' }, ['bob']))

    store.applyUnseated({ table_id: 5, reason: 'start_timeout', kibitzing: false })

    expect(showToast).toHaveBeenCalledTimes(1)
  })

  test('another reason or another table: nothing', async () => {
    const store = await watching(makeTable(TWO_HUMANS))

    store.applyUnseated({ table_id: 5, reason: 'kibitzers_off', kibitzing: false })
    store.applyUnseated({ table_id: 9, reason: 'start_timeout', kibitzing: false })

    expect(store.watchedTableId).toBe(5)
    expect(store.kickedFrom).toBeNull()
    expect(showToast).not.toHaveBeenCalled()
  })

  test('the user channel hands UnseatedFromTable to the tables store', async () => {
    const store = await watching(makeTable(TWO_HUMANS))
    useGameStore().watchUser(1)
    const onUnseated = vi.mocked(echo.listenToUser).mock.calls[0][8]

    onUnseated({ table_id: 5, reason: 'start_timeout', kibitzing: false })
    await flushPromises()

    expect(store.kickedFrom).toBe(5)
  })
})
