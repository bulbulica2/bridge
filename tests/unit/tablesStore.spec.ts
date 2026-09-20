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
    await store.load()

    expect(store.tables).toEqual(tables)
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
})
