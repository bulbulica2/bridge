import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { IonButton, IonRefresher, alertController } from '@ionic/vue'
import { pickSegment, pullToRefresh, tapSegment } from './ionEvents'
import TableDetailPage from '@/views/TableDetailPage.vue'
import SetMinutesPicker from '@/components/SetMinutesPicker.vue'
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue'
import SeatPlayerSheet from '@/components/SeatPlayerSheet.vue'
import * as tablesService from '@/services/tables'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'
import { OFFLINE_GRACE_MS } from '@/composables/useLiveStatus'
import { resetLiveStatus, setConnection, setSubscribed } from '@/services/liveStatus'
import { confirmLeave, confirmMove } from '@/utils/seatMove'
import { showToast } from '@/utils/toast'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
  listTables: vi.fn(),
  sendHeartbeat: vi.fn(),
}))
// Anything not stubbed below (reading a board's phase, say) never leaves the test.
vi.mock('@/services/http', () => ({
  default: {
    get: vi.fn(() => Promise.reject(new Error('no backend in unit tests'))),
    post: vi.fn(() => Promise.reject(new Error('no backend in unit tests'))),
    delete: vi.fn(() => Promise.reject(new Error('no backend in unit tests'))),
  },
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
vi.mock('@/utils/seatMove', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/seatMove')>()),
  confirmMove: vi.fn(),
  confirmLeave: vi.fn(),
}))
const { navigate, route, dismissedWith } = vi.hoisted(() => ({
  navigate: vi.fn(),
  route: { params: { id: '5' } as Record<string, string>, path: '/tables/5' },
  dismissedWith: { role: 'destructive' as string | undefined },
}))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => route,
}))
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
    alertController: {
      create: vi.fn(async () => ({
        present: vi.fn(),
        onDidDismiss: async () => ({ role: dismissedWith.role }),
      })),
    },
  }
})

// ion-segment scrolls its checked button into view; jsdom has no scrolling.
Element.prototype.scrollTo ??= () => {}

function axiosError(status: number, message = 'Conflict'): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message }, statusText: '', headers: {}, config }
  return error
}

// The user is ana (id 1). Seats are seat -> username; `robot-…` are robots.
// eve is an admin.
const IDS: Record<string, number> = { ana: 1, bob: 2, cy: 3, eve: 7, 'robot-1': 101, 'robot-2': 102, 'robot-3': 103 }

