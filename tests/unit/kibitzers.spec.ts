import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import * as echo from '@/services/echo'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Playing } from '@/services/game'
import type { BroadcastTable, Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import {
  HEARTBEAT_MS,
  KIBITZERS_OFF_NOTICE,
  START_TIMEOUT_NOTICE,
  START_WATCHING_NOTICE,
  WATCHED_GONE_NOTICE,
  WATCH_IDLE_NOTICE,
  useTablesStore,
} from '@/stores/tables'
import { showToast } from '@/utils/toast'

// Kibitzers (#182): the tables store's watching (channel, heartbeat, how it
// ends) and the game store's state for someone without a seat.
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
  listTables: vi.fn(),
  joinSeat: vi.fn(),
  createTable: vi.fn(),
  watchTable: vi.fn(),
  unwatchTable: vi.fn(),
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

function axiosError(status: number, message = 'Refused.'): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message }, statusText: '', headers: {}, config }
  return error
}

// The user is ana (id 1); the table's players are bob, cy and robots.
const IDS: Record<string, number> = { ana: 1, bob: 2, cy: 3, 'robot-1': 101, 'robot-2': 102 }

function makeTable(seats: Partial<Record<Seat, string>>, extra: Partial<Table> = {}): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id: 5,
    name: 'Club',
    created_by: 2,
    moderated_by: 2,
    board_id: null,
    unattended_since: null,
    set_minutes: 16,
    allow_kibitzers: true,
    kibitzers: 1,
    created_at: '',
    updated_at: '',
    seats: taken.map(([seat, username], i) => ({
      id: i + 1,
      table_id: 5,
      user_id: IDS[username],
      seat,
      ready: username.startsWith('robot-'),
      away_since: null,
      replace_at: null,
      start_deadline: null,
      user: {
        id: IDS[username],
        name: username,
        username,
        description: null,
        is_robot: username.startsWith('robot-'),
        is_admin: false,
      },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    set: null,
    can_manage: false,
    ...extra,
  }
}

const OTHERS = { N: 'robot-1', E: 'bob', W: 'cy' }
const WITH_ANA = { ...OTHERS, S: 'ana' }

// A kibitzer's state of the board: the public part, no seat, no hand.
function watcherState(overrides: Partial<Playing> = {}): Playing {
  return {
    phase: 'auction',
    playing_id: 42,
    set: null,
    board: { id: 8, number: 8, dealer: 'N', vulnerable: '' },
    players: null,
    turn: 'N',
    acting_user_id: 101,
    turn_started_at: null,
    turn_deadline: null,
    turn_deadline_by: null,
    auction: [],
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
    next_board_at: null,
    my_seat: null,
    hand: null,
    declarer_hand: null,
    ...overrides,
  }
}

// jsdom's page is always visible; let a test send it to the background.
let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

// What Reverb would call when a TableUpdated arrives on the table's channel.
function pushUpdate(table: BroadcastTable) {
  const calls = vi.mocked(echo.listenToTable).mock.calls
  const [, onUpdate] = calls[calls.length - 1]
  onUpdate(table)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  visibility = 'visible'
  useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
  vi.mocked(tablesService.sendHeartbeat).mockResolvedValue(undefined)
})

afterEach(() => {
  useTablesStore().clear()
  vi.useRealTimers()
})

// Watching table 5 from the lobby.
async function watchingTable(table = makeTable(OTHERS)) {
  vi.mocked(tablesService.watchTable).mockResolvedValue(table)
  const store = useTablesStore()
  store.tables = [makeTable(OTHERS, { kibitzers: 0 })]
  await store.watch(5)
  return store
}

