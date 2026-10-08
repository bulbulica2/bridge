import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import BiddingBox from '@/components/BiddingBox.vue'
import { bidWith } from './biddingBox'
import AuctionHistory from '@/components/AuctionHistory.vue'
import OfflineRefresh from '@/components/OfflineRefresh.vue'
import TablePlayPage from '@/views/TablePlayPage.vue'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { AuctionCall, Bid, Playing, Strain } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useTablesStore } from '@/stores/tables'
import { showToast } from '@/utils/toast'

// The board chat has its own specs: its read never answers here.
vi.mock('@/services/chat', () => ({ getMessages: () => new Promise(() => {}), sendMessage: () => new Promise(() => {}) }))
vi.mock('@/services/game', () => ({ getPlaying: vi.fn(), getBids: vi.fn(), makeCall: vi.fn() }))
vi.mock('@/services/history', () => ({ getSet: vi.fn() }))
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
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
  useRoute: () => ({ params: { id: '5' } }),
}))
// Ionic's view hooks never fire outside a router outlet: run the page's
// "will enter" on mount, as the outlet would.
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate: vi.fn() }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})

// Ids run against the rank on purpose: nothing may lean on them.
const CODES = ['P', 'X', 'XX']
for (const level of [1, 2, 3, 4, 5, 6, 7]) {
  for (const strain of ['C', 'D', 'H', 'S', 'NT']) {
    CODES.push(`${level}${strain}`)
  }
}

function bid(call: string): Bid {
  const id = 100 - CODES.indexOf(call)
  const match = /^(\d)(C|D|H|S|NT)$/.exec(call)
  return match
    ? { id, call, level: Number(match[1]), strain: match[2] as Strain, special: false }
    : { id, call, level: null, strain: null, special: true }
}

const BIDS = CODES.map(bid)

function calls(written: string): AuctionCall[] {
  return written
    ? written.split(', ').map((made) => {
        const [seat, call] = made.split(' ')
        return { seat: seat as Seat, bid: bid(call) }
      })
    : []
}

const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null },
  E: { id: 2, name: 'Bob', username: 'bob', description: null },
  S: { id: 3, name: 'Cy', username: 'cy', description: null },
  W: { id: 4, name: 'Di', username: 'di', description: null },
}