function makeTable(seats: Partial<Record<Seat, string>>, extra: Partial<Table> = {}): Table {
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
      user_id: IDS[username],
      seat,
      ready: username.startsWith('robot-'),
      user: {
        id: IDS[username],
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

const otherTable = { ...makeTable({ N: 'ana' }), id: 9, name: 'Late night' }

async function mountPage(table: Table | Error) {
  if (table instanceof Error) {
    vi.mocked(tablesService.getTable).mockRejectedValue(table)
  } else {
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
  }
  const wrapper = mount(TableDetailPage, {
    global: { stubs: { 'router-link': true, PlayerProfileSheet: true, SeatPlayerSheet: true } },
  })
  await flushPromises()
  return wrapper
}

function seatButton(wrapper: VueWrapper, seat: Seat, label: string) {
  return wrapper
    .find(`.seat-${seat.toLowerCase()}`)
    .findAllComponents(IonButton)
    .find((b) => b.text() === label)
}

async function click(wrapper: VueWrapper, seat: Seat, label: string) {
  await seatButton(wrapper, seat, label)!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  route.params = { id: '5' }
  dismissedWith.role = 'destructive'
  useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
})

afterEach(() => {
  useTablesStore().unwatchTable()
})

describe('TableDetailPage loading', () => {
  test("on somebody else's table it finds where the user sits, for the header", async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([otherTable])
    const wrapper = await mountPage(makeTable({ N: 'bob' }))

    expect(tablesService.listTables).toHaveBeenCalledTimes(1)
    expect(useTablesStore().myTable?.id).toBe(9)
    expect(wrapper.find('.table-shortcut').text()).toContain('Late night')
  })

  test("on the user's own table it asks nothing more", async () => {
    await mountPage(makeTable({ S: 'ana', N: 'bob' }))

    expect(tablesService.listTables).not.toHaveBeenCalled()
  })

  test('a nonsense id is a dead table without asking the backend', async () => {
    route.params = { id: 'zero' }
    const wrapper = await mountPage(makeTable({}))

    expect(tablesService.getTable).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('This table no longer exists.')
  })

  test('a 404 is a table that no longer exists', async () => {
    const wrapper = await mountPage(axiosError(404))

    expect(wrapper.text()).toContain('This table no longer exists.')
  })

  test('a 401 sends the user to log in', async () => {
    await mountPage(axiosError(401))

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })

  test('another failure shows an error', async () => {
    const wrapper = await mountPage(new Error('offline'))

    expect(wrapper.find('.error').text()).toBe('Could not load the table. Please try again.')
  })

  test('shows the table, its manager and an unattended note', async () => {
    const wrapper = await mountPage(
      makeTable({ N: 'robot-1' }, { moderated_by: null, unattended_since: '2026-10-03T10:00:00Z' }),
    )

    expect(wrapper.find('.table-title').text()).toBe('Club')
    expect(wrapper.find('.table-manager').exists()).toBe(false)
    expect(wrapper.find('.unattended').exists()).toBe(true)
  })

  test('pull to refresh reloads the table and completes the refresher', async () => {
    const wrapper = await mountPage(makeTable({ N: 'bob' }))
    const complete = vi.fn()

    await pullToRefresh(wrapper, complete)
    await flushPromises()

    expect(tablesService.getTable).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalled()
  })

  test('tapping a player opens their profile sheet, closing it clears it', async () => {
    const wrapper = await mountPage(makeTable({ N: 'bob' }))

    await wrapper.find('.seat-n .seat-user').trigger('click')
    expect(wrapper.findComponent(PlayerProfileSheet).props('player')).toMatchObject({ username: 'bob' })

    wrapper.findComponent(PlayerProfileSheet).vm.$emit('close')
    await flushPromises()
    expect(wrapper.findComponent(PlayerProfileSheet).props('player')).toBeNull()
  })

  test('a kick sends the user back to the list', async () => {
    await mountPage(makeTable({ N: 'ana', E: 'bob' }))

    useTablesStore().kickedFrom = 5
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })
  test('replaced by a robot: off to the set we were taken out of', async () => {
    await mountPage(makeTable({ N: 'ana', E: 'bob' }))
    const store = useTablesStore()

    store.replacedFrom = { id: 9, number: 2, seat: 'E', reason: 'kicked', tableId: 5 }
    store.kickedFrom = 5
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/sets/9', 'back', 'replace')
  })
})

describe('TableDetailPage away seats', () => {
  test("each away seat's tag counts down; an admin's is a plain away, one line says what for", async () => {
    const at = (s: number) => new Date(Date.now() + s * 1000).toISOString()
    const table = makeTable({ N: 'ana', E: 'bob', S: 'cy', W: 'eve' }, { board_id: 7 })
    table.seats = table.seats.map((s) =>
      s.seat === 'E' || s.seat === 'S'
        ? { ...s, away_since: at(-30), replace_at: at(90) }
        : s.seat === 'W'
          ? { ...s, away_since: at(-30), replace_at: null }
          : s,
    )
    const wrapper = await mountPage(table)

    expect(wrapper.get('.seat-e .seat-away').text()).toBe('away · 1:30')
    expect(wrapper.get('.seat-s .seat-away').text()).toBe('away · 1:30')
    expect(wrapper.get('.seat-w .seat-away').text()).toBe('away')
    expect(wrapper.find('.seat-n .seat-away').exists()).toBe(false)
    expect(wrapper.findAll('.away-line').map((l) => l.text())).toEqual([
      'Away players are replaced by a robot when their clock runs out.',
    ])
  })
})

