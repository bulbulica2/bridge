import { AxiosError, AxiosHeaders } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HEARTBEAT_MS, IDLE_NOTICE, useTablesStore } from '@/stores/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import * as tablesService from '@/services/tables'
import * as echo from '@/services/echo'
import type { BroadcastTable, Seat, Table } from '@/services/tables'
import { showToast } from '@/utils/toast'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
  createTable: vi.fn(),
  joinSeat: vi.fn(),
  getTable: vi.fn(),
  leaveSeat: vi.fn(),
  removePlayer: vi.fn(),
  seatUser: vi.fn(),
  seatRobot: vi.fn(),
  sendHeartbeat: vi.fn(),
}))

vi.mock('@/services/auth', () => ({
  logout: vi.fn(),
}))

// No socket in unit tests: capture what the store subscribes to instead, so a
// test can play the part of Reverb and push a TableUpdated.
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))

vi.mock('@/utils/toast', () => ({
  showToast: vi.fn(),
}))

// What Reverb would call when a TableUpdated arrives on the last channel joined.
function pushUpdate(table: BroadcastTable) {
  const calls = vi.mocked(echo.listenToTable).mock.calls
  const [, onUpdate] = calls[calls.length - 1]
  onUpdate(table)
}

function axiosError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message: 'Forbidden' }, statusText: '', headers: {}, config }
  return error
}

// jsdom's page is always visible; let a test send it to the background.
let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

// makeTable seats users 1, 2, … in the order the seats are given; a
// `robot-…` username makes that one a robot.
function logInAs(id: number) {
  useAuthStore().user = { id, name: `user${id}`, username: `user${id}`, email: `user${id}@example.com` }
}