describe('BiddingBox', () => {
  function mountBox(auction: string, seat: Seat = 'S', busy = false) {
    return mount(BiddingBox, { props: { bids: BIDS, auction: calls(auction), seat, busy } })
  }

  const level = (wrapper: VueWrapper, n: number) => wrapper.get(`button[data-level="${n}"]`)
  const strain = (wrapper: VueWrapper, s: string) => wrapper.get(`button[data-strain="${s}"]`)
  const special = (wrapper: VueWrapper, call: string) => wrapper.get(`button[data-call="${call}"]`)
  const confirm = (wrapper: VueWrapper) => wrapper.get('.confirm-call')
  const disabled = (button: { element: Element }) => (button.element as HTMLButtonElement).disabled

  function open(wrapper: VueWrapper, selector: string, key: string) {
    return wrapper
      .findAll(selector)
      .filter((b) => !disabled(b))
      .map((b) => b.attributes(key))
  }

  test('lays out levels 1-7, then the five strains, then Pass, X, XX and Alert', () => {
    const wrapper = mountBox('')

    expect(wrapper.findAll('.levels button').map((b) => b.text())).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(wrapper.findAll('.strains button').map((b) => b.text())).toEqual(['♣', '♦', '♥', '♠', 'NT'])
    expect(wrapper.findAll('.specials button').map((b) => b.text())).toEqual(['Pass', 'X', 'XX', '! Alert'])
    // Nothing picked: the confirm waits, grey.
    expect(confirm(wrapper).text()).toBe('Pick a level, then a suit')
    expect(disabled(confirm(wrapper))).toBe(true)
  })

  test('opens with every level and Pass, no X or XX, and no strain until a level is picked', () => {
    const wrapper = mountBox('')

    expect(open(wrapper, 'button[data-level]', 'data-level')).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(open(wrapper, 'button[data-strain]', 'data-strain')).toEqual([])
    expect(open(wrapper, 'button[data-call]', 'data-call')).toEqual(['P'])
    expect(strain(wrapper, 'C').attributes('aria-label')).toBe('Clubs')
    expect(strain(wrapper, 'NT').attributes('aria-label')).toBe('No trump')
  })

  test('a level and a strain preview the bid; only the confirm sends it', async () => {
    const wrapper = mountBox('N 1H, E P')

    await level(wrapper, 2).trigger('click')
    expect(level(wrapper, 2).classes()).toContain('on')
    expect(level(wrapper, 2).attributes('aria-pressed')).toBe('true')
    expect(confirm(wrapper).text()).toBe('Pick a level, then a suit')
    await strain(wrapper, 'H').trigger('click')
    expect(strain(wrapper, 'H').classes()).toContain('on')
    expect(wrapper.emitted('call')).toBeUndefined()

    expect(confirm(wrapper).text()).toBe('Bid 2♥')
    expect(confirm(wrapper).attributes('data-picked')).toBe('2H')
    await confirm(wrapper).trigger('click')
    expect(wrapper.emitted('call')).toEqual([[bid('2H')]])
  })

  test('Pass, X and XX preview in words and need the confirm too', async () => {
    const pass = mountBox('N 1H, E P')
    await special(pass, 'P').trigger('click')
    expect(confirm(pass).text()).toBe('Pass')
    await confirm(pass).trigger('click')
    expect(pass.emitted('call')).toEqual([[bid('P')]])

    const double = mountBox('W 2D', 'N')
    await special(double, 'X').trigger('click')
    expect(special(double, 'X').classes()).toContain('on')
    expect(confirm(double).text()).toBe('Double')

    const redouble = mountBox('N 2D, E X', 'S')
    await special(redouble, 'XX').trigger('click')
    expect(confirm(redouble).text()).toBe('Redouble')
    await confirm(redouble).trigger('click')
    expect(redouble.emitted('call')).toEqual([[bid('XX')]])
  })

  test('picking one kind of call drops the other', async () => {
    const wrapper = mountBox('N 1H, E P')

    await level(wrapper, 3).trigger('click')
    await strain(wrapper, 'C').trigger('click')
    await special(wrapper, 'P').trigger('click')
    expect(level(wrapper, 3).classes()).not.toContain('on')
    expect(confirm(wrapper).text()).toBe('Pass')

    await level(wrapper, 3).trigger('click')
    expect(special(wrapper, 'P').classes()).not.toContain('on')
    expect(confirm(wrapper).text()).toBe('Pick a level, then a suit')
    await strain(wrapper, 'NT').trigger('click')
    expect(confirm(wrapper).text()).toBe('Bid 3NT')
  })

  test('levels with no legal strain and strains too low at the picked level are disabled', async () => {
    // 1♥ bid: at level 1 only ♠ and NT are left.
    const wrapper = mountBox('N 1H, E P')

    await level(wrapper, 1).trigger('click')
    expect(open(wrapper, 'button[data-strain]', 'data-strain')).toEqual(['S', 'NT'])
    expect(strain(wrapper, 'C').attributes('aria-label')).toBe('Clubs, too low')
    expect(strain(wrapper, 'S').attributes('aria-label')).toBe('1 spade')
    await level(wrapper, 2).trigger('click')
    expect(open(wrapper, 'button[data-strain]', 'data-strain')).toEqual(['C', 'D', 'H', 'S', 'NT'])

    // After 7♠ only 7NT is left; after 7NT no level at all.
    const high = mountBox('N 7S')
    expect(open(high, 'button[data-level]', 'data-level')).toEqual(['7'])
    expect(open(mountBox('N 7NT'), 'button[data-level]', 'data-level')).toEqual([])
  })

  test('a strain picked at one level stays at another only while it is legal there', async () => {
    const wrapper = mountBox('N 1H, E P')

    await level(wrapper, 2).trigger('click')
    await strain(wrapper, 'C').trigger('click')
    await level(wrapper, 3).trigger('click')
    expect(confirm(wrapper).text()).toBe('Bid 3♣')
    await level(wrapper, 1).trigger('click')
    expect(strain(wrapper, 'C').classes()).not.toContain('on')
    expect(confirm(wrapper).text()).toBe('Pick a level, then a suit')
  })

  test('the pick starts over on a new state, and once a call settles', async () => {
    const wrapper = mountBox('N 1H, E P')

    await level(wrapper, 2).trigger('click')
    await strain(wrapper, 'S').trigger('click')
    await wrapper.setProps({ auction: calls('N 1H, E 2C') })
    expect(confirm(wrapper).text()).toBe('Pick a level, then a suit')
    expect(level(wrapper, 2).classes()).not.toContain('on')

    // Sent, then refused (busy goes back off with the state unchanged).
    await level(wrapper, 2).trigger('click')
    await strain(wrapper, 'S').trigger('click')
    await wrapper.setProps({ busy: true })
    await wrapper.setProps({ busy: false })
    expect(confirm(wrapper).text()).toBe('Pick a level, then a suit')
  })

  test('while a call is on its way, nothing can be clicked', async () => {
    const wrapper = mountBox('N 1H, E P')
    await level(wrapper, 2).trigger('click')
    await strain(wrapper, 'C').trigger('click')
    await wrapper.setProps({ busy: true })

    expect(wrapper.findAll('button').filter((b) => !disabled(b))).toEqual([])
    expect(confirm(wrapper).text()).toContain('Sending your call')
    await confirm(wrapper).trigger('click')
    expect(wrapper.emitted('call')).toBeUndefined()
  })
})

