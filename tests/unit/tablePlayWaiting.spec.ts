import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { pickSegment } from './ionEvents'
import TablePlayPage from '@/views/TablePlayPage.vue'
import StartBox from '@/components/StartBox.vue'
import TableSettingsDialog from '@/components/TableSettingsDialog.vue'
import * as echo from '@/services/echo'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Playing } from '@/services/game'
import type { BroadcastTable, Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { START_TIMEOUT_NOTICE, startRevokedText, useTablesStore } from '@/stores/tables'
import { confirmMove } from '@/utils/seatMove'
import { showToast } from '@/utils/toast'

// The game table before a board (#181): joining or creating a table lands
// here, and the table itself is the waiting room. The play page's other
// sides have their own specs.
vi.mock('@/services/chat', () => ({ getMessages: () => new Promise(() => {}), sendMessage: () => new Promise(() => {}) }))
vi.mock('@/services/game', () => ({
  getPlaying: vi.fn(),
  getBids: vi.fn(),
}))
vi.mock('@/services/history', () => ({ getMyPlayings: vi.fn(), getSet: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/services/users', () => ({ getUser: () => new Promise(() => {}), getUserStats: () => new Promise(() => {}) }))
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
  listTables: vi.fn(),
  joinSeat: vi.fn(),
  startTable: vi.fn(),
  cancelStart: vi.fn(),
  updateTable: vi.fn(),
  sendHeartbeat: vi.fn(),
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
}))
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ params: { id: '5' }, path: '/tables/5/play' }),
}))
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})

function axiosError(status: number, message = 'Refused.'): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message }, statusText: '', headers: {}, config }
  return error
}

// The user is ana (id 1). Seats are seat -> username; `robot-…` usernames
// are robots, and `ready` lists the humans who have pressed Start.
const IDS: Record<string, number> = { ana: 1, bob: 2, cy: 3, 'robot-1': 101, 'robot-2': 102, 'robot-3': 103 }

function makeTable(seats: Partial<Record<Seat, string>>, ready: string[] = [], extra: Partial<Table> = {}): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id: 5,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: null,
    unattended_since: null,
    set_minutes: 16,
    created_at: '',
    updated_at: '',
    seats: taken.map(([seat, username], i) => ({
      id: i + 1,
      table_id: 5,
      user_id: IDS[username],
      seat,
      ready: username.startsWith('robot-') || ready.includes(username),
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
    can_manage: true,
    ...extra,
  }
}

const WITH_ROBOTS = { N: 'robot-1', E: 'robot-2', S: 'ana', W: 'robot-3' }
const TWO_HUMANS = { N: 'robot-1', E: 'bob', S: 'ana', W: 'robot-3' }

// What GET /tables/{id}/playing answers before a board.
function waiting(): Playing {
  return {
    phase: 'waiting',
    playing_id: null,
    set: null,
    board: null,
    players: null,
    turn: null,
    acting_user_id: null,
    auction: null,
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    claim: null,
    result: null,
    deal: null,
    ready: null,
    my_seat: 'S',
    hand: null,
  } as unknown as Playing
}

// The board the last Start deals.
function dealt(): Playing {
  return {
    ...waiting(),
    phase: 'auction',
    playing_id: 42,
    board: { id: 8, number: 8, dealer: 'N', vulnerable: '' },
    players: Object.fromEntries(makeTable(TWO_HUMANS).seats.map((s) => [s.seat, s.user])),
    turn: 'N',
    acting_user_id: 101,
    auction: [],
    hand: [],
  } as unknown as Playing
}

const modalStub = { template: '<div><slot /></div>' }

async function mountPage(table: Table, playing: Playing | Error = waiting()) {
  vi.mocked(tablesService.getTable).mockResolvedValue(table)
  if (playing instanceof Error) {
    vi.mocked(gameService.getPlaying).mockRejectedValue(playing)
  } else {
    vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
  }
  const wrapper = mount(TablePlayPage, {
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub, 'router-link': true } },
  })
  await flushPromises()
  return wrapper
}

// What Reverb would call when a TableUpdated arrives on the table's channel.
async function pushUpdate(table: BroadcastTable) {
  const calls = vi.mocked(echo.listenToTable).mock.calls
  const [, onUpdate] = calls[calls.length - 1]
  onUpdate(table)
  await flushPromises()
}

function timed(table: Table, seat: Seat, deadline: string): Table {
  return { ...table, seats: table.seats.map((s) => (s.seat === seat ? { ...s, start_deadline: deadline } : s)) }
}

