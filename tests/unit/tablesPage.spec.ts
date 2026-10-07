import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { IonInput } from '@ionic/vue'
import { pickSegment } from './ionEvents'
import SetMinutesPicker from '@/components/SetMinutesPicker.vue'
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

// Seats are given as seat -> username; `robot-…` usernames are robots, a
// trailing `!` marks the player away.
function makeTable(id: number, seats: Partial<Record<Seat, string>>, extra: Partial<Table> = {}): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id,
    name: `Table ${id}`,
    created_by: 1,
    moderated_by: 1,
    board_id: null,
    unattended_since: null,
    set_minutes: 16,
    set: null,
    created_at: '2026-10-01T10:00:00.000000Z',
    updated_at: '2026-10-01T10:00:00.000000Z',
    seats: taken.map(([seat, label], i) => {
      const username = label.replace('!', '')
      const userId = username === 'ana' ? 1 : id * 10 + i + 100
      return {
        id: id * 10 + i,
        table_id: id,
        user_id: userId,
        seat,
        ready: false,
        away_since: label.endsWith('!') ? '2026-10-01T10:00:00.000000Z' : null,
        replace_at: null,
        user: {
          id: userId,
          name: username,
          username,
          description: null,
          is_robot: username.startsWith('robot-'),
          is_admin: username === 'eve',
        },
      }
    }),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: false,
    ...extra,
  }
}

// ion-segment scrolls its checked button into view; jsdom has no scrolling.
Element.prototype.scrollTo ??= () => {}

// onIonViewWillEnter never fires outside a router outlet, so the list is put
// in the store directly rather than loaded.
function mountWith(tables: Table[]) {
  const store = useTablesStore()
  store.tables = tables
  store.loaded = true
  return mount(TablesPage, { global: { stubs: { 'router-link': RouterLinkStub } } })
}

type Wrapper = ReturnType<typeof mountWith>

// The card of table `id`.
function card(wrapper: Wrapper, id: number) {
  return wrapper.findAll('.table-card').find((c) => c.get('.table-card-name').text() === `Table ${id}`)!
}

// The compass cell of `seat` in table `id`'s card.
function cell(wrapper: Wrapper, id: number, seat: Seat) {
  return card(wrapper, id).get(`.compass-${seat}`)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  useAuthStore().user = ana
})

