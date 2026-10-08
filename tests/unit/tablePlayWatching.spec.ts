import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import TablePlayPage from '@/views/TablePlayPage.vue'
import AuctionHistory from '@/components/AuctionHistory.vue'
import BoardResultDialog from '@/components/BoardResultDialog.vue'
import ClaimAnswerDialog from '@/components/ClaimAnswerDialog.vue'
import TableSettingsDialog from '@/components/TableSettingsDialog.vue'
import * as echo from '@/services/echo'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Bid, Card, Playing, Suit } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { KIBITZERS_OFF_NOTICE, START_WATCHING_NOTICE, useTablesStore } from '@/stores/tables'
import { KIBITZER_ALERT } from '@/utils/alerts'
import { showToast } from '@/utils/toast'

// The game table watched without a seat (#182): the same table, read-only.
vi.mock('@/services/chat', () => ({ getMessages: vi.fn(() => new Promise(() => {})), sendMessage: () => new Promise(() => {}) }))
vi.mock('@/services/game', () => ({
  getPlaying: vi.fn(),
  getBids: vi.fn(),
}))
vi.mock('@/services/history', () => ({
  getMyPlayings: vi.fn(() => new Promise(() => {})),
  getSet: vi.fn(() => new Promise(() => {})),
  getBoardResults: vi.fn(() => new Promise(() => {})),
  getDoubleDummy: vi.fn(() => new Promise(() => {})),
}))
vi.mock('@/services/users', () => ({ getUser: () => new Promise(() => {}), getUserStats: () => new Promise(() => {}) }))
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
  listTables: vi.fn(),
  joinSeat: vi.fn(),
  updateTable: vi.fn(),
  watchTable: vi.fn(),
  unwatchTable: vi.fn(),
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

// The viewer is zed (id 9); ann, bob, cy and di play.
const ZED = { id: 9, name: 'Zed', username: 'zed', email: 'zed@example.com' }
const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null, is_robot: false, is_admin: false },
  E: { id: 2, name: 'Bob', username: 'bob', description: null, is_robot: false, is_admin: false },
  S: { id: 3, name: 'Cy', username: 'cy', description: null, is_robot: false, is_admin: false },
  W: { id: 4, name: 'Di', username: 'di', description: null, is_robot: false, is_admin: false },
}

function hand(seat: Seat): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C']
  const offset = ['N', 'E', 'S', 'W'].indexOf(seat)
  return Array.from({ length: 13 }, (_, i) => {
    const n = offset * 13 + i
    return { id: n + 1, suit: suits[Math.floor(n / 13)], rank: 2 + (n % 13), rank_name: '' }
  })
}