describe('TableDetailPage sitting down', () => {
  test('takes a free seat', async () => {
    const wrapper = await mountPage(makeTable({ N: 'bob' }))
    const store = useTablesStore()
    vi.spyOn(store, 'seatedTable').mockResolvedValue(null)
    const join = vi.spyOn(store, 'join').mockResolvedValue(makeTable({ N: 'bob', E: 'ana' }))

    await click(wrapper, 'E', 'Sit here · East')

    expect(join).toHaveBeenCalledWith(5, 'E')
    expect(confirmMove).not.toHaveBeenCalled()
  })

  test('asks before moving off another table, and stays on a no', async () => {
    const wrapper = await mountPage(makeTable({ N: 'bob' }))
    const store = useTablesStore()
    vi.spyOn(store, 'seatedTable').mockResolvedValue(otherTable)
    const join = vi.spyOn(store, 'join')
    vi.mocked(confirmMove).mockResolvedValue(false)

    await click(wrapper, 'E', 'Sit here · East')

    expect(confirmMove).toHaveBeenCalled()
    expect(join).not.toHaveBeenCalled()
  })

  test('a seat taken meanwhile toasts the reason and reloads', async () => {
    const wrapper = await mountPage(makeTable({ N: 'bob' }))
    const store = useTablesStore()
    vi.spyOn(store, 'seatedTable').mockResolvedValue(null)
    vi.spyOn(store, 'join').mockRejectedValue(axiosError(409, 'That seat is taken.'))

    await click(wrapper, 'E', 'Sit here · East')

    expect(showToast).toHaveBeenCalledWith('That seat is taken.', 'danger')
    expect(tablesService.getTable).toHaveBeenCalledTimes(2)
  })
})

describe('TableDetailPage leaving', () => {
  test('nothing happens when the user cancels', async () => {
    const wrapper = await mountPage(makeTable({ N: 'ana', E: 'bob' }))
    const leave = vi.spyOn(useTablesStore(), 'leave')
    vi.mocked(confirmLeave).mockResolvedValue(false)

    await click(wrapper, 'N', 'Leave')

    expect(leave).not.toHaveBeenCalled()
  })

  test('the last player out deletes the table and goes back to the list', async () => {
    const wrapper = await mountPage(makeTable({ N: 'ana' }))
    vi.spyOn(useTablesStore(), 'leave').mockResolvedValue({ tableDeleted: true, held: false })
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await click(wrapper, 'N', 'Leave')

    expect(showToast).toHaveBeenCalledWith('You left the table. Nobody was left, so it was deleted.', 'success')
    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })

  test('mid-set the seat is held: warn and go to the list', async () => {
    const wrapper = await mountPage(makeTable({ N: 'ana', E: 'bob' }))
    vi.spyOn(useTablesStore(), 'leave').mockResolvedValue({ tableDeleted: false, held: true })
    const clear = vi.spyOn(useGameStore(), 'clear')
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await click(wrapper, 'N', 'Leave')

    expect(clear).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Your seat is kept for 2 minutes'), 'warning')
    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })

  test('a failed leave toasts the reason, logs it and reloads', async () => {
    const wrapper = await mountPage(makeTable({ N: 'ana', E: 'bob' }))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(useTablesStore(), 'leave').mockRejectedValue(new Error('offline'))
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await click(wrapper, 'N', 'Leave')

    expect(showToast).toHaveBeenCalledWith('Could not leave the table. Please try again.', 'danger')
    expect(logged).toHaveBeenCalledWith(new Error('offline'))
    expect(tablesService.getTable).toHaveBeenCalledTimes(2)
    logged.mockRestore()
  })

  test('with others staying, the page says the seat was left', async () => {
    const wrapper = await mountPage(makeTable({ N: 'ana', E: 'bob' }))
    vi.spyOn(useTablesStore(), 'leave').mockResolvedValue({ tableDeleted: false, held: false })
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await click(wrapper, 'N', 'Leave')

    expect(showToast).toHaveBeenCalledWith('You left the table.', 'success')
    expect(navigate).not.toHaveBeenCalled()
  })

  test('a held seat offers Come back instead of Leave', async () => {
    const table = makeTable({ N: 'ana', E: 'bob' })
    const store = useTablesStore()
    const wrapper = await mountPage(table)
    store.heldTableId = 5
    await flushPromises()
    const comeBack = vi.spyOn(store, 'comeBack').mockResolvedValue()

    expect(seatButton(wrapper, 'N', 'Leave')).toBeUndefined()
    const button = wrapper.find('.held').findComponent(IonButton)
    expect(button.text()).toBe('Come back')
    await button.trigger('click')
    await flushPromises()

    expect(comeBack).toHaveBeenCalledWith(5)
  })
})