describe('TablesPage.vue open tables', () => {
  test('each card: the name opening its page, the meta line, the pill and the compass', () => {
    const wrapper = mountWith([
      makeTable(1, { N: 'bob', E: 'robot-1', S: 'carl!' }),
      makeTable(2, { N: 'bob', E: 'carl', S: 'dan', W: 'eve' }, {
        board_id: 9,
        set_minutes: 8,
        set: { id: 3, number: 2, board: 2, of: 4, finished: false, ended: null, replaced: [], minutes: 8, time_left: { N: null, E: null, S: null, W: null } },
      }),
    ])

    const first = card(wrapper, 1)
    expect(first.getComponent(RouterLinkStub).props('to')).toBe('/tables/1')
    expect(first.get('.table-card-meta').text()).toBe('16 min · no set yet')
    expect(first.get('.table-card-pill').text()).toBe('1 seat free')
    expect(first.get('.table-card-pill').classes()).toContain('pill-wait')
    // Names in the compass: robots blue, away players red, empty seats to sit in.
    expect(cell(wrapper, 1, 'N').text()).toBe('bob')
    expect(cell(wrapper, 1, 'E').classes()).toContain('compass-robot')
    expect(cell(wrapper, 1, 'E').get('button').attributes('title')).toBe('East: robot-1 (robot)')
    expect(cell(wrapper, 1, 'S').text()).toBe('carl · away')
    expect(cell(wrapper, 1, 'S').classes()).toContain('compass-away')
    expect(cell(wrapper, 1, 'W').text()).toBe('Sit W')

    const second = card(wrapper, 2)
    expect(second.get('.table-card-meta').text()).toBe('8 min · set 2 · board 2/4')
    expect(second.get('.table-card-pill').text()).toBe('Playing')
    expect(cell(wrapper, 2, 'W').get('button').attributes('title')).toBe('West: eve (admin)')
  })

  test('only robots left: says so, and how long the table waits', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-01T10:08:00Z'))
    try {
      const wrapper = mountWith([
        makeTable(2, { E: 'robot-1', S: 'robot-2' }, { moderated_by: null, unattended_since: '2026-10-01T10:05:00Z' }),
      ])

      expect(card(wrapper, 2).get('.table-card-pill').text()).toBe('Robots only')
      expect(card(wrapper, 2).get('.table-card-meta').text()).toBe('left 3 min ago · closes in 7')
      expect(card(wrapper, 2).findAll('.compass-robot')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  test('filter chips count over the list and narrow it', async () => {
    const wrapper = mountWith([
      makeTable(1, { N: 'bob' }),
      makeTable(2, { N: 'bob', E: 'carl', S: 'dan', W: 'eve' }, { board_id: 9 }),
      makeTable(3, { E: 'robot-1' }, { unattended_since: '2026-10-01T10:05:00Z' }),
    ])

    const chips = () => wrapper.findAll('.filter-chip')
    expect(chips().map((c) => c.text())).toEqual(['All 3', 'Seat free 2', 'Playing 1', 'Robots only 1'])
    expect(chips()[0].attributes('aria-pressed')).toBe('true')

    await wrapper.get('[data-filter="playing"]').trigger('click')
    expect(wrapper.findAll('.table-card-name').map((n) => n.text())).toEqual(['Table 2'])
    expect(wrapper.get('[data-filter="playing"]').classes()).toContain('filter-on')

    await wrapper.get('[data-filter="free"]').trigger('click')
    expect(wrapper.findAll('.table-card-name').map((n) => n.text())).toEqual(['Table 1', 'Table 3'])

    await wrapper.get('[data-filter="robots"]').trigger('click')
    expect(wrapper.findAll('.table-card-name').map((n) => n.text())).toEqual(['Table 3'])
  })

  test('a chip with nothing in it says so', async () => {
    const wrapper = mountWith([makeTable(1, { N: 'bob' })])

    await wrapper.get('[data-filter="robots"]').trigger('click')

    expect(wrapper.find('.table-card').exists()).toBe(false)
    expect(wrapper.get('.empty').text()).toBe('No table matches.')
  })

  test('no tables at all', () => {
    const wrapper = mountWith([])

    expect(wrapper.get('.empty').text()).toBe('No tables yet. Create the first one.')
    expect(wrapper.findAll('.filter-chip').map((c) => c.text())[0]).toBe('All 0')
  })

  test('our own seat reads "You", and an empty seat at our table is a move', () => {
    const wrapper = mountWith([makeTable(1, { S: 'ana' })])

    expect(cell(wrapper, 1, 'S').text()).toBe('You')
    expect(cell(wrapper, 1, 'S').classes()).toContain('compass-me')
    expect(cell(wrapper, 1, 'N').get('.compass-sit').attributes('aria-label')).toBe('Move to North')
    expect(card(wrapper, 1).classes()).toContain('table-card-mine')
  })

  test('an unnamed table goes by its number', () => {
    const wrapper = mountWith([makeTable(4, { N: 'bob' }, { name: null })])

    expect(wrapper.get('.table-card-name').text()).toBe('Table #4')
  })
})

describe('TablesPage.vue starting a table', () => {
  test('"Deal me in" makes a table with robots and goes to it, where Start is', async () => {
    // Full, but nothing is dealt until the creator presses Start.
    const full = makeTable(3, { N: 'robot-1', E: 'robot-2', S: 'ana', W: 'robot-3' })
    vi.mocked(tablesService.createTable).mockResolvedValue(full)
    const wrapper = mountWith([])

    await wrapper.get('.deal-me-in').trigger('click')
    await flushPromises()

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: null, robots: true, set_minutes: 16 })
    expect(navigate).toHaveBeenCalledWith('/tables/3', 'forward', 'push')
    // The table page draws from this copy rather than fetching the table again.
    expect(useTablesStore().currentTable).toEqual(full)
    // Free again at once: nothing waits for the game page to be up.
    expect(wrapper.find('.deal-me-in ion-spinner').exists()).toBe(false)
  })

  test('the robots card offers 8, 12, 16 or 20 minutes for a set, 16 unless picked', async () => {
    vi.mocked(tablesService.createTable).mockResolvedValue(makeTable(3, { S: 'ana' }))
    const wrapper = mountWith([])

    expect(wrapper.findAll('ion-segment-button').map((b) => b.text())).toEqual(['8 min', '12 min', '16 min', '20 min'])
    expect(wrapper.get('.set-minutes-label').text()).toBe('Your time for a set of 4 boards')
    expect(wrapper.findComponent(SetMinutesPicker).props('modelValue')).toBe(16)

    await pickSegment(wrapper, '12')
    expect(wrapper.findComponent(SetMinutesPicker).props('modelValue')).toBe(12)
    await wrapper.get('.deal-me-in').trigger('click')
    await flushPromises()

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: null, robots: true, set_minutes: 12 })
    // The next table starts from the default again.
    expect(wrapper.findComponent(SetMinutesPicker).props('modelValue')).toBe(16)
  })

  test('"Create table" opens a named table for friends, the other three seats free', async () => {
    const created = makeTable(3, { S: 'ana' }, { name: 'Sunday pairs' })
    vi.mocked(tablesService.createTable).mockResolvedValue(created)
    const wrapper = mountWith([])

    wrapper.findComponent(IonInput).vm.$emit('update:modelValue', '  Sunday pairs ')
    await wrapper.get('form.start-friends').trigger('submit')
    await flushPromises()

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: 'Sunday pairs', robots: false })
    expect(navigate).toHaveBeenCalledWith('/tables/3', 'forward', 'push')
    expect(useTablesStore().tables.map((t) => t.id)).toEqual([3])
  })

  test('an empty name makes an unnamed table', async () => {
    vi.mocked(tablesService.createTable).mockResolvedValue(makeTable(3, { S: 'ana' }))
    const wrapper = mountWith([])

    await wrapper.get('form.start-friends').trigger('submit')
    await flushPromises()

    expect(tablesService.createTable).toHaveBeenCalledWith({ name: null, robots: false })
  })

  test('both cards wait while one is creating, its own button spinning', async () => {
    vi.mocked(tablesService.createTable).mockReturnValue(new Promise(() => {}))
    const wrapper = mountWith([])

    await wrapper.get('.deal-me-in').trigger('click')

    expect(wrapper.find('.deal-me-in ion-spinner').exists()).toBe(true)
    expect(wrapper.find('.create-table ion-spinner').exists()).toBe(false)
    expect(wrapper.getComponent('.create-table').props('disabled')).toBe(true)
    expect(wrapper.findComponent(SetMinutesPicker).props('disabled')).toBe(true)
  })

  test("a refusal stays on the card it came from, with the backend's reason", async () => {
    vi.mocked(tablesService.createTable).mockRejectedValue(new Error('You already have 3 active tables.'))
    const wrapper = mountWith([])

    await wrapper.get('form.start-friends').trigger('submit')
    await flushPromises()

    expect(wrapper.get('.start-friends .error').text()).toBe('Could not create the table. Please try again.')
    expect(wrapper.find('.start-robots .error').exists()).toBe(false)
    expect(navigate).not.toHaveBeenCalled()

    // The other card clears it when it tries.
    await wrapper.get('.deal-me-in').trigger('click')
    await flushPromises()
    expect(wrapper.find('.start-friends .error').exists()).toBe(false)
    expect(wrapper.get('.start-robots .error').text()).toBe('Could not create the table. Please try again.')
  })
})