// The table with whoever sits where (the seats left out are free).
function makeTable(seats: Seat[] = ['N', 'E', 'S', 'W'], overrides: Partial<Table> = {}): Table {
  return {
    id: 5,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: 7,
    unattended_since: null,
    set_minutes: 16,
    allow_kibitzers: true,
    kibitzers: 1,
    created_at: '',
    updated_at: '',
    seats: seats.map((seat, i) => ({
      id: i + 1,
      table_id: 5,
      user_id: PLAYERS[seat].id,
      seat,
      ready: false,
      away_since: null,
      replace_at: null,
      start_deadline: null,
      user: PLAYERS[seat],
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !seats.includes(s)),
    set: null,
    can_manage: false,
    ...overrides,
  }
}

const bid = (call: string, level: number | null, strain: string | null, id: number) =>
  ({ id, call, level, strain, special: level === null }) as Bid

// A kibitzer's state: the public part, no seat, no hand.
function watched(overrides: Partial<Playing> = {}): Playing {
  return {
    phase: 'auction',
    playing_id: 42,
    set: null,
    board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
    players: PLAYERS,
    turn: 'E',
    acting_user_id: 2,
    turn_started_at: null,
    turn_deadline: null,
    turn_deadline_by: null,
    // North's 1♣ is alerted: a kibitzer sees that, not what it means.
    auction: [{ seat: 'N', bid: bid('1C', 1, 'C', 4), alert: { explanation: null }, question: null }],
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    claim: null,
    claim_locked: false,
    result: null,
    deal: null,
    ready: null,
    next_board_at: null,
    my_seat: null,
    hand: null,
    declarer_hand: null,
    ...overrides,
  }
}

// The play: 4♠ by North, dummy South (at the bottom for a kibitzer), one
// trick in.
function playing(overrides: Partial<Playing> = {}): Playing {
  return watched({
    phase: 'play',
    auction: [
      { seat: 'N', bid: bid('4S', 4, 'S', 24), alert: null, question: null },
      { seat: 'E', bid: bid('P', null, null, 1), alert: null, question: null },
      { seat: 'S', bid: bid('P', null, null, 1), alert: null, question: null },
      { seat: 'W', bid: bid('P', null, null, 1), alert: null, question: null },
    ],
    contract: { bid: bid('4S', 4, 'S', 24), doubled: 0, declarer: 'N', dummy: 'S' },
    tricks: [
      {
        round: 1,
        leader: 'E',
        winner: 'N',
        cards: [
          { seat: 'E', card: hand('E')[0] },
          { seat: 'S', card: hand('S')[0] },
          { seat: 'W', card: hand('W')[0] },
          { seat: 'N', card: hand('N')[0] },
        ],
      },
    ],
    current_trick: [{ seat: 'N', card: hand('N')[1] }],
    tricks_won: { ns: 1, ew: 0 },
    dummy_hand: hand('S').slice(1),
    turn: 'E',
    acting_user_id: 2,
    ...overrides,
  })
}

function finished(): Playing {
  return playing({
    phase: 'finished',
    turn: null,
    acting_user_id: null,
    current_trick: null,
    result: {
      contract: bid('4S', 4, 'S', 24),
      doubled: 0,
      declarer: 'N',
      tricks_won: 10,
      score_ns: 420,
      made_by: 1,
      claimed: false,
    },
    deal: { N: hand('N'), E: hand('E'), S: hand('S'), W: hand('W') },
    ready: [],
    next_board_at: '2099-01-01T00:00:00Z',
  })
}

const modalStub = { template: '<div><slot /></div>' }

async function mountPage(table: Table, state: Playing | Error = watched()) {
  vi.mocked(tablesService.getTable).mockResolvedValue(table)
  if (state instanceof Error) {
    vi.mocked(gameService.getPlaying).mockRejectedValue(state)
  } else {
    vi.mocked(gameService.getPlaying).mockResolvedValue(state)
  }
  const wrapper = mount(TablePlayPage, {
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub, 'router-link': true } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore().user = ZED
  vi.mocked(gameService.getBids).mockResolvedValue([])
  vi.mocked(tablesService.sendHeartbeat).mockResolvedValue(undefined)
  vi.mocked(tablesService.listTables).mockResolvedValue([])
})

afterEach(() => {
  useTablesStore().clear()
})

describe('watching mode', () => {
  test('the board answered without a seat (a reload while watching): the table is watched again', async () => {
    const wrapper = await mountPage(makeTable())

    const store = useTablesStore()
    expect(store.kibitzingId).toBe(5)
    expect(echo.listenToTable).toHaveBeenCalledWith(5, expect.any(Function), expect.any(Function))
    expect(wrapper.get('.watching-pill').text()).toBe('Watching')
    expect(wrapper.get('.stop-watching').text()).toBe('Stop watching')
  })

  test('the auction: the table from South, the calls, no hand, bidding box, chat or Leave', async () => {
    const wrapper = await mountPage(makeTable())

    expect(wrapper.get('.bridge-table .side-bottom').attributes('data-seat')).toBe('S')
    expect(wrapper.findAll('.bridge-table .plate')).toHaveLength(4)
    expect(wrapper.find('.seat-you').exists()).toBe(false)
    expect(wrapper.findComponent(AuctionHistory).exists()).toBe(true)
    expect(wrapper.find('.my-hand').exists()).toBe(false)
    expect(wrapper.find('.bidding-box').exists()).toBe(false)
    expect(wrapper.find('.chat-toggle').exists()).toBe(false)
    expect(wrapper.find('.leave-table').exists()).toBe(false)
    expect(wrapper.find('.review-boards').exists()).toBe(false)
    // Whom the board waits for stays.
    expect(wrapper.get('.turn-line').text()).toContain('Waiting for East')
    // The chat is the players': not even read.
    const chat = await import('@/services/chat')
    expect(chat.getMessages).not.toHaveBeenCalled()
  })

  test("an alerted call shows its \"!\" but not what it means, and offers no Ask", async () => {
    const wrapper = await mountPage(makeTable())

    const cell = wrapper.findComponent(AuctionHistory).get('.call-button')
    expect(cell.classes()).toContain('alerted')
    await cell.trigger('click')

    const popup = wrapper.findComponent(AuctionHistory).get('.call-popup')
    expect(popup.get('.alert-text').text()).toBe(KIBITZER_ALERT)
    expect(popup.find('.ask').exists()).toBe(false)
    expect(popup.find('.ask-in-chat').exists()).toBe(false)
  })

  test('the play: dummy at its seat (the bottom one), the trick, the last trick, the corners, no Claim', async () => {
    const wrapper = await mountPage(makeTable(), playing())

    const bottom = wrapper.get('.bridge-table .side-bottom')
    expect(bottom.attributes('data-seat')).toBe('S')
    expect(bottom.find('.dummy-hand').exists()).toBe(true)
    expect(bottom.find('.seat-dummy').text()).toBe('dummy')
    expect(bottom.findAll('.dummy-hand .playing-card')).toHaveLength(12)
    expect(wrapper.find('.dummy-hand .playable').exists()).toBe(false)
    expect(wrapper.find('.my-hand').exists()).toBe(false)
    expect(wrapper.get('.corner-contract .contract-line').text()).toContain('by North')
    expect(wrapper.get('.corner-contract .tricks-won').text()).toContain('NS 1')
    expect(wrapper.find('.corner-contract .contract-you').exists()).toBe(false)
    // The same corners as a player's (#210): the contract under who is
    // vulnerable, top left in partner's seat, Last trick alone top right.
    expect(wrapper.find('.side-top > .corner-top-left .corner-vul + .corner-contract').exists()).toBe(true)
    expect(wrapper.find('.bridge-table > .corner-top-right .last-trick-button').exists()).toBe(true)
    expect(wrapper.find('.corner-top-right .corner-contract').exists()).toBe(false)
    expect(wrapper.find('.centre .last-trick-button').exists()).toBe(false)
    expect(wrapper.find('.claim-button').exists()).toBe(false)
    expect(wrapper.find('.my-slot').exists()).toBe(false)
  })

  test("a pending claim: the claimer's cards shown, nothing to answer", async () => {
    const claim = { seat: 'S' as Seat, tricks: 3, hand: hand('S').slice(1), accepted: [], expires_at: '' }
    const wrapper = await mountPage(makeTable(), playing({ claim, dummy_hand: hand('S').slice(1) }))

    // The dialog, read-only and closable: a kibitzer has nothing to answer.
    expect(wrapper.findComponent(ClaimAnswerDialog).props('open')).toBe(true)
    expect(wrapper.findComponent(ClaimAnswerDialog).props('mySeat')).toBeNull()
    expect(wrapper.get('.claim-answer-text').text()).toBe('South claims 3 of 12')
    expect(wrapper.find('.claim-buttons').exists()).toBe(false)
    expect(wrapper.find('.claim-answer-close').exists()).toBe(true)
    expect(wrapper.find('.side-bottom .claim-hand, .side-bottom .dummy-hand').exists()).toBe(true)
  })

  test('finished: the result without the vote, nothing to review', async () => {
    const wrapper = await mountPage(makeTable(), finished())

    const dialog = wrapper.findComponent(BoardResultDialog)
    expect(dialog.props('vote')).toBe(false)
    expect(wrapper.find('.vote-button').exists()).toBe(false)
    expect(wrapper.find('.review-boards').exists()).toBe(false)
  })

  test('Stop watching: the backend told, off to the lobby', async () => {
    vi.mocked(tablesService.unwatchTable).mockResolvedValue(makeTable([], { kibitzers: 0 }))
    const wrapper = await mountPage(makeTable())

    await wrapper.get('.stop-watching').trigger('click')
    await flushPromises()

    expect(tablesService.unwatchTable).toHaveBeenCalledWith(5)
    expect(echo.leaveTable).toHaveBeenCalledWith(5)
    expect(useTablesStore().kibitzingId).toBeNull()
    expect(useGameStore().tableId).toBeNull()
    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })

  test('Stop watching goes out once while on its way', async () => {
    vi.mocked(tablesService.unwatchTable).mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPage(makeTable())

    // Two taps before the page has redrawn.
    const button = wrapper.get('.stop-watching').element as HTMLElement
    button.click()
    button.click()
    await flushPromises()

    expect(tablesService.unwatchTable).toHaveBeenCalledTimes(1)
  })

  test('Stop watching refused: told, and off to the lobby anyway', async () => {
    vi.mocked(tablesService.unwatchTable).mockRejectedValue(axiosError(500, 'Server error.'))
    const wrapper = await mountPage(makeTable())
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await wrapper.get('.stop-watching').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('Server error.', 'danger')
    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })

  test('kibitzers turned off while we watch: told, and off to the lobby', async () => {
    await mountPage(makeTable())
    useGameStore().watchUser(9)
    const onUnseated = vi.mocked(echo.listenToUser).mock.calls[0][8]

    onUnseated({ table_id: 5, reason: 'kibitzers_off', kibitzing: false })
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith(KIBITZERS_OFF_NOTICE, 'warning')
    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })
})

describe('sitting down', () => {
  test('between sets an empty seat offers Sit here, which ends watching', async () => {
    const table = makeTable(['N', 'E', 'S'], { board_id: null })
    const wrapper = await mountPage(table, watched({ phase: 'waiting', playing_id: null, board: null, players: null, auction: null, turn: null, acting_user_id: null }))

    await wrapper.get('.bridge-table [data-seat="W"] .seat-empty-button').trigger('click')
    await flushPromises()
    // The same menu at the plate as for a player (#192).
    const buttons = wrapper.findAll('.bridge-table .seat-menu[data-seat="W"] [role="menuitem"]')
    expect(buttons.map((b) => b.text())).toEqual(['Sit here'])

    const joined = makeTable(['N', 'E', 'S'], { board_id: null })
    joined.seats.push({ ...joined.seats[0], id: 9, user_id: 9, seat: 'W', user: { ...PLAYERS.W, id: 9, username: 'zed' } })
    joined.free_seats = []
    vi.mocked(tablesService.joinSeat).mockResolvedValue(joined)
    await buttons[0].trigger('click')
    await flushPromises()

    expect(tablesService.joinSeat).toHaveBeenCalledWith(5, 'W')
    expect(useTablesStore().kibitzingId).toBeNull()
    expect(wrapper.find('.watching-pill').exists()).toBe(false)
    expect(wrapper.find('.start-box').exists()).toBe(true)
  })

  test('mid-set: no Sit', async () => {
    const running = { id: 3, number: 1, board: 2, of: 4, finished: false, ended: null, replaced: [], minutes: 16, time_left: { N: 100, E: 100, S: 100, W: 100 } }
    const table = makeTable(['N', 'E', 'S'], { set: running })
    const wrapper = await mountPage(table, finished())

    expect(wrapper.find('.seat-empty-button').exists()).toBe(false)
  })
})

describe('not seated, not watching', () => {
  test('a table that allows it offers Watch, which opens its board', async () => {
    const wrapper = await mountPage(makeTable(), axiosError(403))
    expect(wrapper.find('.not-seated').exists()).toBe(true)

    vi.mocked(tablesService.watchTable).mockResolvedValue(makeTable())
    vi.mocked(gameService.getPlaying).mockResolvedValue(watched())
    await wrapper.get('.watch-table').trigger('click')
    await flushPromises()

    expect(tablesService.watchTable).toHaveBeenCalledWith(5)
    expect(wrapper.find('.not-seated').exists()).toBe(false)
    expect(wrapper.get('.watching-pill').text()).toBe('Watching')
  })

  test('Watch goes out once while on its way', async () => {
    const wrapper = await mountPage(makeTable(), axiosError(403))
    vi.mocked(tablesService.watchTable).mockReturnValue(new Promise(() => {}))

    await wrapper.get('.watch-table').trigger('click')
    await wrapper.get('.watch-table').trigger('click')
    await flushPromises()

    expect(tablesService.watchTable).toHaveBeenCalledTimes(1)
  })

  test('no Watch where the table does not allow it', async () => {
    const wrapper = await mountPage(makeTable(undefined, { allow_kibitzers: false }), axiosError(403))

    expect(wrapper.find('.watch-table').exists()).toBe(false)
  })

  test('a refused Watch is told; a 401 goes to the login page', async () => {
    const wrapper = await mountPage(makeTable(), axiosError(403))

    vi.mocked(tablesService.watchTable).mockRejectedValue(axiosError(403, 'This table does not allow kibitzers.'))
    await wrapper.get('.watch-table').trigger('click')
    await flushPromises()
    expect(showToast).toHaveBeenCalledWith('This table does not allow kibitzers.', 'danger')
    expect(wrapper.find('.not-seated').exists()).toBe(true)

    vi.mocked(tablesService.watchTable).mockRejectedValue(axiosError(401))
    await wrapper.get('.watch-table').trigger('click')
    await flushPromises()
    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })
})

describe('the Start timer at a table that allows kibitzers', () => {
  test('our seat freed: told, and the page stays, watching', async () => {
    useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
    const table = makeTable(['N', 'E', 'S', 'W'], { board_id: null })
    table.seats = table.seats.map((s) => (s.seat === 'S' ? { ...s, start_deadline: '2026-10-08T12:00:15Z' } : s))
    // Followed from login on, before any table.
    useGameStore().watchUser(3)
    const onUnseated = vi.mocked(echo.listenToUser).mock.calls[0][8]
    const waiting = watched({ phase: 'waiting', playing_id: null, board: null, players: null, auction: null, turn: null, acting_user_id: null })
    const wrapper = await mountPage(table, { ...waiting, my_seat: 'S' })
    expect(wrapper.find('.start-box').exists()).toBe(true)
    vi.mocked(gameService.getPlaying).mockResolvedValue(waiting)

    onUnseated({ table_id: 5, reason: 'start_timeout', kibitzing: true })
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith(START_WATCHING_NOTICE, 'warning')
    expect(navigate).not.toHaveBeenCalled()
    expect(wrapper.get('.watching-pill').text()).toBe('Watching')
    expect(wrapper.find('.start-box').exists()).toBe(false)
    // The board is read again, as a kibitzer's.
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    // The empty seat is ours to take again.
    expect(wrapper.find('.bridge-table [data-seat="S"] .seat-empty-button').exists()).toBe(true)
  })
})

describe('the settings dialog: Allow kibitzers', () => {
  // Ann (the manager) at the waiting table between sets.
  async function managing(overrides: Partial<Table> = {}) {
    useAuthStore().user = { id: 1, name: 'Ann', username: 'ann', email: 'ann@example.com' }
    const table = makeTable(['N', 'E', 'S', 'W'], { board_id: null, can_manage: true, ...overrides })
    return mountPage(table, watched({ phase: 'waiting', playing_id: null, board: null, players: null, auction: null, turn: null, acting_user_id: null, my_seat: 'N' }))
  }

  test('a manager turns it off: sent, told', async () => {
    const wrapper = await managing()
    expect(wrapper.findComponent(TableSettingsDialog).props('allowKibitzers')).toBe(true)
    vi.mocked(tablesService.updateTable).mockResolvedValue(makeTable(undefined, { board_id: null, can_manage: true, allow_kibitzers: false }))

    wrapper.findComponent(TableSettingsDialog).vm.$emit('kibitzers', false)
    await flushPromises()

    expect(tablesService.updateTable).toHaveBeenCalledWith(5, { allow_kibitzers: false })
    expect(showToast).toHaveBeenCalledWith('Kibitzers are no longer allowed here.', 'success')

    vi.mocked(tablesService.updateTable).mockResolvedValue(makeTable(undefined, { board_id: null, can_manage: true }))
    wrapper.findComponent(TableSettingsDialog).vm.$emit('kibitzers', true)
    await flushPromises()
    expect(showToast).toHaveBeenCalledWith('Kibitzers may watch this table.', 'success')
  })

  test('refused (a set started meanwhile): told, the table read again, the switch put back', async () => {
    const wrapper = await managing()
    vi.mocked(tablesService.updateTable).mockRejectedValue(axiosError(409, 'A set is going on at this table: change its settings once it is over.'))
    const key = wrapper.findComponent(TableSettingsDialog).props('pickerKey')

    wrapper.findComponent(TableSettingsDialog).vm.$emit('kibitzers', false)
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('A set is going on at this table: change its settings once it is over.', 'danger')
    expect(tablesService.getTable).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent(TableSettingsDialog).props('pickerKey')).toBe(key + 1)
  })

  test('one change at a time; a 401 goes to the login page', async () => {
    const wrapper = await managing()
    vi.mocked(tablesService.updateTable).mockRejectedValue(axiosError(401))

    wrapper.findComponent(TableSettingsDialog).vm.$emit('kibitzers', false)
    wrapper.findComponent(TableSettingsDialog).vm.$emit('kibitzers', false)
    await flushPromises()

    expect(tablesService.updateTable).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })

  test('the corner says whether kibitzers may watch: the manager under the gear', async () => {
    const wrapper = await managing({ allow_kibitzers: false })

    expect(wrapper.find('.settings-gear').exists()).toBe(true)
    expect(wrapper.get('.corner-kibitzers').text()).toBe('No kibitzers')
  })

  test('the corner says whether kibitzers may watch: the others beside the time', async () => {
    useAuthStore().user = { id: 2, name: 'Bob', username: 'bob', email: 'bob@example.com' }
    const wrapper = await mountPage(
      makeTable(undefined, { board_id: null }),
      watched({ phase: 'waiting', playing_id: null, board: null, players: null, auction: null, turn: null, acting_user_id: null, my_seat: 'E' }),
    )

    expect(wrapper.find('.corner-minutes').exists()).toBe(true)
    expect(wrapper.get('.corner-kibitzers').text()).toBe('Kibitzers allowed')
  })
})