describe('AuctionHistory', () => {
  const board = { id: 7, number: 7, dealer: 'E' as Seat, vulnerable: 'N-S' as const }

  test("South reads W N E S, starting in the dealer's column", () => {
    const wrapper = mount(AuctionHistory, {
      props: { auction: calls('E 1H, S P, W 2C'), board, mySeat: 'S', turn: 'N', players: PLAYERS },
    })

    expect(wrapper.findAll('th .seat').map((th) => th.text())).toEqual(['W', 'N', 'E', 'S'])
    expect(wrapper.findAll('th .player').map((th) => th.text())).toEqual(['di', 'ann', 'bob', 'cy'])
    const cells = wrapper.findAll('tbody tr').map((tr) => tr.findAll('td').map((td) => td.text()))
    expect(cells).toEqual([
      ['', '', '1♥', 'Pass'],
      ['2♣', '?', '', ''],
    ])
  })

  test('the viewer is always the last column', () => {
    const wrapper = mount(AuctionHistory, {
      props: { auction: calls('E 1NT'), board, mySeat: 'N' },
    })

    expect(wrapper.findAll('th .seat').map((th) => th.text())).toEqual(['E', 'S', 'W', 'N'])
    expect(wrapper.findAll('tbody td').map((td) => td.text())).toEqual(['1NT', '', '', ''])
  })
})

