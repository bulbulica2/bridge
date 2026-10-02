import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { IonToggle } from '@ionic/vue'
import TablesPage from '@/views/TablesPage.vue'
import { useAuthStore } from '@/stores/auth'
import { useTablesStore } from '@/stores/tables'
import * as tablesService from '@/services/tables'
import { confirmMove } from '@/utils/seatMove'
import { showToast } from '@/utils/toast'
import type { Seat, Table } from '@/services/tables'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
  createTable: vi.fn(),
  joinSeat: vi.fn(),
  sendHeartbeat: vi.fn(),
}))
vi.mock('@/utils/seatMove', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/seatMove')>()),
  confirmMove: vi.fn(),
}))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn() }))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  useIonRouter: () => ({ navigate }),
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

  test('creating with robots (the default) goes to the table, where Start is', async () => {
    // Full, but nothing is dealt until the creator presses Start.
    const full = makeTable(3, { N: 'ana', E: 'robot-1', S: 'robot-2', W: 'robot-3' })
    vi.mocked(tablesService.createTable).mockResolvedValue(full)
    const wrapper = mountWith([])

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: null, robots: true })
    expect(navigate).toHaveBeenCalledWith('/tables/3', 'forward', 'push')
    // The table page draws from this copy rather than fetching the table again.
    expect(useTablesStore().currentTable).toEqual(full)
    // The form is free again at once: nothing waits for the game page to be up.
    expect(wrapper.find('form ion-spinner').exists()).toBe(false)
  })

  test('creating without robots stays on the list', async () => {
    vi.mocked(tablesService.createTable).mockResolvedValue(makeTable(3, { N: 'ana' }))
    const wrapper = mountWith([])

    wrapper.findComponent(IonToggle).vm.$emit('update:modelValue', false)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: null, robots: false })
    expect(navigate).not.toHaveBeenCalled()
    expect(useTablesStore().tables.map((t) => t.id)).toEqual([3])
  })
})

describe('TablesPage.vue taking a seat', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    useAuthStore().user = ana
  })

  // The seat button of `seat` in the row of table `id`.
  function seatButton(wrapper: ReturnType<typeof mountWith>, id: number, seat: Seat) {
    const row = wrapper.findAll('ion-list ion-item').find((r) => r.text().includes(`Table ${id}`))!
    return row.findAll('.seat').find((s) => s.get('.seat-name').text() === seat)!.get('ion-button')
  }

  // Ionic's web components take `disabled` as a DOM property, not an attribute.
  function isDisabled(button: ReturnType<typeof seatButton>) {
    return (button.element as Element & { disabled?: boolean }).disabled
  }

  test('a table still waiting for players opens its page', async () => {
    vi.mocked(tablesService.joinSeat).mockResolvedValue(makeTable(1, { N: 'bob', E: 'ana' }))
    const wrapper = mountWith([makeTable(1, { N: 'bob' })])

    await seatButton(wrapper, 1, 'E').trigger('click')
    await flushPromises()

    expect(tablesService.joinSeat).toHaveBeenCalledWith(1, 'E')
    expect(navigate).toHaveBeenCalledWith('/tables/1', 'forward', 'push')
    // The buttons stay disabled while the page changes.
    expect(isDisabled(seatButton(wrapper, 1, 'S'))).toBe(true)
  })

  test('the answer, not the list row, decides: a board goes to /play', async () => {
    vi.mocked(tablesService.joinSeat).mockResolvedValue(
      makeTable(1, { N: 'bob', E: 'carol', S: 'dan', W: 'ana' }, { board_id: 5 }),
    )
    const wrapper = mountWith([makeTable(1, { N: 'bob', E: 'carol', S: 'dan' })])

    await seatButton(wrapper, 1, 'W').trigger('click')
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/tables/1/play', 'forward', 'push')
  })

  test('a confirmed move goes to the new table', async () => {
    const from = makeTable(1, { N: 'ana', E: 'bob' })
    const to = makeTable(2, { N: 'carol', S: 'ana' })
    vi.mocked(confirmMove).mockResolvedValue(true)
    vi.mocked(tablesService.joinSeat).mockResolvedValue(to)
    vi.mocked(tablesService.listTables).mockResolvedValue([to, makeTable(1, { E: 'bob' })])
    const wrapper = mountWith([makeTable(2, { N: 'carol' }), from])

    await seatButton(wrapper, 2, 'S').trigger('click')
    await flushPromises()

    expect(confirmMove).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/tables/2', 'forward', 'push')
  })

  test('a cancelled move stays on the list', async () => {
    vi.mocked(confirmMove).mockResolvedValue(false)
    const wrapper = mountWith([makeTable(2, { N: 'carol' }), makeTable(1, { N: 'ana', E: 'bob' })])

    await seatButton(wrapper, 2, 'S').trigger('click')
    await flushPromises()

    expect(tablesService.joinSeat).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('a seat taken meanwhile toasts and stays on the list', async () => {
    vi.mocked(tablesService.joinSeat).mockRejectedValue(new Error('That seat is already taken.'))
    const wrapper = mountWith([makeTable(1, { N: 'bob' })])

    await seatButton(wrapper, 1, 'E').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith(expect.any(String), 'danger')
    expect(navigate).not.toHaveBeenCalled()
    // The seats are free to tap again.
    expect(isDisabled(seatButton(wrapper, 1, 'E'))).toBe(false)
  })
})
