import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useTablesStore } from '@/stores/tables'
import * as tablesService from '@/services/tables'
import type { Seat, Table } from '@/services/tables'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
  createTable: vi.fn(),
  joinSeat: vi.fn(),
  getTable: vi.fn(),
  leaveSeat: vi.fn(),
  removePlayer: vi.fn(),
}))

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
})