describe('tables store: watching a table', () => {
  test('watch follows the table like a seat: its channel, its copy, the heartbeat', async () => {
    vi.useFakeTimers()
    const store = await watchingTable()

    expect(tablesService.watchTable).toHaveBeenCalledWith(5)
    expect(store.kibitzingId).toBe(5)
    expect(store.watchedTableId).toBe(5)
    expect(echo.listenToTable).toHaveBeenCalledWith(5, expect.any(Function), expect.any(Function))
    expect(store.currentTable?.id).toBe(5)
    expect(store.tables[0].kibitzers).toBe(1)
    // Watching is no seat: the header's Your table stays empty.
    expect(store.myTable).toBeNull()

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
    expect(tablesService.sendHeartbeat).toHaveBeenCalledWith(5)
  })

  test('a refusal leaves nothing watched', async () => {
    vi.mocked(tablesService.watchTable).mockRejectedValue(axiosError(403))
    const store = useTablesStore()

    await expect(store.watch(5)).rejects.toThrow()
    expect(store.kibitzingId).toBeNull()
    expect(echo.listenToTable).not.toHaveBeenCalled()
  })

  test('watching another table gives the first one up', async () => {
    const store = await watchingTable()
    vi.mocked(tablesService.watchTable).mockResolvedValue({ ...makeTable(OTHERS), id: 9 })

    await store.watch(9)

    expect(echo.leaveTable).toHaveBeenCalledWith(5)
    expect(store.kibitzingId).toBe(9)
    expect(store.watchedTableId).toBe(9)
  })

  test('stopWatching leaves the channel, then tells the backend', async () => {
    vi.useFakeTimers()
    const store = await watchingTable()
    vi.mocked(tablesService.unwatchTable).mockResolvedValue(makeTable(OTHERS, { kibitzers: 0 }))

    await store.stopWatching()

    expect(tablesService.unwatchTable).toHaveBeenCalledWith(5)
    expect(echo.leaveTable).toHaveBeenCalledWith(5)
    expect(store.kibitzingId).toBeNull()
    expect(store.watchedTableId).toBeNull()
    expect(store.tables[0].kibitzers).toBe(0)
    await vi.advanceTimersByTimeAsync(2 * HEARTBEAT_MS)
    expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()

    // Nothing watched: nothing to stop.
    await store.stopWatching()
    expect(tablesService.unwatchTable).toHaveBeenCalledTimes(1)
  })

  test('stopWatching: a 409 or 404 is the same outcome, anything else is thrown', async () => {
    const store = await watchingTable()
    vi.mocked(tablesService.unwatchTable).mockRejectedValue(axiosError(409))
    await store.stopWatching()
    expect(store.kibitzingId).toBeNull()

    await store.watch(5)
    vi.mocked(tablesService.unwatchTable).mockRejectedValue(axiosError(404))
    await store.stopWatching()

    await store.watch(5)
    vi.mocked(tablesService.unwatchTable).mockRejectedValue(axiosError(500))
    await expect(store.stopWatching()).rejects.toThrow()
    expect(store.kibitzingId).toBeNull()
    expect(store.watchedTableId).toBeNull()
  })

  test('stopWatching while the channel already went only tells the backend', async () => {
    const store = await watchingTable()
    store.watchedTableId = null
    vi.mocked(tablesService.unwatchTable).mockResolvedValue(makeTable(OTHERS))

    await store.stopWatching()

    expect(echo.leaveTable).not.toHaveBeenCalled()
    expect(tablesService.unwatchTable).toHaveBeenCalledWith(5)
    expect(store.kibitzingId).toBeNull()
  })

  test('a TableUpdated of the watched table is applied, and keeps us watching', async () => {
    const store = await watchingTable()

    pushUpdate(makeTable({ ...OTHERS, S: 'robot-2' }, { kibitzers: 2 }))

    expect(store.kibitzingId).toBe(5)
    expect(store.watchedTableId).toBe(5)
    expect(store.kickedFrom).toBeNull()
    expect(store.currentTable?.kibitzers).toBe(2)
    expect(showToast).not.toHaveBeenCalled()
  })

  test('a TableUpdated turning kibitzers off sends us to the lobby', async () => {
    const store = await watchingTable()

    pushUpdate(makeTable(OTHERS, { allow_kibitzers: false, kibitzers: 0 }))

    expect(showToast).toHaveBeenCalledWith(KIBITZERS_OFF_NOTICE, 'warning')
    expect(store.kickedFrom).toBe(5)
    expect(store.kibitzingId).toBeNull()
    expect(echo.leaveTable).toHaveBeenCalledWith(5)

    // Its UnseatedFromTable after it adds nothing.
    store.applyUnseated({ table_id: 5, reason: 'kibitzers_off', kibitzing: false })
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  test('UnseatedFromTable kibitzers_off first: the same, once', async () => {
    const store = await watchingTable()

    store.applyUnseated({ table_id: 5, reason: 'kibitzers_off', kibitzing: false })

    expect(showToast).toHaveBeenCalledWith(KIBITZERS_OFF_NOTICE, 'warning')
    expect(store.kickedFrom).toBe(5)
    expect(store.watchedTableId).toBeNull()
  })

  test('kibitzers_off for a table we do not watch: nothing', async () => {
    const store = await watchingTable()

    store.applyUnseated({ table_id: 9, reason: 'kibitzers_off', kibitzing: false })

    expect(store.kibitzingId).toBe(5)
    expect(showToast).not.toHaveBeenCalled()
  })

  test('sitting down at the watched table ends watching, the channel stays', async () => {
    const store = await watchingTable()
    vi.mocked(tablesService.joinSeat).mockResolvedValue(makeTable(WITH_ANA))

    await store.join(5, 'S')

    expect(store.kibitzingId).toBeNull()
    expect(store.watchedTableId).toBe(5)
    expect(echo.leaveTable).not.toHaveBeenCalled()
    expect(store.myTable?.id).toBe(5)
    // A table only watched is no seat moved off: the list isn't reloaded.
    expect(tablesService.listTables).not.toHaveBeenCalled()
  })

  test('sitting down at another table ends watching this one', async () => {
    const store = await watchingTable()
    vi.mocked(tablesService.joinSeat).mockResolvedValue({ ...makeTable({ S: 'ana' }), id: 9 })

    await store.join(9, 'S')

    expect(store.kibitzingId).toBeNull()
    expect(echo.leaveTable).toHaveBeenCalledWith(5)
    expect(store.watchedTableId).toBe(9)
    expect(tablesService.listTables).not.toHaveBeenCalled()
  })

  test('creating a table ends watching', async () => {
    const store = await watchingTable()
    vi.mocked(tablesService.createTable).mockResolvedValue({ ...makeTable({ S: 'ana' }), id: 9 })

    await store.create({ robots: true, allow_kibitzers: false })

    expect(tablesService.createTable).toHaveBeenCalledWith({ robots: true, allow_kibitzers: false })
    expect(store.kibitzingId).toBeNull()
    expect(store.watchedTableId).toBe(9)
  })

  test('a manager seating us at the watched table: we play there now', async () => {
    const store = await watchingTable()

    pushUpdate(makeTable(WITH_ANA))

    expect(store.kibitzingId).toBeNull()
    expect(store.watchedTableId).toBe(5)
    expect(store.myTable?.id).toBe(5)
    expect(store.kickedFrom).toBeNull()
  })

  test('the list keeps the watched table followed while it allows us', async () => {
    const store = await watchingTable()
    vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(OTHERS)])

    await store.load()

    expect(store.kibitzingId).toBe(5)
    expect(store.watchedTableId).toBe(5)
  })

  test('the list without the watched table, or not allowing it: watched no more', async () => {
    const store = await watchingTable()
    vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(OTHERS, { allow_kibitzers: false })])
    await store.load()
    expect(store.kibitzingId).toBeNull()
    expect(store.watchedTableId).toBeNull()

    await store.watch(5)
    vi.mocked(tablesService.listTables).mockResolvedValue([])
    await store.load()
    expect(store.kibitzingId).toBeNull()
  })

  test('loading the watched table keeps it followed', async () => {
    const store = await watchingTable()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(OTHERS))

    await store.loadTable(5)

    expect(store.kibitzingId).toBe(5)
    expect(store.watchedTableId).toBe(5)
  })

  test('forgetting the watched table ends watching', async () => {
    const store = await watchingTable()
    store.watchedTableId = null

    store.forget(5)

    expect(store.kibitzingId).toBeNull()
  })

  test('resumeWatching (a reload while watching) follows the table again, once', async () => {
    const store = useTablesStore()
    store.currentTable = makeTable(OTHERS)

    store.resumeWatching(5)
    store.resumeWatching(5)

    expect(store.kibitzingId).toBe(5)
    expect(echo.listenToTable).toHaveBeenCalledTimes(1)
  })

  test('resumeWatching at a table that seats us: nothing (it is a seat)', async () => {
    const store = useTablesStore()
    store.currentTable = makeTable(WITH_ANA)

    store.resumeWatching(5)

    expect(store.kibitzingId).toBeNull()
  })

  test('a refused heartbeat: our place went (403) and we are told', async () => {
    vi.useFakeTimers()
    const store = await watchingTable()
    vi.mocked(tablesService.sendHeartbeat).mockRejectedValue(axiosError(403))

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)

    expect(showToast).toHaveBeenCalledWith(WATCH_IDLE_NOTICE, 'warning')
    expect(store.kickedFrom).toBe(5)
    expect(store.kibitzingId).toBeNull()
    expect(tablesService.getTable).not.toHaveBeenCalled()
  })

  test('a heartbeat 404: the table went, and we are told', async () => {
    vi.useFakeTimers()
    const store = await watchingTable()
    vi.mocked(tablesService.sendHeartbeat).mockRejectedValue(axiosError(404))

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)

    expect(showToast).toHaveBeenCalledWith(WATCHED_GONE_NOTICE, 'warning')
    expect(store.kickedFrom).toBe(5)
    expect(store.tables).toEqual([])
  })

  test('another heartbeat failure is just waited out', async () => {
    vi.useFakeTimers()
    const store = await watchingTable()
    vi.mocked(tablesService.sendHeartbeat).mockRejectedValue(axiosError(500))

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)

    expect(store.kibitzingId).toBe(5)
    expect(showToast).not.toHaveBeenCalled()
  })

  test('hidden, a kibitzer stops beating even mid-set; back, a refused beat ends it', async () => {
    vi.useFakeTimers()
    const running = { id: 3, number: 1, board: 2, of: 4, finished: false, ended: null, replaced: [], minutes: 16, time_left: { N: null, E: 100, S: 100, W: 100 } }
    const store = await watchingTable(makeTable(OTHERS, { set: running, board_id: 8 }))

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(2 * HEARTBEAT_MS)
    expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()

    vi.mocked(tablesService.sendHeartbeat).mockRejectedValue(axiosError(403))
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)

    expect(store.kibitzingId).toBeNull()
    expect(store.kickedFrom).toBe(5)
    expect(tablesService.getTable).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(WATCH_IDLE_NOTICE, 'warning')
  })

  test('back from the background still watching: the table and the board are read again', async () => {
    vi.useFakeTimers()
    const store = await watchingTable()
    const game = useGameStore()
    vi.mocked(gameService.getPlaying).mockResolvedValue(watcherState())
    await game.load(5)
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(OTHERS))

    setVisibility('hidden')
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)

    expect(tablesService.getTable).toHaveBeenCalledWith(5)
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    expect(store.kibitzingId).toBe(5)
  })

  test('the table gone while we watched (a refetch 404s): told as such', async () => {
    const store = await watchingTable()
    const reconnect = vi.mocked(echo.onReconnect).mock.calls[0][0]
    vi.mocked(tablesService.getTable).mockRejectedValue(axiosError(404))

    await reconnect()

    expect(showToast).toHaveBeenCalledWith(WATCHED_GONE_NOTICE, 'warning')
    expect(store.kickedFrom).toBe(5)
    expect(store.kibitzingId).toBeNull()
  })
})

