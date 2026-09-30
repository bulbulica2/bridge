import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { IonToggle } from '@ionic/vue'
import TablesPage from '@/views/TablesPage.vue'
import { useAuthStore } from '@/stores/auth'
import { useTablesStore } from '@/stores/tables'
import { navigateAndSettle } from '@/router/loading'
import * as tablesService from '@/services/tables'
import type { Seat, Table } from '@/services/tables'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
  createTable: vi.fn(),
}))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))
vi.mock('@/router/loading', () => ({ navigateAndSettle: vi.fn() }))
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  useIonRouter: () => ({ navigate: vi.fn() }),
}))

const ana = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }

// Seats are given as seat -> username; `robot-…` usernames are robots.
function makeTable(id: number, seats: Partial<Record<Seat, string>>, extra: Partial<Table> = {}): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id,
    name: `Table ${id}`,
    created_by: 1,
    moderated_by: 1,
    board_id: null,
    unattended_since: null,
    created_at: '2026-10-01T10:00:00.000000Z',
    updated_at: '2026-10-01T10:00:00.000000Z',
    seats: taken.map(([seat, username], i) => ({
      id: id * 10 + i,
      table_id: id,
      user_id: username === 'ana' ? 1 : id * 10 + i + 100,
      seat,
      user: {
        id: username === 'ana' ? 1 : id * 10 + i + 100,
        name: username,
        username,
        description: null,
        is_robot: username.startsWith('robot-'),
      },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: false,
    ...extra,
  }
}

// IonModal only renders its content once presented, which jsdom never does.
const modalStub = { template: '<div><slot /></div>' }

// onIonViewWillEnter never fires outside a router outlet, so the list is put
// in the store directly rather than loaded.
function mountWith(tables: Table[]) {
  const store = useTablesStore()
  store.tables = tables
  store.loaded = true
  return mount(TablesPage, { global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } } })
}

describe('TablesPage.vue with robots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    useAuthStore().user = ana
    vi.mocked(navigateAndSettle).mockResolvedValue()
  })

  test('marks robots and unattended tables in the list', () => {
    const wrapper = mountWith([
      makeTable(2, { E: 'robot-1', S: 'robot-2' }, { moderated_by: null, unattended_since: '2026-10-01T10:05:00.000000Z' }),
      makeTable(1, { N: 'bob' }),
    ])

    const rows = wrapper.findAll('ion-list ion-item')
    const unattended = rows.find((r) => r.text().includes('Table 2'))!
    const plain = rows.find((r) => r.text().includes('Table 1'))!
    expect(unattended.text()).toContain('Robots only — sit down to take over')
    expect(unattended.findAll('.robot-badge')).toHaveLength(2)
    expect(plain.text()).not.toContain('Robots only')
    expect(plain.find('.robot-badge').exists()).toBe(false)
  })

  test('creating with robots (the default) goes straight to the dealt board', async () => {
    const dealt = makeTable(3, { N: 'ana', E: 'robot-1', S: 'robot-2', W: 'robot-3' }, { board_id: 8 })
    vi.mocked(tablesService.createTable).mockResolvedValue(dealt)
    const wrapper = mountWith([])

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: null, robots: true })
    expect(navigateAndSettle).toHaveBeenCalledWith(expect.anything(), '/tables/3/play', 'forward', 'push')
  })

  test('creating without robots stays on the list', async () => {
    vi.mocked(tablesService.createTable).mockResolvedValue(makeTable(3, { N: 'ana' }))
    const wrapper = mountWith([])

    wrapper.findComponent(IonToggle).vm.$emit('update:modelValue', false)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: null, robots: false })
    expect(navigateAndSettle).not.toHaveBeenCalled()
    expect(useTablesStore().tables.map((t) => t.id)).toEqual([3])
  })
})