describe('TableDetailPage manager controls', () => {
  const managed = (seats: Partial<Record<Seat, string>>, extra: Partial<Table> = {}) =>
    makeTable(seats, { can_manage: true, ...extra })

  test('removes a robot after confirming', async () => {
    const wrapper = await mountPage(managed({ N: 'ana', E: 'robot-1' }))
    const remove = vi.spyOn(useTablesStore(), 'removePlayer').mockResolvedValue({ tableDeleted: false })

    await click(wrapper, 'E', 'Remove')

    expect(alertController.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'The robot leaves seat E, which becomes free.' }),
    )
    expect(remove).toHaveBeenCalledWith(5, 101)
    expect(showToast).toHaveBeenCalledWith('robot-1 was removed from the table.', 'success')
  })

  test('removing a player mid-set says the set ends', async () => {
    const set = { id: 4, number: 2, board: 1, of: 4, finished: false, ended: null, replaced: [] }
    const wrapper = await mountPage(managed({ N: 'ana', E: 'bob' }, { board_id: 8, set }))
    vi.spyOn(useTablesStore(), 'removePlayer').mockResolvedValue({ tableDeleted: false })

    await click(wrapper, 'E', 'Remove')

    expect(alertController.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'bob loses seat E. They can sit down again afterwards. Set 2 ends with no winner.',
      }),
    )
  })

  test("an admin's seat is badged and has no Remove for the moderator", async () => {
    const wrapper = await mountPage(managed({ N: 'ana', E: 'eve', S: 'bob' }))

    expect(wrapper.find('.seat-e .admin-badge').exists()).toBe(true)
    expect(wrapper.find('.seat-s .admin-badge').exists()).toBe(false)
    expect(seatButton(wrapper, 'E', 'Remove')).toBeUndefined()
    expect(seatButton(wrapper, 'S', 'Remove')).toBeDefined()
  })

  test("another admin may remove an admin's seat", async () => {
    useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com', is_admin: true }
    const wrapper = await mountPage(managed({ N: 'ana', E: 'eve' }))
    const remove = vi.spyOn(useTablesStore(), 'removePlayer').mockResolvedValue({ tableDeleted: false })

    await click(wrapper, 'E', 'Remove')

    expect(remove).toHaveBeenCalledWith(5, 7)
    expect(showToast).toHaveBeenCalledWith('eve was removed from the table.', 'success')
  })

  test('a manager has no Remove on their own seat, only Leave', async () => {
    const wrapper = await mountPage(managed({ N: 'ana', E: 'bob' }))

    expect(seatButton(wrapper, 'N', 'Remove')).toBeUndefined()
    expect(seatButton(wrapper, 'N', 'Leave')).toBeDefined()
  })

  test('cancelling the removal sends nothing', async () => {
    dismissedWith.role = 'cancel'
    const wrapper = await mountPage(managed({ N: 'ana', E: 'bob' }))
    const remove = vi.spyOn(useTablesStore(), 'removePlayer')

    await click(wrapper, 'E', 'Remove')

    expect(remove).not.toHaveBeenCalled()
  })

  test('removing the last robot of an unattended table deletes it', async () => {
    const wrapper = await mountPage(
      makeTable({ E: 'robot-1' }, { moderated_by: null, unattended_since: '2026-10-03T10:00:00Z' }),
    )
    vi.spyOn(useTablesStore(), 'removePlayer').mockResolvedValue({ tableDeleted: true })

    await click(wrapper, 'E', 'Remove')

    expect(showToast).toHaveBeenCalledWith('robot-1 was removed and the table was deleted.', 'success')
    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })

  test('a refused removal toasts the reason and reloads', async () => {
    const wrapper = await mountPage(managed({ N: 'ana', E: 'bob' }))
    vi.spyOn(useTablesStore(), 'removePlayer').mockRejectedValue(axiosError(403, 'This action is unauthorized.'))

    await click(wrapper, 'E', 'Remove')

    expect(showToast).toHaveBeenCalledWith('This action is unauthorized.', 'danger')
    expect(tablesService.getTable).toHaveBeenCalledTimes(2)
  })

  test('adds a robot, and toasts a refusal', async () => {
    const wrapper = await mountPage(managed({ N: 'ana' }))
    const store = useTablesStore()
    const seatRobot = vi.spyOn(store, 'seatRobot').mockResolvedValue(managed({ N: 'ana', E: 'robot-1' }))

    await click(wrapper, 'E', 'Add robot')
    expect(seatRobot).toHaveBeenCalledWith(5, 'E')
    expect(showToast).toHaveBeenCalledWith('A robot now sits at E.', 'success')

    seatRobot.mockRejectedValue(new Error('offline'))
    await click(wrapper, 'W', 'Add robot')
    expect(showToast).toHaveBeenCalledWith('Could not add a robot. Please try again.', 'danger')
  })

  test('seats the player picked in the sheet', async () => {
    const wrapper = await mountPage(managed({ N: 'ana' }))
    const seatUser = vi.spyOn(useTablesStore(), 'seatUser').mockResolvedValue(managed({ N: 'ana', E: 'bob' }))

    await click(wrapper, 'E', 'Seat a player')
    const sheet = wrapper.findComponent(SeatPlayerSheet)
    expect(sheet.props('seat')).toBe('E')
    sheet.vm.$emit('select', { id: 2, username: 'bob' })
    await flushPromises()

    expect(seatUser).toHaveBeenCalledWith(5, 2, 'E')
    expect(showToast).toHaveBeenCalledWith('bob now sits at E.', 'success')
    expect(sheet.props('seat')).toBeNull()
  })

  test('picking yourself in the sheet is a plain join', async () => {
    const wrapper = await mountPage(managed({ N: 'bob' }))
    const store = useTablesStore()
    vi.spyOn(store, 'seatedTable').mockResolvedValue(null)
    const join = vi.spyOn(store, 'join').mockResolvedValue(managed({ N: 'bob', E: 'ana' }))
    const seatUser = vi.spyOn(store, 'seatUser')

    await click(wrapper, 'E', 'Seat a player')
    wrapper.findComponent(SeatPlayerSheet).vm.$emit('select', { id: 1, username: 'ana' })
    await flushPromises()

    expect(join).toHaveBeenCalledWith(5, 'E')
    expect(seatUser).not.toHaveBeenCalled()
  })

  test('a refused seating toasts the reason, closing the sheet sends nothing', async () => {
    const wrapper = await mountPage(managed({ N: 'ana' }))
    const seatUser = vi.spyOn(useTablesStore(), 'seatUser').mockRejectedValue(axiosError(409, 'Bob already sits at a table.'))
    const sheet = wrapper.findComponent(SeatPlayerSheet)

    await click(wrapper, 'E', 'Seat a player')
    sheet.vm.$emit('close')
    await flushPromises()
    expect(sheet.props('seat')).toBeNull()

    await click(wrapper, 'E', 'Seat a player')
    sheet.vm.$emit('select', { id: 2, username: 'bob' })
    await flushPromises()
    expect(seatUser).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Bob already sits at a table.', 'danger')
  })

  test("shows the time for a set, which a manager changes between sets", async () => {
    const wrapper = await mountPage(managed({ N: 'ana' }, { set_minutes: 16 }))
    const updateSettings = vi
      .spyOn(useTablesStore(), 'updateSettings')
      .mockResolvedValue(managed({ N: 'ana' }, { set_minutes: 8 }))
    const picker = wrapper.findComponent(SetMinutesPicker)
    expect(picker.props('modelValue')).toBe(16)

    tapSegment(picker, '8')
    await wrapper.vm.$nextTick()
    expect(picker.props('disabled')).toBe(true)
    await flushPromises()

    expect(updateSettings).toHaveBeenCalledWith(5, { set_minutes: 8 })
    expect(showToast).toHaveBeenCalledWith('Each player now has 8 minutes for a set.', 'success')
    expect(wrapper.findComponent(SetMinutesPicker).props('disabled')).toBe(false)
  })

  test('a change refused mid-set toasts the reason and reads the table again', async () => {
    const wrapper = await mountPage(managed({ N: 'ana' }, { set_minutes: 16 }))
    vi.spyOn(useTablesStore(), 'updateSettings').mockRejectedValue(
      axiosError(409, 'A set is going on at this table: change its settings once it is over.'),
    )

    await pickSegment(wrapper, '20')

    expect(showToast).toHaveBeenCalledWith(
      'A set is going on at this table: change its settings once it is over.',
      'danger',
    )
    expect(tablesService.getTable).toHaveBeenCalledTimes(2)
    // Back on the table's own value.
    expect(wrapper.findComponent(SetMinutesPicker).props('modelValue')).toBe(16)
  })

  test('mid-set a manager only reads it, and when it may change', async () => {
    const set = { id: 8, number: 2, board: 2, of: 4, finished: false, ended: null, replaced: [] }
    const wrapper = await mountPage(managed({ N: 'ana' }, { set_minutes: 12, board_id: 30, set }))

    expect(wrapper.findComponent(SetMinutesPicker).exists()).toBe(false)
    expect(wrapper.get('.set-clock-text').text()).toBe('12 minutes each for a set of 4 boards')
    expect(wrapper.get('.set-clock-note').text()).toBe('You can change it once this set is over.')
  })

  test('anyone else reads it, the default for a table that never said', async () => {
    const wrapper = await mountPage(makeTable({ N: 'bob', E: 'ana' }))

    expect(wrapper.findComponent(SetMinutesPicker).exists()).toBe(false)
    expect(wrapper.get('.set-clock-text').text()).toBe('16 minutes each for a set of 4 boards')
    expect(wrapper.find('.set-clock-note').exists()).toBe(false)
  })

  test('an expired session on a manager action goes to log in', async () => {
    const wrapper = await mountPage(managed({ N: 'ana' }))
    vi.spyOn(useTablesStore(), 'seatRobot').mockRejectedValue(axiosError(401))
    vi.spyOn(useTablesStore(), 'updateSettings').mockRejectedValue(axiosError(401))

    await click(wrapper, 'E', 'Add robot')
    wrapper.findComponent(SetMinutesPicker).vm.$emit('update:modelValue', 8)
    await flushPromises()

    expect(navigate).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
    expect(showToast).not.toHaveBeenCalled()
  })
})