function makeTable(id: number, seats: Partial<Record<Seat, string>> = {}): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id,
    name: `Table ${id}`,
    created_by: 1,
    moderated_by: 1,
    board_id: null,
    unattended_since: null,
    created_at: '2026-09-20T10:00:00.000000Z',
    updated_at: '2026-09-20T10:00:00.000000Z',
    seats: taken.map(([seat, username], i) => ({
      id: id * 10 + i,
      table_id: id,
      user_id: i + 1,
      seat,
      user: {
        id: i + 1,
        name: username,
        username,
        description: null,
        is_robot: username.startsWith('robot-'),
      },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: false,
  }
}

// What TableUpdated carries: the table less the caller's own can_manage.
function broadcastOf(table: Table): BroadcastTable {
  const copy: Partial<Table> = { ...table }
  delete copy.can_manage
  return copy as BroadcastTable
}

describe('tables store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    visibility = 'visible'
    vi.mocked(tablesService.sendHeartbeat).mockResolvedValue(undefined)
  })

  // Every store listens to the page's visibility for good: stop this one's
  // heartbeat so it can't reach into the next test.
  afterEach(() => {
    useTablesStore().unwatchTable()
    vi.useRealTimers()
  })

  test('load fills the list', async () => {
    const tables = [makeTable(2), makeTable(1, { N: 'ana' })]
    vi.mocked(tablesService.listTables).mockResolvedValue(tables)

    const store = useTablesStore()
    expect(store.loaded).toBe(false)
    await store.load()

    expect(store.tables).toEqual(tables)
    expect(store.loaded).toBe(true)
  })

  test('failed load keeps the list and stays not-loaded', async () => {
    vi.mocked(tablesService.listTables).mockRejectedValueOnce(new Error('offline'))

    const store = useTablesStore()
    await expect(store.load()).rejects.toThrow()

    expect(store.tables).toEqual([])
    expect(store.loaded).toBe(false)
  })

  test('create puts the new table on top of the list', async () => {
    const existing = makeTable(1)
    const created = makeTable(2, { N: 'ana' })
    vi.mocked(tablesService.listTables).mockResolvedValue([existing])
    vi.mocked(tablesService.createTable).mockResolvedValue(created)

    const store = useTablesStore()
    await store.load()
    await store.create({ name: 'Table 2' })

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: 'Table 2' })
    expect(store.tables).toEqual([created, existing])
  })

  test('failed create leaves the list unchanged', async () => {
    vi.mocked(tablesService.createTable).mockRejectedValue(new Error('409'))

    const store = useTablesStore()
    await expect(store.create({ name: 'Table 2' })).rejects.toThrow()

    expect(store.tables).toEqual([])
  })

  test('join replaces that table in place', async () => {
    const first = makeTable(2)
    const second = makeTable(1, { N: 'ana' })
    const joined = makeTable(1, { N: 'ana', E: 'bob' })
    vi.mocked(tablesService.listTables).mockResolvedValue([first, second])
    vi.mocked(tablesService.joinSeat).mockResolvedValue(joined)

    const store = useTablesStore()
    await store.load()
    await store.join(1, 'E')

    expect(tablesService.joinSeat).toHaveBeenCalledWith(1, 'E')
    expect(store.tables).toEqual([first, joined])
  })

  test('failed join leaves the seat free', async () => {
    const table = makeTable(1, { N: 'ana' })
    vi.mocked(tablesService.listTables).mockResolvedValue([table])
    vi.mocked(tablesService.joinSeat).mockRejectedValue(new Error('409'))

    const store = useTablesStore()
    await store.load()
    await expect(store.join(1, 'E')).rejects.toThrow()

    expect(store.tables).toEqual([table])
  })

  test('loadTable sets the current table', async () => {
    const table = makeTable(1, { N: 'ana' })
    vi.mocked(tablesService.getTable).mockResolvedValue(table)

    const store = useTablesStore()
    await store.loadTable(1)

    expect(tablesService.getTable).toHaveBeenCalledWith(1)
    expect(store.currentTable).toEqual(table)
  })

  test('loadTable refreshes the row already in the list', async () => {
    const other = makeTable(2)
    const stale = makeTable(1, { N: 'ana' })
    const fresh = makeTable(1, { N: 'ana', E: 'bob' })
    vi.mocked(tablesService.listTables).mockResolvedValue([other, stale])
    vi.mocked(tablesService.getTable).mockResolvedValue(fresh)

    const store = useTablesStore()
    await store.load()
    await store.loadTable(1)

    expect(store.tables).toEqual([other, fresh])
  })

  test('loadTable does not add a table the list never had', async () => {
    const listed = makeTable(2)
    const opened = makeTable(7, { N: 'ana' })
    vi.mocked(tablesService.listTables).mockResolvedValue([listed])
    vi.mocked(tablesService.getTable).mockResolvedValue(opened)

    const store = useTablesStore()
    await store.load()
    await store.loadTable(7)

    // The list is ordered by the backend, so a deep-linked table has no
    // correct position in it; only load() may grow the list.
    expect(store.tables).toEqual([listed])
    expect(store.currentTable).toEqual(opened)
  })

  test('join also updates the current table when it is the open one', async () => {
    const opened = makeTable(1, { N: 'ana' })
    const joined = makeTable(1, { N: 'ana', E: 'bob' })
    vi.mocked(tablesService.getTable).mockResolvedValue(opened)
    vi.mocked(tablesService.joinSeat).mockResolvedValue(joined)

    const store = useTablesStore()
    await store.loadTable(1)
    await store.join(1, 'E')

    expect(store.currentTable).toEqual(joined)
  })

  test('join leaves a different open table alone', async () => {
    const opened = makeTable(1, { N: 'ana' })
    const joined = makeTable(2, { E: 'bob' })
    vi.mocked(tablesService.getTable).mockResolvedValue(opened)
    vi.mocked(tablesService.joinSeat).mockResolvedValue(joined)

    const store = useTablesStore()
    await store.loadTable(1)
    await store.join(2, 'E')

    expect(store.currentTable).toEqual(opened)
  })

  test('leave replaces the table when other players remain', async () => {
    const before = makeTable(1, { N: 'ana', E: 'bob' })
    const after = makeTable(1, { N: 'ana' })
    vi.mocked(tablesService.listTables).mockResolvedValue([before])
    vi.mocked(tablesService.getTable).mockResolvedValue(before)
    vi.mocked(tablesService.leaveSeat).mockResolvedValue(after)

    const store = useTablesStore()
    await store.load()
    await store.loadTable(1)
    const result = await store.leave(1)

    expect(result).toEqual({ tableDeleted: false })
    expect(store.tables).toEqual([after])
    expect(store.currentTable).toEqual(after)
  })

  test('leave forgets the table when the last player walks out', async () => {
    const other = makeTable(2)
    const mine = makeTable(1, { N: 'ana' })
    vi.mocked(tablesService.listTables).mockResolvedValue([other, mine])
    vi.mocked(tablesService.getTable).mockResolvedValue(mine)
    vi.mocked(tablesService.leaveSeat).mockResolvedValue({ table_deleted: true })

    const store = useTablesStore()
    await store.load()
    await store.loadTable(1)
    const result = await store.leave(1)

    expect(result).toEqual({ tableDeleted: true })
    expect(store.tables).toEqual([other])
    expect(store.currentTable).toBeNull()
  })

  test('failed leave keeps the seat', async () => {
    const table = makeTable(1, { N: 'ana' })
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    vi.mocked(tablesService.leaveSeat).mockRejectedValue(new Error('409'))

    const store = useTablesStore()
    await store.loadTable(1)
    await expect(store.leave(1)).rejects.toThrow()

    expect(store.currentTable).toEqual(table)
  })

  test('removePlayer replaces the table in the list and the open page', async () => {
    const before = makeTable(1, { N: 'ana', E: 'bob' })
    const after = makeTable(1, { N: 'ana' })
    vi.mocked(tablesService.listTables).mockResolvedValue([before])
    vi.mocked(tablesService.getTable).mockResolvedValue(before)
    vi.mocked(tablesService.removePlayer).mockResolvedValue(after)

    const store = useTablesStore()
    await store.load()
    await store.loadTable(1)
    const result = await store.removePlayer(1, 2)

    expect(tablesService.removePlayer).toHaveBeenCalledWith(1, 2)
    expect(result).toEqual({ tableDeleted: false })
    expect(store.tables).toEqual([after])
    expect(store.currentTable).toEqual(after)
  })

  test('removePlayer forgets the table when it empties it', async () => {
    const table = makeTable(1, { N: 'ana' })
    vi.mocked(tablesService.listTables).mockResolvedValue([table])
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    vi.mocked(tablesService.removePlayer).mockResolvedValue({ table_deleted: true })

    const store = useTablesStore()
    await store.load()
    await store.loadTable(1)
    const result = await store.removePlayer(1, 1)

    expect(result).toEqual({ tableDeleted: true })
    expect(store.tables).toEqual([])
    expect(store.currentTable).toBeNull()
  })

  test('failed removePlayer keeps the player seated', async () => {
    const table = makeTable(1, { N: 'ana', E: 'bob' })
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    vi.mocked(tablesService.removePlayer).mockRejectedValue(new Error('403'))

    const store = useTablesStore()
    await store.loadTable(1)
    await expect(store.removePlayer(1, 2)).rejects.toThrow()

    expect(store.currentTable).toEqual(table)
  })

  describe('seating another player', () => {
    test('seatUser replaces the table in the list and the open page', async () => {
      logInAs(1)
      const before = { ...makeTable(1, { N: 'ana' }), can_manage: true }
      const after = { ...makeTable(1, { N: 'ana', E: 'bob' }), can_manage: true }
      vi.mocked(tablesService.listTables).mockResolvedValue([before])
      vi.mocked(tablesService.getTable).mockResolvedValue(before)
      vi.mocked(tablesService.seatUser).mockResolvedValue(after)

      const store = useTablesStore()
      await store.load()
      await store.loadTable(1)
      const result = await store.seatUser(1, 2, 'E')

      expect(tablesService.seatUser).toHaveBeenCalledWith(1, 2, 'E')
      expect(result).toEqual(after)
      expect(store.tables).toEqual([after])
      expect(store.currentTable).toEqual(after)
      expect(store.watchedTableId).toBe(1)
    })

    test('the fourth player seated brings the board', async () => {
      logInAs(1)
      const before = { ...makeTable(1, { N: 'ana', E: 'bob', S: 'cy' }), can_manage: true }
      const dealt = { ...makeTable(1, { N: 'ana', E: 'bob', S: 'cy', W: 'di' }), board_id: 5, can_manage: true }
      vi.mocked(tablesService.getTable).mockResolvedValue(before)
      vi.mocked(tablesService.seatUser).mockResolvedValue(dealt)

      const store = useTablesStore()
      await store.loadTable(1)
      await store.seatUser(1, 4, 'W')

      expect(store.currentTable?.board_id).toBe(5)
    })

    test('an unseated admin seating someone does not subscribe', async () => {
      logInAs(9)
      const before = { ...makeTable(1, { N: 'ana' }), can_manage: true }
      vi.mocked(tablesService.getTable).mockResolvedValue(before)
      vi.mocked(tablesService.seatUser).mockResolvedValue({
        ...makeTable(1, { N: 'ana', E: 'bob' }),
        can_manage: true,
      })

      const store = useTablesStore()
      await store.loadTable(1)
      await store.seatUser(1, 2, 'E')

      expect(echo.listenToTable).not.toHaveBeenCalled()
      expect(store.currentTable?.seats).toHaveLength(2)
    })

    test('a refused seatUser leaves the table as it was', async () => {
      const table = { ...makeTable(1, { N: 'ana' }), can_manage: true }
      vi.mocked(tablesService.getTable).mockResolvedValue(table)
      vi.mocked(tablesService.seatUser).mockRejectedValue(axiosError(409))

      const store = useTablesStore()
      await store.loadTable(1)
      await expect(store.seatUser(1, 2, 'E')).rejects.toMatchObject({ response: { status: 409 } })

      expect(store.currentTable).toEqual(table)
    })
  })

  describe('robots', () => {
    const since = '2026-10-01T10:00:00.000000Z'

    test('create with robots sends the flag and follows the dealt table', async () => {
      logInAs(1)
      const dealt = {
        ...makeTable(3, { N: 'ana', E: 'robot-1', S: 'robot-2', W: 'robot-3' }),
        board_id: 11,
        can_manage: true,
      }
      vi.mocked(tablesService.createTable).mockResolvedValue(dealt)

      const store = useTablesStore()
      const table = await store.create({ name: 'Solo', robots: true })

      expect(tablesService.createTable).toHaveBeenCalledWith({ name: 'Solo', robots: true })
      expect(table.board_id).toBe(11)
      expect(store.tables).toEqual([dealt])
      expect(store.watchedTableId).toBe(3)
    })

    test('seatRobot replaces the table in the list and the open page', async () => {
      logInAs(1)
      const before = { ...makeTable(1, { N: 'ana' }), can_manage: true }
      const after = { ...makeTable(1, { N: 'ana', E: 'robot-1' }), can_manage: true }
      vi.mocked(tablesService.listTables).mockResolvedValue([before])
      vi.mocked(tablesService.getTable).mockResolvedValue(before)
      vi.mocked(tablesService.seatRobot).mockResolvedValue(after)

      const store = useTablesStore()
      await store.load()
      await store.loadTable(1)
      const result = await store.seatRobot(1, 'E')

      expect(tablesService.seatRobot).toHaveBeenCalledWith(1, 'E')
      expect(result).toEqual(after)
      expect(store.tables).toEqual([after])
      expect(store.currentTable).toEqual(after)
      expect(store.watchedTableId).toBe(1)
    })

    test('a robot in the fourth seat brings the board', async () => {
      logInAs(1)
      const before = { ...makeTable(1, { N: 'ana', E: 'robot-1', S: 'robot-2' }), can_manage: true }
      const dealt = {
        ...makeTable(1, { N: 'ana', E: 'robot-1', S: 'robot-2', W: 'robot-3' }),
        board_id: 5,
        can_manage: true,
      }
      vi.mocked(tablesService.getTable).mockResolvedValue(before)
      vi.mocked(tablesService.seatRobot).mockResolvedValue(dealt)

      const store = useTablesStore()
      await store.loadTable(1)
      await store.seatRobot(1, 'W')

      expect(store.currentTable?.board_id).toBe(5)
    })

    test('a refused seatRobot leaves the table as it was', async () => {
      const table = { ...makeTable(1, { N: 'ana' }), can_manage: true }
      vi.mocked(tablesService.getTable).mockResolvedValue(table)
      vi.mocked(tablesService.seatRobot).mockRejectedValue(axiosError(409))

      const store = useTablesStore()
      await store.loadTable(1)
      await expect(store.seatRobot(1, 'E')).rejects.toMatchObject({ response: { status: 409 } })

      expect(store.currentTable).toEqual(table)
    })

    test('anyone taking a robot out of an unattended table updates it without subscribing', async () => {
      logInAs(9)
      const unattended = {
        ...makeTable(1, { E: 'robot-1', S: 'robot-2' }),
        moderated_by: null,
        unattended_since: since,
      }
      const after = { ...makeTable(1, { S: 'robot-2' }), moderated_by: null, unattended_since: since }
      vi.mocked(tablesService.getTable).mockResolvedValue(unattended)
      vi.mocked(tablesService.removePlayer).mockResolvedValue(after)

      const store = useTablesStore()
      await store.loadTable(1)
      const { tableDeleted } = await store.removePlayer(1, 1)

      expect(tableDeleted).toBe(false)
      expect(store.currentTable?.seats).toHaveLength(1)
      expect(echo.listenToTable).not.toHaveBeenCalled()
      expect(store.kickedFrom).toBeNull()
    })

    test('taking out the last robot deletes the table', async () => {
      logInAs(9)
      const unattended = {
        ...makeTable(1, { S: 'robot-2' }),
        moderated_by: null,
        unattended_since: since,
      }
      vi.mocked(tablesService.listTables).mockResolvedValue([unattended])
      vi.mocked(tablesService.getTable).mockResolvedValue(unattended)
      vi.mocked(tablesService.removePlayer).mockResolvedValue({ table_deleted: true })

      const store = useTablesStore()
      await store.load()
      await store.loadTable(1)
      const { tableDeleted } = await store.removePlayer(1, 1)

      expect(tableDeleted).toBe(true)
      expect(store.tables).toEqual([])
      expect(store.currentTable).toBeNull()
    })

    test('sitting down at an unattended table takes it over', async () => {
      logInAs(3)
      const unattended = {
        ...makeTable(1, { N: 'robot-1', E: 'robot-2' }),
        moderated_by: null,
        unattended_since: since,
      }
      const taken = {
        ...makeTable(1, { N: 'robot-1', E: 'robot-2', S: 'cy' }),
        moderated_by: 3,
        can_manage: true,
      }
      vi.mocked(tablesService.listTables).mockResolvedValue([unattended])
      vi.mocked(tablesService.joinSeat).mockResolvedValue(taken)

      const store = useTablesStore()
      await store.load()
      await store.join(1, 'S')

      expect(store.tables[0].unattended_since).toBeNull()
      expect(store.tables[0].can_manage).toBe(true)
      expect(store.watchedTableId).toBe(1)
    })
  })

  test('forget drops a table that no longer exists', async () => {
    const other = makeTable(2)
    const gone = makeTable(1, { N: 'ana' })
    vi.mocked(tablesService.listTables).mockResolvedValue([other, gone])
    vi.mocked(tablesService.getTable).mockResolvedValue(gone)

    const store = useTablesStore()
    await store.load()
    await store.loadTable(1)
    store.forget(1)

    expect(store.tables).toEqual([other])
    expect(store.currentTable).toBeNull()
  })

  describe('seat moves', () => {
    test('a seat change at the same table keeps the list and the channel', async () => {
      logInAs(1)
      const before = makeTable(1, { N: 'ana' })
      const after = makeTable(1, { E: 'ana' })
      vi.mocked(tablesService.listTables).mockResolvedValue([before])
      vi.mocked(tablesService.joinSeat).mockResolvedValue(after)

      const store = useTablesStore()
      await store.load()
      await store.join(1, 'E')

      expect(tablesService.listTables).toHaveBeenCalledTimes(1)
      expect(store.tables).toEqual([after])
      expect(echo.leaveTable).not.toHaveBeenCalled()
      expect(store.watchedTableId).toBe(1)
    })

    test('a move to another table reloads the list', async () => {
      logInAs(1)
      const old = makeTable(1, { N: 'ana', E: 'bob' })
      const target = makeTable(2)
      const joined = makeTable(2, { N: 'ana' })
      const oldAfter = { ...old, seats: [old.seats[1]], moderated_by: 2 }
      vi.mocked(tablesService.listTables).mockResolvedValueOnce([target, old])
      vi.mocked(tablesService.joinSeat).mockResolvedValue(joined)

      const store = useTablesStore()
      await store.load()
      expect(store.myTable?.id).toBe(1)
      vi.mocked(tablesService.listTables).mockResolvedValueOnce([joined, oldAfter])
      await store.join(2, 'N')

      expect(tablesService.listTables).toHaveBeenCalledTimes(2)
      expect(store.tables).toEqual([joined, oldAfter])
      expect(store.myTable?.id).toBe(2)
      expect(echo.leaveTable).toHaveBeenCalledWith(1)
      expect(store.watchedTableId).toBe(2)
    })

    test('the old table disappears when the move emptied it', async () => {
      logInAs(1)
      const old = makeTable(1, { N: 'ana' })
      const joined = makeTable(2, { N: 'ana' })
      vi.mocked(tablesService.listTables).mockResolvedValueOnce([makeTable(2), old])
      vi.mocked(tablesService.getTable).mockResolvedValue(old)
      vi.mocked(tablesService.joinSeat).mockResolvedValue(joined)

      const store = useTablesStore()
      await store.load()
      await store.loadTable(1)
      vi.mocked(tablesService.listTables).mockResolvedValueOnce([joined])
      await store.join(2, 'N')

      expect(store.tables).toEqual([joined])
      // The old table was open: it is gone, not left showing us seated.
      expect(store.currentTable).toBeNull()
    })

    test('a move is not mistaken for a kick from the old table', async () => {
      logInAs(2)
      const old = makeTable(1, { N: 'ana', E: 'bob' })
      const oldAfter = makeTable(1, { N: 'ana' })
      const joined = { ...makeTable(2), seats: [{ ...old.seats[1], table_id: 2 }] }
      vi.mocked(tablesService.getTable).mockResolvedValue(old)
      vi.mocked(tablesService.listTables).mockResolvedValue([joined, oldAfter])
      vi.mocked(tablesService.joinSeat).mockImplementation(async () => {
        pushUpdate(oldAfter)
        return joined
      })

      const store = useTablesStore()
      await store.loadTable(1)
      await store.join(2, 'E')

      expect(store.kickedFrom).toBeNull()
      expect(showToast).not.toHaveBeenCalled()
      expect(store.watchedTableId).toBe(2)
    })

    test('a failed reload after a move still counts as a successful join', async () => {
      logInAs(1)
      const joined = makeTable(2, { N: 'ana' })
      vi.mocked(tablesService.listTables).mockResolvedValueOnce([makeTable(2), makeTable(1, { N: 'ana' })])
      vi.mocked(tablesService.joinSeat).mockResolvedValue(joined)

      const store = useTablesStore()
      await store.load()
      vi.mocked(tablesService.listTables).mockRejectedValueOnce(new Error('offline'))

      await expect(store.join(2, 'N')).resolves.toEqual(joined)
      expect(store.watchedTableId).toBe(2)
    })

    test('seatedTable loads the list when nothing says where you sit', async () => {
      logInAs(1)
      const mine = makeTable(1, { N: 'ana' })
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(2))
      vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(2), mine])

      const store = useTablesStore()
      await store.loadTable(2)

      expect(await store.seatedTable()).toEqual(mine)
      expect(tablesService.listTables).toHaveBeenCalledTimes(1)
      await store.seatedTable()
      expect(tablesService.listTables).toHaveBeenCalledTimes(1)
    })
  })

  describe('live updates', () => {
    test('loading a table you sit at subscribes to it', async () => {
      logInAs(1)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana' }))

      const store = useTablesStore()
      await store.loadTable(1)

      expect(echo.listenToTable).toHaveBeenCalledWith(1, expect.any(Function), expect.any(Function))
      expect(store.watchedTableId).toBe(1)
    })

    test('never subscribes while unseated', async () => {
      logInAs(9)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana' }))
      vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(1, { N: 'ana' })])

      const store = useTablesStore()
      await store.loadTable(1)
      await store.load()

      expect(echo.listenToTable).not.toHaveBeenCalled()
      expect(store.watchedTableId).toBeNull()
    })

    test('the list subscribes to the table you sit at', async () => {
      logInAs(2)
      vi.mocked(tablesService.listTables).mockResolvedValue([
        makeTable(2, { N: 'ana' }),
        makeTable(1, { N: 'ana', E: 'bob' }),
      ])

      const store = useTablesStore()
      await store.load()

      expect(echo.listenToTable).toHaveBeenCalledWith(1, expect.any(Function), expect.any(Function))
    })

    test('creating a table subscribes to it', async () => {
      logInAs(1)
      vi.mocked(tablesService.createTable).mockResolvedValue(makeTable(3, { N: 'ana' }))

      const store = useTablesStore()
      await store.create({ name: null })

      expect(store.watchedTableId).toBe(3)
    })

    test('moving to another table switches channels', async () => {
      logInAs(1)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana' }))
      vi.mocked(tablesService.joinSeat).mockResolvedValue(makeTable(2, { S: 'ana' }))
      vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(2, { S: 'ana' })])

      const store = useTablesStore()
      await store.loadTable(1)
      await store.join(2, 'S')

      expect(echo.leaveTable).toHaveBeenCalledWith(1)
      expect(echo.listenToTable).toHaveBeenLastCalledWith(2, expect.any(Function), expect.any(Function))
      expect(store.watchedTableId).toBe(2)
    })

    test('an update replaces the table in the list and the open page', async () => {
      logInAs(1)
      const before = makeTable(1, { N: 'ana' })
      const after = { ...makeTable(1, { N: 'ana', E: 'bob' }), board_id: null }
      vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(2), before])
      vi.mocked(tablesService.getTable).mockResolvedValue(before)

      const store = useTablesStore()
      await store.load()
      await store.loadTable(1)
      pushUpdate(after)

      expect(store.currentTable).toEqual(after)
      expect(store.tables[1]).toEqual(after)
      expect(store.kickedFrom).toBeNull()
      expect(echo.leaveTable).not.toHaveBeenCalled()
    })

    test('an update replaces rather than merges', async () => {
      logInAs(1)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana', E: 'bob' }))

      const store = useTablesStore()
      await store.loadTable(1)
      const after = makeTable(1, { N: 'ana' })
      pushUpdate(after)

      expect(store.currentTable).toEqual(after)
      expect(store.currentTable?.seats).toHaveLength(1)
    })

    test('leaving unsubscribes without calling it a kick', async () => {
      logInAs(2)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana', E: 'bob' }))
      vi.mocked(tablesService.leaveSeat).mockResolvedValue(makeTable(1, { N: 'ana' }))

      const store = useTablesStore()
      await store.loadTable(1)
      await store.leave(1)

      expect(echo.leaveTable).toHaveBeenCalledWith(1)
      expect(store.watchedTableId).toBeNull()
      expect(store.kickedFrom).toBeNull()
      expect(showToast).not.toHaveBeenCalled()
    })

    test('leaving the last seat unsubscribes', async () => {
      logInAs(1)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana' }))
      vi.mocked(tablesService.leaveSeat).mockResolvedValue({ table_deleted: true })

      const store = useTablesStore()
      await store.loadTable(1)
      await store.leave(1)

      expect(echo.leaveTable).toHaveBeenCalledWith(1)
      expect(store.watchedTableId).toBeNull()
    })

    test('our own leave broadcast beating the response is not a kick', async () => {
      logInAs(2)
      const after = makeTable(1, { N: 'ana' })
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana', E: 'bob' }))
      vi.mocked(tablesService.leaveSeat).mockImplementation(async () => {
        pushUpdate(after)
        return after
      })

      const store = useTablesStore()
      await store.loadTable(1)
      await store.leave(1)

      expect(store.watchedTableId).toBeNull()
      expect(store.kickedFrom).toBeNull()
      expect(showToast).not.toHaveBeenCalled()
    })

    test('an update that no longer seats you is a kick', async () => {
      logInAs(2)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana', E: 'bob' }))

      const store = useTablesStore()
      await store.loadTable(1)
      const after = makeTable(1, { N: 'ana' })
      pushUpdate(after)

      expect(echo.leaveTable).toHaveBeenCalledWith(1)
      expect(store.watchedTableId).toBeNull()
      expect(store.kickedFrom).toBe(1)
      expect(store.currentTable).toEqual(after)
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('removed'), 'warning')
    })

    test('an update keeps the can_manage we last got over HTTP', async () => {
      logInAs(1)
      vi.mocked(tablesService.listTables).mockResolvedValue([
        { ...makeTable(1, { N: 'ana' }), can_manage: true },
      ])
      vi.mocked(tablesService.getTable).mockResolvedValue({
        ...makeTable(1, { N: 'ana' }),
        can_manage: true,
      })

      const store = useTablesStore()
      await store.load()
      await store.loadTable(1)
      vi.mocked(tablesService.getTable).mockClear()
      const broadcast = broadcastOf(makeTable(1, { N: 'ana', E: 'bob' }))
      pushUpdate(broadcast)

      expect(store.currentTable).toEqual({ ...broadcast, can_manage: true })
      expect(store.tables[0].can_manage).toBe(true)
      expect(tablesService.getTable).not.toHaveBeenCalled()
    })

    test('a new moderator refetches can_manage without undoing later seats', async () => {
      logInAs(2)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana', E: 'bob' }))

      const store = useTablesStore()
      await store.loadTable(1)
      // ana (1) leaves and the role passes to bob (2).
      const both = makeTable(1, { N: 'ana', E: 'bob' })
      const handedOn = broadcastOf({
        ...both,
        moderated_by: 2,
        seats: both.seats.filter((seat) => seat.user_id === 2),
        free_seats: ['N', 'S', 'W'],
      })
      vi.mocked(tablesService.getTable)
        .mockClear()
        .mockResolvedValue({ ...handedOn, can_manage: true })
      pushUpdate(handedOn)

      expect(tablesService.getTable).toHaveBeenCalledWith(1)
      expect(store.currentTable?.can_manage).toBe(false)
      await flushPromises()

      expect(store.currentTable).toEqual({ ...handedOn, can_manage: true })
    })

    test('after a reconnect the watched table is refetched once', async () => {
      logInAs(1)
      const missed = makeTable(1, { N: 'ana', E: 'bob' })
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana' }))

      const store = useTablesStore()
      await store.loadTable(1)
      vi.mocked(tablesService.getTable).mockClear().mockResolvedValue(missed)
      const [reconnected] = vi.mocked(echo.onReconnect).mock.calls[0]
      await reconnected()

      expect(tablesService.getTable).toHaveBeenCalledTimes(1)
      expect(store.currentTable).toEqual(missed)
    })
  })

  describe('heartbeat', () => {
    // Seated at table 1 as user 2 (bob), with fake timers already running.
    async function seated() {
      vi.useFakeTimers()
      logInAs(2)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana', E: 'bob' }))
      const store = useTablesStore()
      await store.loadTable(1)
      return store
    }

    test('beats every 30 s while seated', async () => {
      await seated()

      expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
      expect(tablesService.sendHeartbeat).toHaveBeenCalledTimes(1)
      expect(tablesService.sendHeartbeat).toHaveBeenCalledWith(1)
      await vi.advanceTimersByTimeAsync(2 * HEARTBEAT_MS)
      expect(tablesService.sendHeartbeat).toHaveBeenCalledTimes(3)
    })

    test('never beats while unseated', async () => {
      vi.useFakeTimers()
      logInAs(9)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana' }))

      await useTablesStore().loadTable(1)
      await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS)

      expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()
    })

    test('stops on leave', async () => {
      const store = await seated()
      vi.mocked(tablesService.leaveSeat).mockResolvedValue(makeTable(1, { N: 'ana' }))

      await store.leave(1)
      await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS)

      expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()
    })

    test('stops on a kick', async () => {
      await seated()

      pushUpdate(makeTable(1, { N: 'ana' }))
      await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS)

      expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()
    })

    test('stops on logout', async () => {
      await seated()

      await useAuthStore().logout()
      await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS)

      expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()
    })

    test('follows a move to the new table', async () => {
      const store = await seated()
      vi.mocked(tablesService.joinSeat).mockResolvedValue(makeTable(2, { N: 'ana', S: 'bob' }))
      vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(2, { N: 'ana', S: 'bob' })])

      await store.join(2, 'S')
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)

      expect(tablesService.sendHeartbeat).toHaveBeenCalledTimes(1)
      expect(tablesService.sendHeartbeat).toHaveBeenCalledWith(2)
    })

    test('pauses while the page is hidden and beats at once on return', async () => {
      await seated()

      setVisibility('hidden')
      await vi.advanceTimersByTimeAsync(10 * HEARTBEAT_MS)
      expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()

      setVisibility('visible')
      await vi.advanceTimersByTimeAsync(0)
      expect(tablesService.sendHeartbeat).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
      expect(tablesService.sendHeartbeat).toHaveBeenCalledTimes(2)
    })

    test('does not start while the page is hidden', async () => {
      visibility = 'hidden'
      await seated()

      await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS)

      expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()
    })

    test('coming back refetches the table and the board', async () => {
      const store = await seated()
      const game = useGameStore()
      game.tableId = 1
      const load = vi.spyOn(game, 'load').mockResolvedValue(null as never)
      const meanwhile = makeTable(1, { N: 'ana', E: 'bob', S: 'cy' })

      setVisibility('hidden')
      vi.mocked(tablesService.getTable).mockClear().mockResolvedValue(meanwhile)
      setVisibility('visible')
      await vi.advanceTimersByTimeAsync(0)

      expect(tablesService.getTable).toHaveBeenCalledTimes(1)
      expect(store.currentTable).toEqual(meanwhile)
      expect(load).toHaveBeenCalledWith(1)
      expect(showToast).not.toHaveBeenCalled()
    })

    test('a seat freed while away is told on return', async () => {
      const store = await seated()

      setVisibility('hidden')
      vi.mocked(tablesService.sendHeartbeat).mockRejectedValue(axiosError(403))
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana' }))
      setVisibility('visible')
      await vi.advanceTimersByTimeAsync(0)

      expect(showToast).toHaveBeenCalledWith(IDLE_NOTICE, 'warning')
      expect(store.kickedFrom).toBe(1)
      expect(store.watchedTableId).toBeNull()
      vi.mocked(tablesService.sendHeartbeat).mockClear()
      await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS)
      expect(tablesService.sendHeartbeat).not.toHaveBeenCalled()
    })

    test('a removal broadcast while hidden waits for the user to look', async () => {
      const store = await seated()

      setVisibility('hidden')
      pushUpdate(makeTable(1, { N: 'ana' }))

      expect(store.kickedFrom).toBe(1)
      expect(showToast).not.toHaveBeenCalled()
      setVisibility('visible')
      await vi.advanceTimersByTimeAsync(0)
      expect(showToast).toHaveBeenCalledTimes(1)
      expect(showToast).toHaveBeenCalledWith(IDLE_NOTICE, 'warning')
    })

    test('a table deleted while away sends the user off it', async () => {
      const store = await seated()

      setVisibility('hidden')
      vi.mocked(tablesService.sendHeartbeat).mockRejectedValue(axiosError(404))
      vi.mocked(tablesService.getTable).mockRejectedValue(axiosError(404))
      setVisibility('visible')
      await vi.advanceTimersByTimeAsync(0)

      expect(store.currentTable).toBeNull()
      expect(store.kickedFrom).toBe(1)
      expect(showToast).toHaveBeenCalledWith(IDLE_NOTICE, 'warning')
    })

    test('a refused beat looks at the table to see why', async () => {
      const store = await seated()
      vi.mocked(tablesService.sendHeartbeat).mockRejectedValue(axiosError(403))
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana' }))

      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)

      expect(store.kickedFrom).toBe(1)
      expect(store.watchedTableId).toBeNull()
      expect(showToast).toHaveBeenCalledWith(IDLE_NOTICE, 'warning')
    })

    test('a beat lost to the network changes nothing', async () => {
      const store = await seated()
      vi.mocked(tablesService.sendHeartbeat).mockRejectedValueOnce(new Error('offline'))

      await vi.advanceTimersByTimeAsync(2 * HEARTBEAT_MS)

      expect(tablesService.getTable).toHaveBeenCalledTimes(1)
      expect(store.watchedTableId).toBe(1)
      expect(tablesService.sendHeartbeat).toHaveBeenCalledTimes(2)
    })
  })
})
