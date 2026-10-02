import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import StartBox from '@/components/StartBox.vue'
import TableDetailPage from '@/views/TableDetailPage.vue'
import * as echo from '@/services/echo'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Playing } from '@/services/game'
import type { BroadcastTable, Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'
import { isReady, startNeeded, startWaiting } from '@/utils/start'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
  startTable: vi.fn(),
  cancelStart: vi.fn(),
  sendHeartbeat: vi.fn(),
}))
vi.mock('@/services/game', async (importOriginal) => ({
  ...(await importOriginal<typeof gameService>()),
  getPlaying: vi.fn(),
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
  useRoute: () => ({ params: { id: '5' }, path: '/tables/5' }),
}))
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})

// The user is ana (id 1). Seats are seat -> username; `robot-…` usernames
// are robots, and `ready` lists the humans who have pressed Start.
const IDS: Record<string, number> = { ana: 1, bob: 2, cy: 3, 'robot-1': 101, 'robot-2': 102, 'robot-3': 103 }
const idOf = (username: string) => IDS[username]

function makeTable(
  seats: Partial<Record<Seat, string>>,
  ready: string[] = [],
  extra: Partial<Table> = {},
): Table {
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
      user_id: idOf(username),
      seat,
      ready: username.startsWith('robot-') || ready.includes(username),
      user: {
        id: idOf(username),
        name: username,
        username,
        description: null,
        is_robot: username.startsWith('robot-'),
      },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: true,
    ...extra,
  }
}

const WITH_ROBOTS = { N: 'robot-1', E: 'robot-2', S: 'ana', W: 'robot-3' }
const TWO_HUMANS = { N: 'robot-1', E: 'bob', S: 'ana', W: 'robot-3' }

// A state of the table's board: only the parts the Start logic reads matter.
function stateOf(table: Table, overrides: Partial<Playing> = {}): Playing {
  const players = Object.fromEntries(table.seats.map((s) => [s.seat, s.user])) as Playing['players']
  return {
    phase: 'auction',
    playing_id: 42,
    board: { id: 8, number: 8, dealer: 'N', vulnerable: '' },
    players,
    turn: 'N',
    acting_user_id: table.seats.find((s) => s.seat === 'N')!.user_id,
    auction: [],
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
    hand: [],
    ...overrides,
  }
}

function logIn() {
  useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
}

// What Reverb would call when a TableUpdated arrives on the table's channel.
function pushUpdate(table: BroadcastTable) {
  const calls = vi.mocked(echo.listenToTable).mock.calls
  const [, onUpdate] = calls[calls.length - 1]
  onUpdate(table)
}

describe('start helpers', () => {
  beforeEach(() => setActivePinia(createPinia()))

  test('robots are always ready, humans once they press', () => {
    const table = makeTable(TWO_HUMANS, ['bob'])
    expect(table.seats.map((s) => isReady(s))).toEqual([true, true, false, true])
    expect(isReady({ ...table.seats[0], ready: false })).toBe(true)
  })

  test('a table without a board waits for Start', () => {
    expect(startNeeded(makeTable({ S: 'ana' }), null)).toBe(true)
  })

  test('never during a board, nor while its phase is unknown', () => {
    const table = makeTable(WITH_ROBOTS, [], { board_id: 8 })
    expect(startNeeded(table, stateOf(table))).toBe(false)
    expect(startNeeded(table, stateOf(table, { phase: 'play' }))).toBe(false)
    expect(startNeeded(table, null)).toBe(false)
  })

  test('a finished board: Next for the same four, Start once one was replaced', () => {
    const table = makeTable(TWO_HUMANS, [], { board_id: 8 })
    const done = stateOf(table, { phase: 'finished' })
    expect(startNeeded(table, done)).toBe(false)

    const refilled = makeTable({ ...TWO_HUMANS, E: 'cy' }, [], { board_id: 8 })
    expect(startNeeded(refilled, done)).toBe(true)
    const short = makeTable({ N: 'robot-1', S: 'ana', W: 'robot-3' }, [], { board_id: 8 })
    expect(startNeeded(short, done)).toBe(true)
    // A board we hold that isn't the table's (an old one) says nothing.
    expect(startNeeded(refilled, { ...done, board: { ...done.board!, id: 3 } })).toBe(false)
  })

  test('who the board waits for', () => {
    expect(startWaiting(makeTable(WITH_ROBOTS), 1)).toBe('Waiting for you to press Start.')
    expect(startWaiting(makeTable(TWO_HUMANS, ['ana']), 1)).toBe(
      'Waiting for East (bob) to press Start.',
    )
    expect(startWaiting(makeTable({ N: 'cy', E: 'bob', S: 'ana', W: 'robot-3' }), 1)).toBe(
      'Waiting for North (cy), East (bob) and you to press Start.',
    )
    expect(startWaiting(makeTable({ S: 'ana', W: 'robot-3' }, ['ana']), 1)).toBe(
      'Waiting for 2 more players.',
    )
    expect(startWaiting(makeTable({ E: 'bob', S: 'ana', W: 'robot-3' }, ['ana']), 1)).toBe(
      'Waiting for a fourth player, and for East (bob) to press Start.',
    )
    expect(startWaiting(makeTable(TWO_HUMANS, ['ana', 'bob']), 1)).toBeNull()
  })
})

