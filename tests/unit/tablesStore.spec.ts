import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useTablesStore } from '@/stores/tables'
import { useAuthStore } from '@/stores/auth'
import * as tablesService from '@/services/tables'
import * as echo from '@/services/echo'
import type { Seat, Table } from '@/services/tables'
import { showToast } from '@/utils/toast'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
  createTable: vi.fn(),
  joinSeat: vi.fn(),
  getTable: vi.fn(),
  leaveSeat: vi.fn(),
  removePlayer: vi.fn(),
}))

// No socket in unit tests: capture what the store subscribes to instead, so a
// test can play the part of Reverb and push a TableUpdated.
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))

vi.mock('@/utils/toast', () => ({
  showToast: vi.fn(),
}))

// What Reverb would call when a TableUpdated arrives on the last channel joined.
function pushUpdate(table: Table) {
  const calls = vi.mocked(echo.listenToTable).mock.calls
  const [, onUpdate] = calls[calls.length - 1]
  onUpdate(table)
}

// makeTable seats users 1, 2, … in the order the seats are given.
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
    created_at: '2026-09-20T10:00:00.000000Z',
    updated_at: '2026-09-20T10:00:00.000000Z',
    seats: taken.map(([seat, username], i) => ({
      id: id * 10 + i,
      table_id: id,
      user_id: i + 1,
      seat,
      user: { id: i + 1, name: username, username, email: `${username}@example.com` },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
  }
}

describe('tables store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
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

  describe('live updates', () => {
    test('loading a table you sit at subscribes to it', async () => {
      logInAs(1)
      vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(1, { N: 'ana' }))

      const store = useTablesStore()
      await store.loadTable(1)

      expect(echo.listenToTable).toHaveBeenCalledWith(1, expect.any(Function))
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

      expect(echo.listenToTable).toHaveBeenCalledWith(1, expect.any(Function))
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

      const store = useTablesStore()
      await store.loadTable(1)
      await store.join(2, 'S')

      expect(echo.leaveTable).toHaveBeenCalledWith(1)
      expect(echo.listenToTable).toHaveBeenLastCalledWith(2, expect.any(Function))
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
})
