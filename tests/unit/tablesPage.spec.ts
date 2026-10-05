import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { IonToggle } from '@ionic/vue'
import TablesPage from '@/views/TablesPage.vue'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'
import * as tablesService from '@/services/tables'
import { confirmLeave, confirmMove } from '@/utils/seatMove'
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
  confirmLeave: vi.fn(),
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

function axiosError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message: 'Unauthenticated.' }, statusText: '', headers: {}, config }
  return error
}

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
        is_admin: username === 'eve',
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
  return mount(TablesPage, {
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub, 'router-link': RouterLinkStub } },
  })
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

  test('marks an admin in the list', () => {
    const wrapper = mountWith([makeTable(3, { N: 'eve', E: 'bob' })])

    const row = wrapper.findAll('ion-list ion-item').find((r) => r.text().includes('Table 3'))!
    expect(row.findAll('.admin-badge')).toHaveLength(1)
  })

  test('creating with robots (the default) goes to the table, where Start is', async () => {
    // Full, but nothing is dealt until the creator presses Start.
    const full = makeTable(3, { N: 'robot-1', E: 'robot-2', S: 'ana', W: 'robot-3' })
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

  test('creating without robots goes to the table too, the other three seats free', async () => {
    const created = makeTable(3, { S: 'ana' })
    vi.mocked(tablesService.createTable).mockResolvedValue(created)
    const wrapper = mountWith([])

    wrapper.findComponent(IonToggle).vm.$emit('update:modelValue', false)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: null, robots: false })
    expect(navigate).toHaveBeenCalledWith('/tables/3', 'forward', 'push')
    expect(useTablesStore().currentTable).toEqual(created)
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

// Leaving the table's pages keeps the seat; the list says where we sit and
// offers the same Leave as the table's pages (#121).
describe('TablesPage.vue leaving your table', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    useAuthStore().user = ana
  })

  afterEach(() => vi.restoreAllMocks())

  const mine = () => makeTable(1, { S: 'ana', N: 'robot-1', E: 'robot-2', W: 'robot-3' }, { board_id: 18 })

  async function leave(wrapper: ReturnType<typeof mountWith>) {
    await wrapper.get('.seated-leave').trigger('click')
    await flushPromises()
  }

  test('says where you sit, with Leave, only while you sit somewhere', () => {
    const seated = mountWith([mine()])
    const free = mountWith([makeTable(2, { N: 'bob' })])

    expect(seated.get('.seated-at').text()).toContain('You sit at')
    expect(seated.get('.seated-at').text()).toContain('Table 1')
    expect(seated.getComponent(RouterLinkStub).props('to')).toBe('/tables/1')
    expect(seated.get('.seated-leave').text()).toBe('Leave')
    expect(free.find('.seated-at').exists()).toBe(false)
  })

  test('a held seat has Come back instead', async () => {
    const wrapper = mountWith([mine()])
    useTablesStore().heldTableId = 1
    await flushPromises()

    expect(wrapper.find('.seated-at').exists()).toBe(false)
    expect(wrapper.get('.held').text()).toContain('Come back to Table 1')
  })

  test.each([
    [{ tableDeleted: false, held: false }, 'You left the table.', 'success'],
    [{ tableDeleted: true, held: false }, 'You left the table. Nobody was left, so it was deleted.', 'success'],
  ])('Leave asks first, then frees the seat (%o)', async (answer, message, color) => {
    const wrapper = mountWith([mine()])
    const store = useTablesStore()
    const left = vi.spyOn(store, 'leave').mockResolvedValue(answer)
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await leave(wrapper)

    expect(confirmLeave).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 1, null, null, null)
    expect(left).toHaveBeenCalledWith(1)
    expect(showToast).toHaveBeenCalledWith(message, color)
  })

  test('mid-set the seat is held, and the board this table had is dropped', async () => {
    const wrapper = mountWith([mine()])
    const game = useGameStore()
    game.tableId = 1
    game.playing = { phase: 'play', board: { id: 18, number: 2 } } as unknown as typeof game.playing
    const clear = vi.spyOn(game, 'clear')
    vi.spyOn(useTablesStore(), 'leave').mockResolvedValue({ tableDeleted: false, held: true })
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await leave(wrapper)

    expect(confirmLeave).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 1, 'play', 2, null)
    expect(clear).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Your seat is held'), 'warning')
  })

  test('nothing is sent when the user cancels', async () => {
    const wrapper = mountWith([mine()])
    const left = vi.spyOn(useTablesStore(), 'leave')
    vi.mocked(confirmLeave).mockResolvedValue(false)

    await leave(wrapper)

    expect(left).not.toHaveBeenCalled()
  })

  test('a failure is told, logged and the list read again', async () => {
    const wrapper = mountWith([mine()])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(confirmLeave).mockRejectedValue(new TypeError('no overlay'))
    vi.mocked(tablesService.listTables).mockResolvedValue([mine()])

    await leave(wrapper)

    expect(showToast).toHaveBeenCalledWith('Could not leave the table. Please try again.', 'danger')
    expect(logged).toHaveBeenCalledWith(expect.any(TypeError))
    expect(tablesService.listTables).toHaveBeenCalled()
  })

  test('an expired session goes to log in', async () => {
    const wrapper = mountWith([mine()])
    vi.spyOn(useTablesStore(), 'leave').mockRejectedValue(axiosError(401))
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await leave(wrapper)

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
    expect(showToast).not.toHaveBeenCalled()
  })
})
