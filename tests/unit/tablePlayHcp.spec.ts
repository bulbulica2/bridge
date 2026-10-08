import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import TablePlayPage from '@/views/TablePlayPage.vue'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Bid, Card, Playing, Suit } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'

// Our high card points in the table's bottom-right corner while bidding
// with three robots (#204).
vi.mock('@/services/chat', () => ({ getMessages: () => new Promise(() => {}), sendMessage: () => new Promise(() => {}) }))
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
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ params: { id: '5' }, path: '/tables/5/play' }),
}))
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate: vi.fn() }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})

const robot = (id: number) => ({
  id,
  name: `Robot ${id}`,
  username: `robot-${id}`,
  description: null,
  is_robot: true,
  is_admin: false,
})
const CY = { id: 3, name: 'Cy', username: 'cy', description: null, is_robot: false, is_admin: false }
const ANN = { id: 1, name: 'Ann', username: 'ann', description: null, is_robot: false, is_admin: false }

// Cy sits South with three robots.
const ROBOTS = { N: robot(91), E: robot(92), S: CY, W: robot(93) }

const card = (id: number, suit: Suit, rank: number): Card => ({ id, suit, rank, rank_name: '' })

// 3 aces, 1 king, 2 queens and 2 jacks: 21 HCP.
const HAND: Card[] = [
  card(1, 'S', 15),
  card(2, 'H', 15),
  card(3, 'D', 15),
  card(4, 'C', 14),
  card(5, 'S', 13),
  card(6, 'H', 13),
  card(7, 'D', 12),
  card(8, 'C', 12),
  card(9, 'S', 2),
  card(10, 'H', 3),
  card(11, 'D', 4),
  card(12, 'C', 5),
  card(13, 'S', 6),
]

function makeTable(players: Record<Seat, typeof CY>, overrides: Partial<Table> = {}): Table {
  return {
    id: 5,
    name: 'Practice',
    created_by: 3,
    moderated_by: 3,
    board_id: 7,
    unattended_since: null,
    set_minutes: 16,
    allow_kibitzers: true,
    kibitzers: 0,
    created_at: '',
    updated_at: '',
    seats: (['N', 'E', 'S', 'W'] as Seat[]).map((seat, i) => ({
      id: i + 1,
      table_id: 5,
      user_id: players[seat].id,
      seat,
      ready: false,
      away_since: null,
      replace_at: null,
      start_deadline: null,
      user: players[seat],
    })),
    free_seats: [],
    set: null,
    can_manage: true,
    ...overrides,
  }
}

const bid = (call: string, level: number | null, strain: string | null, id: number) =>
  ({ id, call, level, strain, special: level === null }) as Bid
const pass = bid('P', null, null, 1)

// The auction, South (Cy) on turn.
function auction(overrides: Partial<Playing> = {}): Playing {
  return {
    phase: 'auction',
    playing_id: 42,
    set: null,
    board: { id: 7, number: 7, dealer: 'S', vulnerable: '' },
    players: ROBOTS,
    turn: 'S',
    acting_user_id: 3,
    turn_started_at: null,
    turn_deadline: null,
    turn_deadline_by: null,
    auction: [],
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
    my_seat: 'S',
    hand: HAND,
    declarer_hand: null,
    ...overrides,
  }
}

const passes = (['S', 'W', 'N', 'E'] as Seat[]).map((seat) => ({ seat, bid: pass, alert: null, question: null }))

// The auction over: 1♠ by South, West on lead.
function play(overrides: Partial<Playing> = {}): Playing {
  const oneSpade = bid('1S', 1, 'S', 8)
  return auction({
    phase: 'play',
    turn: 'W',
    acting_user_id: 93,
    auction: [{ seat: 'S', bid: oneSpade, alert: null, question: null }, ...passes.slice(1)],
    contract: { bid: oneSpade, doubled: 0, declarer: 'S', dummy: 'N' },
    tricks: [],
    current_trick: [],
    tricks_won: { ns: 0, ew: 0 },
    ...overrides,
  })
}

function passedOut(): Playing {
  return auction({
    phase: 'finished',
    turn: null,
    acting_user_id: null,
    auction: passes,
    result: { contract: null, declarer: null, tricks: null, score_ns: 0, claimed: false } as unknown as Playing['result'],
    deal: { N: HAND, E: HAND, S: HAND, W: HAND },
    ready: [],
    hand: [],
  })
}

const modalStub = { template: '<div><slot /></div>' }

async function mountPage(playing: Playing, table: Table = makeTable(ROBOTS)) {
  vi.mocked(tablesService.getTable).mockResolvedValue(table)
  vi.mocked(tablesService.listTables).mockResolvedValue([table])
  vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
  const wrapper = mount(TablePlayPage, {
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub, 'router-link': true } },
  })
  await flushPromises()
  return wrapper
}

async function show(state: Playing) {
  useGameStore().playing = state
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
  vi.mocked(gameService.getBids).mockResolvedValue([pass])
  vi.mocked(tablesService.sendHeartbeat).mockResolvedValue(undefined as never)
})

describe('TablePlayPage high card points (#204)', () => {
  test("with three robots, our HCP in the table's bottom-right corner while bidding", async () => {
    const wrapper = await mountPage(auction())

    const label = wrapper.get('.bridge-table .corner-bottom-right .corner-hcp')
    expect(label.text()).toBe('21 HCP')
    expect(label.attributes('aria-label')).toBe('21 high card points')
  })

  test('still there after our call, the auction going on', async () => {
    const wrapper = await mountPage(auction())

    await show(auction({ auction: passes.slice(0, 1), turn: 'W', acting_user_id: 93 }))

    expect(wrapper.find('.corner-hcp').text()).toBe('21 HCP')
  })

  test('gone once the auction ends in a contract', async () => {
    const wrapper = await mountPage(auction())
    expect(wrapper.find('.corner-hcp').exists()).toBe(true)

    await show(play())

    expect(wrapper.find('.corner-hcp').exists()).toBe(false)
  })

  test('gone once the auction ends passed out', async () => {
    const wrapper = await mountPage(auction())
    expect(wrapper.find('.corner-hcp').exists()).toBe(true)

    await show(passedOut())

    expect(wrapper.find('.corner-hcp').exists()).toBe(false)
  })

  test.each([
    ['the play', play()],
    ['a finished board', passedOut()],
    ['waiting', auction({ phase: 'waiting', turn: null, acting_user_id: null, hand: null })],
  ])('never in %s', async (_, state) => {
    const wrapper = await mountPage(state)

    expect(wrapper.find('.corner-hcp').exists()).toBe(false)
  })

  test('never with another human at the table', async () => {
    const mixed = { ...ROBOTS, N: ANN }
    const wrapper = await mountPage(auction({ players: mixed }), makeTable(mixed))

    expect(wrapper.find('.corner-hcp').exists()).toBe(false)
  })

  test('never for a kibitzer, who holds no hand', async () => {
    // Zed watches Cy practise with three robots.
    useAuthStore().user = { id: 9, name: 'Zed', username: 'zed', email: 'zed@example.com' }
    useTablesStore().kibitzingId = 5
    const table = makeTable(ROBOTS, { kibitzers: 1 })
    vi.mocked(tablesService.watchTable).mockResolvedValue(table)
    const wrapper = await mountPage(auction({ my_seat: null, hand: null }), table)

    expect(wrapper.find('.bridge-table').exists()).toBe(true)
    expect(wrapper.find('.corner-hcp').exists()).toBe(false)
  })
})
