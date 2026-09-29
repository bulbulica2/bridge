import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import BiddingBox from '@/components/BiddingBox.vue'
import AuctionHistory from '@/components/AuctionHistory.vue'
import TablePlayPage from '@/views/TablePlayPage.vue'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { AuctionCall, Bid, Playing, Strain } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { showToast } from '@/utils/toast'

vi.mock('@/services/game', () => ({ getPlaying: vi.fn(), getBids: vi.fn(), makeCall: vi.fn() }))
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

  function button(wrapper: VueWrapper, call: string) {
    return wrapper.get(`button[data-call="${call}"]`)
  }

  function enabled(wrapper: VueWrapper) {
    return wrapper
      .findAll('button')
      .filter((b) => !(b.element as HTMLButtonElement).disabled)
      .map((b) => b.attributes('data-call'))
  }

  test('lays out 7 levels of ♣ ♦ ♥ ♠ NT, then Pass, X and XX', () => {
    const wrapper = mountBox('')

    const rows = wrapper.findAll('.level').map((row) => row.findAll('button').map((b) => b.text()))
    expect(rows).toHaveLength(7)
    expect(rows[0]).toEqual(['1♣', '1♦', '1♥', '1♠', '1NT'])
    expect(rows[6]).toEqual(['7♣', '7♦', '7♥', '7♠', '7NT'])
    expect(wrapper.findAll('.special').map((b) => b.text())).toEqual(['Pass', 'X', 'XX'])
  })

  test('opens with every bid and Pass, but no X or XX', () => {
    const wrapper = mountBox('')

    expect(enabled(wrapper)).toHaveLength(36)
    expect((button(wrapper, 'X').element as HTMLButtonElement).disabled).toBe(true)
    expect((button(wrapper, 'XX').element as HTMLButtonElement).disabled).toBe(true)
  })

  test("disables bids at or below the last one, and X on partner's bid", () => {
    const wrapper = mountBox('N 1H, E P')

    expect(enabled(wrapper)).toEqual(['1S', '1NT', ...CODES.slice(8), 'P'])
  })

  test("offers X on an opponent's bid, then XX to the doubled side", () => {
    expect(enabled(mountBox('W 2D', 'N'))).toContain('X')

    const redouble = enabled(mountBox('N 2D, E X', 'S'))
    expect(redouble).toContain('XX')
    expect(redouble).not.toContain('X')
  })

  test('sends the bid that was clicked', async () => {
    const wrapper = mountBox('N 1H, E P')

    await button(wrapper, '2C').trigger('click')
    await button(wrapper, 'P').trigger('click')

    expect(wrapper.emitted('call')).toEqual([[bid('2C')], [bid('P')]])
  })

  test('while a call is on its way, nothing can be clicked', async () => {
    const wrapper = mountBox('', 'S', true)

    expect(enabled(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('Sending your call')
    await button(wrapper, '1C').trigger('click')
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

    await wrapper.get('button[data-call="2C"]').trigger('click')
    // Busy: a second click goes nowhere.
    await wrapper.get('button[data-call="3C"]').trigger('click')
    expect(gameService.makeCall).toHaveBeenCalledTimes(1)
    expect(gameService.makeCall).toHaveBeenCalledWith(5, bid('2C').id)
    expect(wrapper.text()).toContain('Sending your call')

    answer(state({ turn: 'W', acting_user_id: 4, auction: calls('N 1H, E P, S 2C') }))
    await flushPromises()

    expect(wrapper.find('.bidding-box').exists()).toBe(false)
    expect(wrapper.text()).toContain('Auction: waiting for di.')
    expect(wrapper.findAll('.auction td').map((td) => td.text())).toContain('2♣')
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

    await wrapper.get('button[data-call="P"]').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('It is not your turn: W calls next.', 'danger')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.bidding-box').exists()).toBe(false)
  })

  test('announces the contract with declarer and dummy', async () => {
    const wrapper = await mountPage(
      state({
        phase: 'play',
        turn: 'E',
        acting_user_id: 2,
        auction: calls('N 4S, E X, S P, W P, N P'),
        contract: { bid: bid('4S'), doubled: 1, declarer: 'N', dummy: 'S' },
      }),
    )

    const outcome = wrapper.get('.outcome').text().replace(/\s+/g, ' ')
    expect(outcome).toContain('4♠ doubled by North')
    expect(outcome).toContain('Declarer North (ann) · Dummy South (you)')
    expect(wrapper.find('.bidding-box').exists()).toBe(false)
  })

  test('a passed out board says so and waits for the next one', async () => {
    const wrapper = await mountPage(
      state({ phase: 'finished', turn: null, acting_user_id: null, auction: calls('N P, E P, S P, W P') }),
    )

    expect(wrapper.get('.outcome').text()).toContain('Passed out')
    expect(wrapper.text()).toContain('Waiting for the next board')
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