// Refresh shows only once live updates have been off for a few seconds (#76).
// #121: a set of four boards with robots played to the end. The table's copy
// of the set may still say it runs (a board finishing sends no
// TableUpdated); the finished last board the game store holds knows better.
describe('TableDetailPage after a set', () => {
  const running = { id: 8, number: 8, board: 4, of: 4, finished: false, ended: null, replaced: [] }

  // ana (the user) at S manages it, with robots in the other three seats.
  const robotTable = () =>
    makeTable(
      { N: 'robot-1', E: 'robot-2', S: 'ana', W: 'robot-3' },
      { can_manage: true, board_id: 18, set: running },
    )

  beforeEach(() => {
    const game = useGameStore()
    game.tableId = 5
    game.playing = {
      phase: 'finished',
      playing_id: 18,
      set: { ...running, finished: true, ended: 'completed' },
      board: { id: 18, number: 4, dealer: 'W', vulnerable: '' },
      next_board_at: null,
    } as unknown as typeof game.playing
  })

  afterEach(() => vi.restoreAllMocks())

  test('Leave speaks of no set, asks plainly and frees the seat', async () => {
    const wrapper = await mountPage(robotTable())
    const leave = vi.spyOn(useTablesStore(), 'leave').mockResolvedValue({ tableDeleted: false, held: false })
    vi.mocked(confirmLeave).mockResolvedValue(true)

    expect(wrapper.find('.between-boards').text()).toBe(
      'Board 4 is over, so leaving abandons nothing: its score is kept.',
    )
    expect(wrapper.find('.table-set').exists()).toBe(false)
    await click(wrapper, 'S', 'Leave')

    expect(confirmLeave).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), 1, 'finished', 4, null)
    expect(leave).toHaveBeenCalledWith(5)
    expect(showToast).toHaveBeenCalledWith('You left the table.', 'success')
  })

  test.each([
    ['N', 'robot-1', 101],
    ['E', 'robot-2', 102],
    ['W', 'robot-3', 103],
  ] as [Seat, string, number][])('Remove takes %s (%s) out', async (seat, username, id) => {
    const wrapper = await mountPage(robotTable())
    const remove = vi.spyOn(useTablesStore(), 'removePlayer').mockResolvedValue({ tableDeleted: false })

    await click(wrapper, seat, 'Remove')

    expect(alertController.create).toHaveBeenCalledWith(
      expect.objectContaining({
        header: `Remove ${username}?`,
        message: `The robot leaves seat ${seat}, which becomes free.`,
      }),
    )
    expect(remove).toHaveBeenCalledWith(5, id)
    expect(showToast).toHaveBeenCalledWith(`${username} was removed from the table.`, 'success')
  })

  test('the profile and seat sheets close before the confirmation', async () => {
    const wrapper = await mountPage(robotTable())
    await wrapper.find('.seat-n .seat-user').trigger('click')
    expect(wrapper.findComponent(PlayerProfileSheet).props('player')).not.toBeNull()
    let shownWhenAsked: unknown = 'not asked'
    vi.mocked(confirmLeave).mockImplementation(async () => {
      shownWhenAsked = wrapper.findComponent(PlayerProfileSheet).props('player')
      return false
    })

    await click(wrapper, 'S', 'Leave')

    expect(shownWhenAsked).toBeNull()
  })

  test('a Leave confirmation that fails is told and logged, never silent', async () => {
    const wrapper = await mountPage(robotTable())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const leave = vi.spyOn(useTablesStore(), 'leave')
    vi.mocked(confirmLeave).mockRejectedValue(new TypeError('no overlay'))

    await click(wrapper, 'S', 'Leave')

    expect(leave).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Could not leave the table. Please try again.', 'danger')
    expect(logged).toHaveBeenCalledWith(expect.any(TypeError))
    expect(seatButton(wrapper, 'S', 'Leave')!.props('disabled')).toBe(false)
  })

  test('a Remove confirmation that fails is told and logged, never silent', async () => {
    const wrapper = await mountPage(robotTable())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const remove = vi.spyOn(useTablesStore(), 'removePlayer')
    vi.mocked(alertController.create).mockRejectedValueOnce(new TypeError('no overlay'))

    await click(wrapper, 'N', 'Remove')

    expect(remove).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Could not remove that player. Please try again.', 'danger')
    expect(logged).toHaveBeenCalledWith(expect.any(TypeError))
  })
})