describe('tables store: the Start timer at a table that allows kibitzers', () => {
  // Seated South with the Start timer running on our seat.
  async function seatedTimed(extra: Partial<Table> = {}) {
    const table = makeTable(WITH_ANA, extra)
    table.seats = table.seats.map((s) => (s.seat === 'S' ? { ...s, start_deadline: '2026-10-08T12:00:15Z' } : s))
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    const store = useTablesStore()
    await store.loadTable(5)
    const game = useGameStore()
    vi.mocked(gameService.getPlaying).mockResolvedValue({ ...watcherState({ phase: 'waiting' }), my_seat: null })
    await game.load(5)
    vi.mocked(gameService.getPlaying).mockClear()
    return store
  }

  test('the TableUpdated freeing our seat first: we stay, watching, and the board is read again', async () => {
    const store = await seatedTimed()

    pushUpdate(makeTable(OTHERS, { kibitzers: 1 }))

    expect(showToast).toHaveBeenCalledWith(START_WATCHING_NOTICE, 'warning')
    expect(START_WATCHING_NOTICE).toBe("You didn't press Start in time: you're watching the table now.")
    expect(store.kibitzingId).toBe(5)
    expect(store.watchedTableId).toBe(5)
    expect(store.kickedFrom).toBeNull()
    expect(echo.leaveTable).not.toHaveBeenCalled()
    expect(gameService.getPlaying).toHaveBeenCalledWith(5)
    // The game store keeps the table: it is still ours to show.
    expect(useGameStore().tableId).toBe(5)

    // Its UnseatedFromTable after it adds nothing.
    store.applyUnseated({ table_id: 5, reason: 'start_timeout', kibitzing: true })
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  test('UnseatedFromTable kibitzing first: our copies drop the seat, we stay, watching', async () => {
    const store = await seatedTimed()

    store.applyUnseated({ table_id: 5, reason: 'start_timeout', kibitzing: true })

    expect(showToast).toHaveBeenCalledWith(START_WATCHING_NOTICE, 'warning')
    expect(store.kibitzingId).toBe(5)
    expect(store.myTable).toBeNull()
    expect(store.currentTable!.free_seats).toEqual(['S'])
    expect(store.kickedFrom).toBeNull()
    expect(gameService.getPlaying).toHaveBeenCalledWith(5)

    // The TableUpdated after it: no second notice, still watching.
    pushUpdate(makeTable(OTHERS, { kibitzers: 1 }))
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(store.kibitzingId).toBe(5)
  })

  test('UnseatedFromTable kibitzing with nothing held of the table: still watching it', async () => {
    const store = await seatedTimed()
    store.currentTable = null
    store.tables = []
    useGameStore().clear()

    store.applyUnseated({ table_id: 5, reason: 'start_timeout', kibitzing: true })

    expect(store.kibitzingId).toBe(5)
    expect(gameService.getPlaying).not.toHaveBeenCalled()
  })

  test('a table that does not allow kibitzers: the seat freed is told, and the page leaves', async () => {
    const store = await seatedTimed({ allow_kibitzers: false })

    pushUpdate(makeTable(OTHERS, { allow_kibitzers: false }))

    expect(showToast).toHaveBeenCalledWith(START_TIMEOUT_NOTICE, 'warning')
    expect(store.kibitzingId).toBeNull()
    expect(store.kickedFrom).toBe(5)
  })

  test('a failed reread of the board is left to the page', async () => {
    const store = await seatedTimed()
    vi.mocked(gameService.getPlaying).mockRejectedValue(axiosError(500))

    store.applyUnseated({ table_id: 5, reason: 'start_timeout', kibitzing: true })
    await Promise.resolve()

    expect(store.kibitzingId).toBe(5)
  })
})

describe('game store: a kibitzer', () => {
  test('loads the public state: no seat, no hand', async () => {
    const game = useGameStore()
    vi.mocked(gameService.getPlaying).mockResolvedValue(watcherState())

    await game.load(5)

    expect(gameService.getPlaying).toHaveBeenCalledWith(5)
    expect(game.playing?.my_seat).toBeNull()
    expect(game.playing?.hand).toBeNull()
    expect(game.playing?.declarer_hand).toBeNull()
  })

  test('a PlayingUpdated keeps it seatless and handless', async () => {
    const game = useGameStore()
    vi.mocked(gameService.getPlaying).mockResolvedValue(watcherState())
    await game.load(5)

    const players = Object.fromEntries(
      Object.entries(OTHERS).map(([seat, username]) => [seat, { id: IDS[username], name: username, username, is_robot: false, is_admin: false }]),
    ) as Playing['players']
    // PlayingUpdated's shape: the public part only.
    const update: Partial<Playing> = watcherState({ players })
    delete update.my_seat
    delete update.hand
    delete update.declarer_hand
    game.applyPlayingUpdate(5, update as gameService.PublicPlaying)

    expect(game.playing?.my_seat).toBeNull()
    expect(game.playing?.hand).toBeNull()
  })

  test('a TableUpdated that seats nobody of ours keeps the board while we watch', async () => {
    const store = await watchingTable()
    const game = useGameStore()
    vi.mocked(gameService.getPlaying).mockResolvedValue(watcherState())
    await game.load(5)

    pushUpdate(makeTable({ ...OTHERS, S: 'robot-2' }, { board_id: 8 }))

    expect(game.tableId).toBe(5)
    expect(game.playing?.playing_id).toBe(42)
    expect(store.kibitzingId).toBe(5)
  })

  test('without watching, the same update clears the board (we were sent away)', async () => {
    const game = useGameStore()
    vi.mocked(gameService.getPlaying).mockResolvedValue(watcherState())
    await game.load(5)

    game.applyTableUpdate(makeTable(OTHERS))

    expect(game.tableId).toBeNull()
  })
})