describe('StartBox.vue', () => {
  beforeEach(() => setActivePinia(createPinia()))

  test('before pressing: Start, and who the board waits for', async () => {
    const wrapper = mount(StartBox, { props: { table: makeTable(TWO_HUMANS, ['bob']), me: 1 } })

    expect(wrapper.text()).toContain('Ready to play?')
    expect(wrapper.text()).toContain('Waiting for you to press Start.')
    expect(wrapper.find('.start-cancel').exists()).toBe(false)
    expect(wrapper.find('.start-seats').exists()).toBe(false)

    await wrapper.get('.start-button').trigger('click')
    expect(wrapper.emitted('start')).toHaveLength(1)
  })

  test('after pressing: waiting for the others, with Cancel', async () => {
    const wrapper = mount(StartBox, { props: { table: makeTable(TWO_HUMANS, ['ana']), me: 1 } })

    expect(wrapper.text()).toContain('Waiting for the others…')
    expect(wrapper.text()).toContain('Waiting for East (bob) to press Start.')
    expect(wrapper.find('.start-button').exists()).toBe(false)

    await wrapper.get('.start-cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  test('the seats, marked, when the page asks for them', () => {
    const wrapper = mount(StartBox, {
      props: { table: makeTable({ N: 'robot-1', E: 'bob', S: 'ana' }, ['bob']), me: 1, showSeats: true },
    })

    const ready = wrapper.findAll('.start-seats li.is-ready').map((li) => li.attributes('data-seat'))
    expect(ready).toEqual(['N', 'E'])
    expect(wrapper.get('[data-seat="S"]').text()).toContain('S you')
    expect(wrapper.get('[data-seat="W"]').text()).toContain('W empty')
    expect(wrapper.text()).toContain('Waiting for a fourth player, and for you to press Start.')
  })
})

describe('tables store start', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    logIn()
    vi.mocked(tablesService.sendHeartbeat).mockResolvedValue(undefined)
  })

  afterEach(() => useTablesStore().unwatchTable())

  test('a Start that waits marks our seat', async () => {
    const store = useTablesStore()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(TWO_HUMANS))
    await store.loadTable(5)
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...makeTable(TWO_HUMANS, ['ana']), playing: null })

    await store.start(5)

    expect(tablesService.startTable).toHaveBeenCalledWith(5)
    expect(store.currentTable!.seats.find((s) => s.user_id === 1)!.ready).toBe(true)
    expect(store.currentTable).not.toHaveProperty('playing')
    expect(useGameStore().playing).toBeNull()
  })

  test('the Start that deals hands the new board to the game store', async () => {
    const store = useTablesStore()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(WITH_ROBOTS))
    await store.loadTable(5)
    const dealt = makeTable(WITH_ROBOTS, [], { board_id: 8 })
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...dealt, playing: stateOf(dealt) })

    await store.start(5)

    expect(store.currentTable!.board_id).toBe(8)
    const game = useGameStore()
    expect(game.tableId).toBe(5)
    expect(game.playing).toEqual(stateOf(dealt))
  })

  test('an answer a broadcast overtook is not applied', async () => {
    const store = useTablesStore()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(TWO_HUMANS))
    await store.loadTable(5)
    // Bob's Start lands while ours is on its way and deals the board; our
    // answer, from before his, still says we wait for him.
    const dealt = makeTable(TWO_HUMANS, [], { board_id: 8 })
    let answer!: (value: tablesService.StartedTable) => void
    vi.mocked(tablesService.startTable).mockReturnValue(new Promise((resolve) => (answer = resolve)))

    const request = store.start(5)
    pushUpdate(dealt)
    answer({ ...makeTable(TWO_HUMANS, ['ana']), playing: null })
    await request

    expect(store.currentTable!.board_id).toBe(8)
  })

  test('cancelStart takes our Start back', async () => {
    const store = useTablesStore()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(TWO_HUMANS, ['ana']))
    await store.loadTable(5)
    vi.mocked(tablesService.cancelStart).mockResolvedValue(makeTable(TWO_HUMANS))

    await store.cancelStart(5)

    expect(tablesService.cancelStart).toHaveBeenCalledWith(5)
    expect(store.currentTable!.seats.find((s) => s.user_id === 1)!.ready).toBe(false)
  })
})