// An empty seat's menu at its plate (#192): tap the seat, then the option.
async function press(wrapper: VueWrapper, seat: Seat, text: string) {
  await wrapper.get(`.bridge-table [data-seat="${seat}"] .seat-empty-button`).trigger('click')
  await flushPromises()
  await wrapper.findAll('.seat-menu [role="menuitem"]').find((b) => b.text() === text)!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
  vi.mocked(gameService.getBids).mockResolvedValue([])
  vi.mocked(tablesService.sendHeartbeat).mockResolvedValue(undefined)
  vi.mocked(tablesService.listTables).mockResolvedValue([])
})

afterEach(() => {
  useTablesStore().unwatchTable()
  vi.useRealTimers()
})

describe('the waiting table', () => {
  test('the four plates with their ticks, Start in the centre, Leave in the header', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))

    expect(wrapper.findAll('.bridge-table .plate')).toHaveLength(4)
    // Robots are always ready; we and bob haven't pressed yet.
    expect(wrapper.findAll('.bridge-table .seat-ready-mark')).toHaveLength(2)
    expect(wrapper.get('.bridge-table .side-bottom').attributes('data-seat')).toBe('S')
    const box = wrapper.get('.bridge-table .centre .start-box')
    expect(box.text()).toContain('Waiting for East (bob) and you to press Start.')
    expect(box.find('.start-button').exists()).toBe(true)
    expect(wrapper.get('.leave-table').text()).toBe('Leave')
    // Nothing but the table: no seat list under it, no Leave on it.
    expect(wrapper.findAll('.start-box')).toHaveLength(1)
    expect(wrapper.find('.bridge-table .leave-table').exists()).toBe(false)
  })

  test('with three robots: Start deals, and the board is on the table at once', async () => {
    const wrapper = await mountPage(makeTable(WITH_ROBOTS))
    const table = makeTable(WITH_ROBOTS, [], { board_id: 8 })
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...table, playing: dealt() })

    await wrapper.get('.start-button').trigger('click')
    await flushPromises()

    expect(tablesService.startTable).toHaveBeenCalledWith(5)
    expect(wrapper.find('.start-box').exists()).toBe(false)
    expect(useGameStore().playing?.playing_id).toBe(42)
    // The answer was the board: no second read of it, no page change.
    expect(gameService.getPlaying).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  test('two humans: our Start waits, ticked, with Cancel; the other one deals for both', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...makeTable(TWO_HUMANS, ['ana']), playing: null })

    await wrapper.get('.start-button').trigger('click')
    await flushPromises()

    const box = wrapper.get('.start-box')
    expect(box.text()).toContain('Waiting for the others…')
    expect(box.find('.start-cancel').exists()).toBe(true)
    expect(wrapper.get('.bridge-table [data-seat="S"]').classes()).toContain('seat-ready')

    // Bob's Start deals: the table says so, and the page reads the board.
    vi.mocked(gameService.getPlaying).mockResolvedValue(dealt())
    await pushUpdate(makeTable(TWO_HUMANS, [], { board_id: 8 }))

    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.start-box').exists()).toBe(false)
  })

  test('a refused Start is told and the board read again', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))
    vi.mocked(tablesService.startTable).mockRejectedValue(axiosError(409, 'A board is already in progress at this table.'))

    await wrapper.get('.start-button').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('A board is already in progress at this table.', 'danger')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
  })

  test("our Start timer: \"Press Start\" counting down in orange, red in its last seconds", async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    const wrapper = await mountPage(timed(makeTable(TWO_HUMANS, ['bob']), 'S', '2026-10-08T12:00:12Z'))

    const clock = wrapper.get('.bridge-table .start-clock')
    expect(clock.text()).toBe('Press Start · 0:12')
    expect(clock.classes()).toContain('start-clock-mine')

    vi.advanceTimersByTime(9000)
    await flushPromises()
    expect(wrapper.get('.start-clock').text()).toBe('Press Start · 0:03')
    expect(wrapper.get('.start-clock').classes()).toContain('start-clock-urgent')
    wrapper.unmount()
  })

  test("another player's Start timer: whom the table waits for", async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    const wrapper = await mountPage(timed(makeTable(TWO_HUMANS, ['ana']), 'E', '2026-10-08T12:00:15Z'))

    expect(wrapper.get('.bridge-table .start-clock').text()).toBe('Waiting for East · 0:15')
    expect(wrapper.get('.start-clock').classes()).not.toContain('start-clock-mine')
    wrapper.unmount()
  })

  test('the Start timer running out: told, and off to the list', async () => {
    await mountPage(timed(makeTable(TWO_HUMANS, ['bob']), 'S', '2026-10-08T12:00:15Z'))
    useGameStore().watchUser(1)
    const onUnseated = vi.mocked(echo.listenToUser).mock.calls[0][8]

    onUnseated({ table_id: 5, reason: 'start_timeout', kibitzing: false })
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith(START_TIMEOUT_NOTICE, 'warning')
    expect(echo.leaveTable).toHaveBeenCalledWith(5)
    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })

  test('a new set time takes our Start back: told, the tick gone', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS, ['ana']))
    expect(wrapper.get('.bridge-table [data-seat="S"]').classes()).toContain('seat-ready')

    await pushUpdate(makeTable(TWO_HUMANS, [], { set_minutes: 8 }))

    expect(showToast).toHaveBeenCalledWith(startRevokedText(8), 'warning')
    expect(wrapper.get('.bridge-table [data-seat="S"]').classes()).not.toContain('seat-ready')
    expect(wrapper.get('.start-box').find('.start-button').exists()).toBe(true)
  })

  test('our own seat away: the notice says so until the backend takes the mark back', async () => {
    const table = makeTable(TWO_HUMANS)
    table.seats = table.seats.map((s) =>
      s.seat === 'S' ? { ...s, away_since: '2026-10-08T12:00:00Z', replace_at: null } : s,
    )
    const wrapper = await mountPage(table)

    expect(wrapper.text()).toContain("You're away from Club")
  })
})