describe('TablePlayPage bidding', () => {
  const table: Table = {
    id: 5,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: 7,
    created_at: '',
    updated_at: '',
    seats: (['N', 'E', 'S', 'W'] as Seat[]).map((seat, i) => ({
      id: i + 1,
      table_id: 5,
      user_id: PLAYERS[seat].id,
      seat,
      user: PLAYERS[seat],
    })),
    free_seats: [],
    can_manage: false,
  }

  // The user is Cy, South; North deals.
  function state(overrides: Partial<Playing> = {}): Playing {
    return {
      phase: 'auction',
      playing_id: 42,
      board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
      players: PLAYERS,
      turn: 'S',
      acting_user_id: 3,
      auction: calls('N 1H, E P'),
      contract: null,
      tricks: null,
      current_trick: null,
      tricks_won: null,
      dummy_hand: null,
      result: null,
      deal: null,
      ready: null,
      my_seat: 'S',
      hand: [],
      ...overrides,
    }
  }

  function refused(message: string) {
    const config = { headers: new AxiosHeaders() }
    const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
    error.response = { status: 409, data: { status: 409, message, data: [] }, statusText: '', headers: {}, config }
    return error
  }

  const modalStub = { template: '<div><slot /></div>' }

  async function mountPage(playing: Playing) {
    vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
    const wrapper = mount(TablePlayPage, {
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    vi.mocked(gameService.getBids).mockResolvedValue(BIDS)
  })

  test('on our turn the box sends the call and shows the new state', async () => {
    const wrapper = await mountPage(state())
    let answer!: (state: Playing) => void
    vi.mocked(gameService.makeCall).mockReturnValue(new Promise((resolve) => (answer = resolve)))

    await bidWith(wrapper, '2C')
    // Busy: a second click goes nowhere.
    await wrapper.get('.confirm-call').trigger('click')
    expect(gameService.makeCall).toHaveBeenCalledTimes(1)
    expect(gameService.makeCall).toHaveBeenCalledWith(5, bid('2C').id, null)
    expect(wrapper.text()).toContain('Sending your call')

    answer(state({ turn: 'W', acting_user_id: 4, auction: calls('N 1H, E P, S 2C') }))
    await flushPromises()

    expect(wrapper.find('.bidding-box').exists()).toBe(false)
    expect(wrapper.get('.turn-line-text').text()).toBe('Waiting for West')
    expect(wrapper.findAll('.auction td').map((td) => td.text())).toContain('2♣')
  })

  test('entering a table the store follows live reads only the board, then the bids', async () => {
    // As right after Create or a join: the table is held and its channel followed.
    const tables = useTablesStore()
    tables.currentTable = table
    tables.watchTable(5)

    const wrapper = await mountPage(state())

    expect(tablesService.getTable).not.toHaveBeenCalled()
    expect(gameService.getPlaying).toHaveBeenCalledTimes(1)
    expect(gameService.getBids).toHaveBeenCalledTimes(1)
    expect(vi.mocked(gameService.getBids).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(gameService.getPlaying).mock.invocationCallOrder[0],
    )
    expect(wrapper.find('.bidding-box').exists()).toBe(true)

    // Refresh (offered once live updates are off) is the user asking:
    // everything is read again.
    await wrapper.findComponent(OfflineRefresh).vm.$emit('refresh')
    await flushPromises()
    expect(tablesService.getTable).toHaveBeenCalledWith(5)
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    tables.unwatchTable()
  })

  test("the box stays hidden when it isn't our turn", async () => {
    const wrapper = await mountPage(state({ turn: 'W', acting_user_id: 4 }))

    expect(wrapper.find('.bidding-box').exists()).toBe(false)
    expect(wrapper.find('.auction').exists()).toBe(true)
  })

  test("a refused call shows the backend's reason and rereads the board", async () => {
    const wrapper = await mountPage(state())
    vi.mocked(gameService.makeCall).mockRejectedValue(refused('It is not your turn: W calls next.'))
    vi.mocked(gameService.getPlaying).mockResolvedValue(state({ turn: 'W', acting_user_id: 4 }))

    await bidWith(wrapper, 'P')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('It is not your turn: W calls next.', 'danger')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.bidding-box').exists()).toBe(false)
  })

  test('the contract corner: the contract and the tricks, no declarer/dummy line', async () => {
    const wrapper = await mountPage(
      state({
        phase: 'play',
        turn: 'E',
        acting_user_id: 2,
        auction: calls('N 4S, E X, S P, W P, N P'),
        contract: { bid: bid('4S'), doubled: 1, declarer: 'N', dummy: 'S' },
        tricks_won: { ns: 0, ew: 0 },
      }),
    )

    const contract = wrapper.get('.bridge-table .corner-top-right')
    expect(contract.get('.contract-line').text().replace(/\s+/g, ' ')).toBe('4♠X by North')
    expect(contract.findAll('.tricks-won span').map((s) => s.text())).toEqual(['NS 0', '·', 'EW 0'])
    expect(contract.text()).not.toContain('Declarer')
    expect(contract.text()).not.toContain('Dummy')
    expect(wrapper.find('.contract-you').exists()).toBe(false)
    expect(wrapper.find('.bidding-box').exists()).toBe(false)
  })

  test('a passed out board says so and waits for the next one', async () => {
    const wrapper = await mountPage(
      state({
        phase: 'finished',
        turn: null,
        acting_user_id: null,
        auction: calls('N P, E P, S P, W P'),
        result: { contract: null, doubled: null, declarer: null, tricks_won: null, score_ns: 0, made_by: null },
        ready: [],
      }),
    )

    expect(wrapper.get('.dialog-contract').text()).toBe('Passed out')
    expect(wrapper.get('.dialog-score').text()).toBe('0')
    expect(wrapper.find('.vote-button').exists()).toBe(true)
    expect(wrapper.find('.bidding-box').exists()).toBe(false)
  })

  test('the last call, seen live, is announced', async () => {
    await mountPage(state({ turn: 'W', acting_user_id: 4 }))
    const { useGameStore } = await import('@/stores/game')
    // PlayingUpdated carries no hand or seat; the store keeps ours.
    const ended = state({
      phase: 'play',
      turn: 'S',
      acting_user_id: 3,
      auction: calls('N 1H, E P, S P, W P'),
      contract: { bid: bid('1H'), doubled: 0, declarer: 'N', dummy: 'S' },
    })

    useGameStore().applyPlayingUpdate(5, ended)
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('Contract: 1♥ by North.', 'success')
  })
})