describe('TablesPage.vue taking a seat', () => {
  // The Sit button of `seat` in the card of table `id`.
  function seatButton(wrapper: Wrapper, id: number, seat: Seat) {
    return cell(wrapper, id, seat).get('.compass-sit')
  }

  function isDisabled(button: ReturnType<typeof seatButton>) {
    return (button.element as HTMLButtonElement).disabled
  }

  test('a table still waiting for players opens its page', async () => {
    vi.mocked(tablesService.joinSeat).mockResolvedValue(makeTable(1, { N: 'bob', E: 'ana' }))
    const wrapper = mountWith([makeTable(1, { N: 'bob' })])

    await seatButton(wrapper, 1, 'E').trigger('click')
    await flushPromises()

    expect(tablesService.joinSeat).toHaveBeenCalledWith(1, 'E')
    expect(navigate).toHaveBeenCalledWith('/tables/1', 'forward', 'push')
    // The buttons stay disabled while the page changes, the seat taken spinning.
    expect(isDisabled(seatButton(wrapper, 1, 'S'))).toBe(true)
  })

  test('the seat being taken spins', async () => {
    vi.mocked(tablesService.joinSeat).mockReturnValue(new Promise(() => {}))
    const wrapper = mountWith([makeTable(1, { N: 'bob' })])

    await seatButton(wrapper, 1, 'E').trigger('click')

    expect(seatButton(wrapper, 1, 'E').find('ion-spinner').exists()).toBe(true)
    expect(seatButton(wrapper, 1, 'S').find('ion-spinner').exists()).toBe(false)
  })

  test('the answer, not the card, decides: a board goes to /play', async () => {
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

// Leaving the table's pages keeps the seat; the lobby's Your table says where
// we sit and offers the same Leave as the table's pages (#121).
describe('TablesPage.vue your table', () => {
  afterEach(() => vi.restoreAllMocks())

  const mine = () => makeTable(1, { S: 'ana', N: 'robot-1', E: 'robot-2', W: 'robot-3' }, { board_id: 18 })

  async function leave(wrapper: Wrapper) {
    await wrapper.get('.seated-leave').trigger('click')
    await flushPromises()
  }

  test('the hero: where you sit, back to the table, and Leave, only while you sit somewhere', () => {
    const seated = mountWith([mine()])

    const hero = seated.get('.your-table')
    expect(hero.get('.your-table-name').text()).toBe('Table 1')
    expect(hero.get('.your-table-line').text()).toBe('No set yet · you sit South with robot-1')
    expect(seated.getComponent('.your-table-go').props('routerLink')).toBe('/tables/1/play')
    expect(seated.get('.your-table-go').text()).toBe('Back to the table')
    expect(seated.get('.seated-leave').text()).toBe('Leave')

    setActivePinia(createPinia())
    useAuthStore().user = ana
    const free = mountWith([makeTable(2, { N: 'bob' })])
    expect(free.find('.your-table').exists()).toBe(false)
  })

  test('a held seat comes back to the game, without Leave', async () => {
    const wrapper = mountWith([mine()])
    useTablesStore().heldTableId = 1
    await flushPromises()

    expect(wrapper.find('.seated-leave').exists()).toBe(false)
    expect(wrapper.get('.your-table-go').text()).toBe('Come back')
    expect(wrapper.getComponent('.your-table-go').props('routerLink')).toBe('/tables/1/play')
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
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Your seat is kept for 2 minutes'), 'warning')
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