describe('the set time in the corner', () => {
  test("a manager's gear opens the settings, which change it", async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))
    const gear = wrapper.get('.bridge-table .corner-top-right .settings-gear')
    expect(gear.text()).toBe('16 min')
    expect(gear.attributes('aria-label')).toBe('Table settings: 16 minutes each for a set of 4 boards')
    expect(wrapper.findComponent(TableSettingsDialog).props('open')).toBe(false)

    await gear.trigger('click')
    const dialog = wrapper.findComponent(TableSettingsDialog)
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('minutes')).toBe(16)

    vi.mocked(tablesService.updateTable).mockResolvedValue(makeTable(TWO_HUMANS, [], { set_minutes: 8 }))
    await pickSegment(dialog, '8')

    expect(tablesService.updateTable).toHaveBeenCalledWith(5, { set_minutes: 8 })
    expect(showToast).toHaveBeenCalledWith('Each player now has 8 minutes for a set.', 'success')
    expect(wrapper.get('.settings-gear').text()).toBe('8 min')

    await wrapper.get('.settings-close').trigger('click')
    expect(wrapper.findComponent(TableSettingsDialog).props('open')).toBe(false)
  })

  test('a refused change is told, the table read again and the picker put back', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))
    await wrapper.get('.settings-gear').trigger('click')
    const key = wrapper.findComponent(TableSettingsDialog).props('pickerKey')
    vi.mocked(tablesService.updateTable).mockRejectedValue(axiosError(409, 'A set is in progress.'))
    vi.mocked(tablesService.getTable).mockClear()

    await pickSegment(wrapper.findComponent(TableSettingsDialog), '20')

    expect(showToast).toHaveBeenCalledWith('A set is in progress.', 'danger')
    expect(tablesService.getTable).toHaveBeenCalledWith(5)
    expect(wrapper.findComponent(TableSettingsDialog).props('pickerKey')).toBe(key + 1)
    expect(wrapper.findComponent(TableSettingsDialog).props('busy')).toBe(false)
  })

  test('an expired session goes to log in; a reread that fails leaves the page', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))
    await wrapper.get('.settings-gear').trigger('click')
    vi.mocked(tablesService.updateTable).mockRejectedValue(axiosError(401))

    await pickSegment(wrapper.findComponent(TableSettingsDialog), '12')
    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')

    vi.mocked(tablesService.updateTable).mockRejectedValue(new Error('offline'))
    vi.mocked(tablesService.getTable).mockRejectedValue(new Error('offline'))
    await pickSegment(wrapper.findComponent(TableSettingsDialog), '20')
    expect(showToast).toHaveBeenCalledWith('Could not change the time for a set. Please try again.', 'danger')
    expect(wrapper.find('.start-box').exists()).toBe(true)
  })

  test('one change at a time', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))
    await wrapper.get('.settings-gear').trigger('click')
    vi.mocked(tablesService.updateTable).mockReturnValue(new Promise(() => {}))

    await pickSegment(wrapper.findComponent(TableSettingsDialog), '8')
    wrapper.findComponent(TableSettingsDialog).vm.$emit('change', 12)
    await flushPromises()

    expect(tablesService.updateTable).toHaveBeenCalledTimes(1)
    expect(wrapper.findComponent(TableSettingsDialog).props('busy')).toBe(true)
  })

  test('everyone else reads it', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS, [], { can_manage: false, set_minutes: 20 }))

    expect(wrapper.find('.settings-gear').exists()).toBe(false)
    const text = wrapper.get('.bridge-table .corner-top-right .corner-minutes')
    expect(text.text()).toBe('Time for a set: 20 min')
    expect(text.attributes('title')).toBe('20 minutes each for a set of 4 boards')
  })

  test('once the set runs the corner is the contract\'s, and an open dialog closes', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))
    await wrapper.get('.settings-gear').trigger('click')

    const set = { id: 3, number: 1, board: 1, of: 4, finished: false, ended: null, replaced: [] }
    vi.mocked(gameService.getPlaying).mockResolvedValue({ ...dealt(), set } as Playing)
    await pushUpdate(makeTable(TWO_HUMANS, [], { board_id: 8, set: set as Table['set'] }))

    expect(wrapper.find('.settings-gear').exists()).toBe(false)
    expect(wrapper.find('.corner-minutes').exists()).toBe(false)
    expect(wrapper.findComponent(TableSettingsDialog).props('open')).toBe(false)
  })
})