describe('TableDetailPage live updates', () => {
  beforeEach(() => {
    resetLiveStatus()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldClearNativeTimers: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    resetLiveStatus()
  })

  test('while live there is no Refresh button, only pull to refresh', async () => {
    setConnection('connected')
    setSubscribed(5)
    const wrapper = await mountPage(makeTable({ N: 'ana' }))

    vi.advanceTimersByTime(OFFLINE_GRACE_MS)
    await flushPromises()

    expect(wrapper.find('.offline-refresh').exists()).toBe(false)
    expect(wrapper.findComponent(IonRefresher).exists()).toBe(true)
  })

  test('a few seconds without live updates bring the note and Refresh, which reloads', async () => {
    setConnection('connected')
    const wrapper = await mountPage(makeTable({ N: 'ana' }))
    expect(wrapper.find('.offline-refresh').exists()).toBe(false)

    vi.advanceTimersByTime(OFFLINE_GRACE_MS)
    await flushPromises()
    expect(wrapper.find('.offline-note').text()).toBe('Live updates are off. Refresh to see the latest.')

    await wrapper.get('ion-button.refresh').trigger('click')
    await flushPromises()
    expect(tablesService.getTable).toHaveBeenCalledTimes(2)

    setSubscribed(5)
    await flushPromises()
    expect(wrapper.find('.offline-refresh').exists()).toBe(false)
  })
})