describe('TableDetailPage.vue Start', () => {
  const modalStub = { template: '<div><slot /></div>' }

  async function mountPage(table: Table) {
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    const wrapper = mount(TableDetailPage, {
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    logIn()
    vi.mocked(tablesService.sendHeartbeat).mockResolvedValue(undefined)
  })

  afterEach(() => useTablesStore().unwatchTable())

  test('with three robots: Start deals and goes to the board', async () => {
    const wrapper = await mountPage(makeTable(WITH_ROBOTS))

    expect(wrapper.get('.start-box').text()).toContain('Waiting for you to press Start.')
    // Robots are marked ready on the compass; we aren't yet.
    for (const seat of ['n', 'e', 'w']) {
      expect(wrapper.get(`.seat-${seat}`).text()).toContain('Ready')
    }
    expect(wrapper.get('.seat-s').text()).not.toContain('Ready')

    const dealt = makeTable(WITH_ROBOTS, [], { board_id: 8 })
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...dealt, playing: stateOf(dealt) })
    await wrapper.get('.start-button').trigger('click')
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/tables/5/play', 'forward', 'push')
    // The board is already in hand, so the game page needs no GET for it.
    expect(useGameStore().playing?.playing_id).toBe(42)
    expect(gameService.getPlaying).not.toHaveBeenCalled()
  })

  test('two humans: the first Start waits live, the second deals for both', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS))
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...makeTable(TWO_HUMANS, ['ana']), playing: null })

    await wrapper.get('.start-button').trigger('click')
    await flushPromises()

    const box = wrapper.get('.start-box')
    expect(box.text()).toContain('Waiting for the others…')
    expect(box.text()).toContain('Waiting for East (bob) to press Start.')
    expect(box.find('.start-cancel').exists()).toBe(true)
    expect(wrapper.get('.seat-s').text()).toContain('Ready')
    expect(navigate).not.toHaveBeenCalled()

    // Bob's Start deals: we learn it from TableUpdated.
    pushUpdate(makeTable(TWO_HUMANS, [], { board_id: 8 }))
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/tables/5/play', 'forward', 'push')
  })

  test('Cancel takes the Start back', async () => {
    const wrapper = await mountPage(makeTable(TWO_HUMANS, ['ana']))
    vi.mocked(tablesService.cancelStart).mockResolvedValue(makeTable(TWO_HUMANS))

    await wrapper.get('.start-cancel').trigger('click')
    await flushPromises()

    expect(tablesService.cancelStart).toHaveBeenCalledWith(5)
    expect(wrapper.find('.start-button').exists()).toBe(true)
  })

  test('a newcomer at a table short of one sees Start', async () => {
    const wrapper = await mountPage(makeTable({ E: 'bob', S: 'ana', W: 'robot-3' }, ['bob']))

    expect(wrapper.get('.start-box').text()).toContain(
      'Waiting for a fourth player, and for you to press Start.',
    )
    expect(wrapper.get('.seat-e').text()).toContain('Ready')
  })

  test('no Start during a board, nor for somebody not seated here', async () => {
    const inPlay = makeTable(WITH_ROBOTS, [], { board_id: 8 })
    vi.mocked(gameService.getPlaying).mockResolvedValue(stateOf(inPlay))
    const playing = await mountPage(inPlay)
    expect(playing.find('.start-box').exists()).toBe(false)
    playing.unmount()

    setActivePinia(createPinia())
    logIn()
    const watching = await mountPage(makeTable({ N: 'robot-1', E: 'bob' }))
    expect(watching.find('.start-box').exists()).toBe(false)
  })
})