describe('somebody not seated here', () => {
  const OTHERS = { N: 'robot-1', E: 'bob', W: 'robot-3' }

  test('sees the table and a free seat to take, which asks first when it is a move', async () => {
    const elsewhere = makeTable({ S: 'ana', N: 'cy' }, [], { id: 9, name: 'Home' })
    elsewhere.seats = elsewhere.seats.map((s) => ({ ...s, table_id: 9 }))
    vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(OTHERS), elsewhere])
    const wrapper = await mountPage(makeTable(OTHERS), axiosError(403))

    expect(wrapper.get('.not-seated-note').text()).toBe("You don't sit at this table. Take a free seat to play.")
    expect(wrapper.get('.seated-elsewhere').text()).toBe('You sit at Home. Taking a seat here moves you.')
    expect(wrapper.find('.unattended').exists()).toBe(false)

    vi.mocked(confirmMove).mockResolvedValue(false)
    await press(wrapper, 'S', 'Sit here')
    expect(confirmMove).toHaveBeenCalled()
    expect(tablesService.joinSeat).not.toHaveBeenCalled()

    // Said yes: seated, and the board (here, the waiting table) is ours to see.
    vi.mocked(confirmMove).mockResolvedValue(true)
    vi.mocked(tablesService.joinSeat).mockResolvedValue(makeTable(TWO_HUMANS))
    vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(TWO_HUMANS)])
    vi.mocked(gameService.getPlaying).mockResolvedValue(waiting())
    await press(wrapper, 'S', 'Sit here')

    expect(tablesService.joinSeat).toHaveBeenCalledWith(5, 'S')
    expect(wrapper.find('.not-seated').exists()).toBe(false)
    expect(wrapper.get('.bridge-table .centre .start-box').exists()).toBe(true)
  })

  test('sitting down when seated nowhere asks nothing', async () => {
    const wrapper = await mountPage(makeTable(OTHERS), axiosError(403))
    vi.mocked(tablesService.joinSeat).mockResolvedValue(makeTable(TWO_HUMANS))
    vi.mocked(gameService.getPlaying).mockResolvedValue(waiting())

    await press(wrapper, 'S', 'Sit here')

    expect(confirmMove).not.toHaveBeenCalled()
    expect(tablesService.joinSeat).toHaveBeenCalledWith(5, 'S')
  })

  test('an unattended table says what taking a seat means; a full one has no seat to take', async () => {
    const unattended = makeTable(
      { N: 'robot-1', E: 'robot-2' },
      [],
      { moderated_by: null, unattended_since: '2026-10-08T12:00:00Z', can_manage: false },
    )
    const wrapper = await mountPage(unattended, axiosError(403))
    expect(wrapper.get('.unattended').text()).toContain('Robots only — sit down to take over.')
    wrapper.unmount()

    setActivePinia(createPinia())
    useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
    const full = await mountPage(makeTable({ ...OTHERS, S: 'cy' }), axiosError(403))
    expect(full.get('.not-seated-note').text()).toBe("You don't sit at this table, and all four seats are taken.")
    expect(full.find('.seat-empty-button').exists()).toBe(false)
  })
})

describe('StartBox on the table', () => {
  test('is the only Start there is', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))

    expect(wrapper.findAllComponents(StartBox)).toHaveLength(1)
    expect(wrapper.findComponent(StartBox).props()).toEqual(
      expect.objectContaining({ me: 1, busy: false }),
    )
  })
})
