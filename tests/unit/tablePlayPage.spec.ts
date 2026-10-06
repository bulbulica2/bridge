import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { IonRefresher } from '@ionic/vue'
import { pullToRefresh } from './ionEvents'
import TablePlayPage from '@/views/TablePlayPage.vue'
import BiddingBox from '@/components/BiddingBox.vue'
import BoardReviewModal from '@/components/BoardReviewModal.vue'
import ClaimPanel from '@/components/ClaimPanel.vue'
import NextBoardBox from '@/components/NextBoardBox.vue'
import SeatPlayerSheet from '@/components/SeatPlayerSheet.vue'
import StartBox from '@/components/StartBox.vue'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Bid, Card, Playing, Seat, Suit } from '@/services/game'
import type { Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'
import { OFFLINE_GRACE_MS } from '@/composables/useLiveStatus'
import { resetLiveStatus, setConnection, setSubscribed } from '@/services/liveStatus'
import { confirmLeave, confirmRemove } from '@/utils/seatMove'
import { showToast } from '@/utils/toast'

// The play page's ways out and its failure paths; the game itself (bidding,
// play, claims, the result) has its own specs.
// The board chat has its own specs: its read never answers here.
vi.mock('@/services/chat', () => ({ getMessages: () => new Promise(() => {}), sendMessage: () => new Promise(() => {}) }))
vi.mock('@/services/game', () => ({
  getPlaying: vi.fn(),
  getBids: vi.fn(),
  makeCall: vi.fn(),
  playCard: vi.fn(),
  nextBoard: vi.fn(),
  makeClaim: vi.fn(),
  respondToClaim: vi.fn(),
  withdrawClaim: vi.fn(),
}))
vi.mock('@/services/history', () => ({ getMyPlayings: vi.fn(), getSet: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
  cancelStart: vi.fn(),
  sendHeartbeat: vi.fn(),
  seatRobot: vi.fn(),
  seatUser: vi.fn(),
  joinSeat: vi.fn(),
  removePlayer: vi.fn(),
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
  confirmLeave: vi.fn(),
  confirmRemove: vi.fn(),
}))
const { navigate, route } = vi.hoisted(() => ({
  navigate: vi.fn(),
  route: { params: { id: '5' } as Record<string, string> },
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
  }
})

function axiosError(status: number, message = 'Refused.'): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message }, statusText: '', headers: {}, config }
  return error
}

const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null, is_robot: false },
  E: { id: 2, name: 'Bob', username: 'bob', description: null, is_robot: false },
  S: { id: 3, name: 'Cy', username: 'cy', description: null, is_robot: false },
  W: { id: 4, name: 'Di', username: 'di', description: null, is_robot: false },
}

function hand(seat: Seat): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C']
  const offset = ['N', 'E', 'S', 'W'].indexOf(seat)
  return Array.from({ length: 13 }, (_, i) => {
    const n = offset * 13 + i
    return { id: n + 1, suit: suits[Math.floor(n / 13)], rank: 2 + (n % 13), rank_name: '' }
  })
}

function makeTable(overrides: Partial<Table> = {}): Table {
  const seated: Seat[] = ['N', 'E', 'S', 'W']
  return {
    id: 5,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: 7,
    unattended_since: null,
    created_at: '',
    updated_at: '',
    seats: seated.map((seat, i) => ({
      id: i + 1,
      table_id: 5,
      user_id: PLAYERS[seat].id,
      seat,
      ready: false,
      user: PLAYERS[seat],
    })),
    free_seats: [],
    set: null,
    can_manage: false,
    ...overrides,
  }
}

const pass = { id: 1, call: 'P', level: null, strain: null } as unknown as Bid

// The user is South (Cy) in the auction, on turn.
function auction(overrides: Partial<Playing> = {}): Playing {
  return {
    phase: 'auction',
    playing_id: 42,
    set: null,
    board: { id: 7, number: 7, dealer: 'S', vulnerable: '' },
    players: PLAYERS,
    turn: 'S',
    acting_user_id: 3,
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
    hand: hand('S'),
    ...overrides,
  } as Playing
}

function finished(): Playing {
  return auction({
    phase: 'finished',
    turn: null,
    acting_user_id: null,
    result: { contract: null, declarer: null, tricks: null, score_ns: 0, claimed: false } as unknown as Playing['result'],
    deal: { N: hand('N'), E: hand('E'), S: hand('S'), W: hand('W') },
    ready: [],
    hand: [],
  })
}

const modalStub = { template: '<div><slot /></div>' }

async function mountPage(playing: Playing | Error, table: Table = makeTable()) {
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

async function emitFrom(wrapper: VueWrapper, component: object, event: string, ...args: unknown[]) {
  wrapper.findComponent(component).vm.$emit(event, ...args)
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  route.params = { id: '5' }
  useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
  vi.mocked(gameService.getBids).mockResolvedValue([pass])
})

describe('TablePlayPage loading', () => {
  test('a nonsense id is a dead table', async () => {
    route.params = { id: '-1' }
    const wrapper = await mountPage(auction())

    expect(gameService.getPlaying).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('This table no longer exists.')
  })

  test('a 404 is a table that no longer exists', async () => {
    const wrapper = await mountPage(axiosError(404))

    expect(wrapper.text()).toContain('This table no longer exists.')
  })

  test('a 403 means the user does not sit here', async () => {
    const wrapper = await mountPage(axiosError(403))

    expect(wrapper.text()).toContain("You don't sit at this table, so you can't see its board.")
  })

  test('a 401 sends the user to log in', async () => {
    await mountPage(axiosError(401))

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })

  test('another failure shows an error', async () => {
    const wrapper = await mountPage(new Error('offline'))

    expect(wrapper.text()).toContain('Could not load the board. Please try again.')
  })

  test('a bidding box that failed to load offers to try again', async () => {
    vi.mocked(gameService.getBids).mockRejectedValueOnce(new Error('offline'))
    const wrapper = await mountPage(auction())
    expect(wrapper.find('.bids-missing').text()).toContain('Could not load the bidding box.')

    await wrapper.find('.bids-missing ion-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.bids-missing').exists()).toBe(false)
    expect(wrapper.findComponent(BiddingBox).exists()).toBe(true)
  })

  test('pull to refresh reloads and completes the refresher', async () => {
    const wrapper = await mountPage(auction())
    const complete = vi.fn()

    await pullToRefresh(wrapper, complete)

    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalled()
  })

  test('a kick sends the user back to the list', async () => {
    await mountPage(auction())

    useTablesStore().kickedFrom = 5
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })

  test('an auction that passes out live says so', async () => {
    await mountPage(auction())

    useGameStore().applyPlayingUpdate(5, finished())
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('Passed out: nobody bid.', 'warning')
  })
})

describe('TablePlayPage vulnerability label', () => {
  const label = (wrapper: VueWrapper) => wrapper.get('.board-bar .vul-label')

  test('in the auction: our side, in red', async () => {
    const wrapper = await mountPage(auction({ board: { id: 7, number: 7, dealer: 'S', vulnerable: 'N-S' } }))

    expect(label(wrapper).text()).toBe('Vulnerable: N-S (you)')
    expect(label(wrapper).classes()).toContain('vul-label-red')
    // The table's centre uses the same words.
    expect(wrapper.get('.board-line + .board-line').text()).toBe('Vulnerable: N-S (you)')
  })

  test('in the play: the other side, still in red, above the trick', async () => {
    const wrapper = await mountPage(
      auction({
        phase: 'play',
        board: { id: 7, number: 7, dealer: 'S', vulnerable: 'E-W' },
        turn: 'W',
        acting_user_id: 4,
        contract: {
          bid: { id: 20, call: null, level: 4, strain: 'S' } as unknown as Bid,
          doubled: 0,
          declarer: 'S',
          dummy: 'N',
        },
        tricks: [],
        current_trick: [],
        tricks_won: { ns: 0, ew: 0 },
      }),
    )

    expect(label(wrapper).text()).toBe('Vulnerable: E-W')
    expect(label(wrapper).classes()).toContain('vul-label-red')
  })

  test('once finished: both sides, us too', async () => {
    const wrapper = await mountPage({
      ...finished(),
      board: { id: 7, number: 7, dealer: 'S', vulnerable: 'N-S E-W' },
    })

    expect(label(wrapper).text()).toBe('Vulnerable: Both (you too)')
  })

  test('nobody vulnerable is green, beside the set', async () => {
    const set = { id: 9, number: 1, board: 2, of: 4, finished: false } as Playing['set']
    const wrapper = await mountPage(auction({ set }))

    expect(label(wrapper).text()).toBe('Vulnerable: None')
    expect(label(wrapper).classes()).toContain('vul-label-green')
    expect(wrapper.get('.board-bar .set-bar').text()).toBe('Board 2 of 4 · Set 1')
  })

  test('nothing dealt yet: no label', async () => {
    const wrapper = await mountPage(auction({ phase: 'waiting', board: null, turn: null, hand: [] }))

    expect(wrapper.find('.vul-label').exists()).toBe(false)
  })
})

describe('TablePlayPage refused moves', () => {
  test('a 403 means the seat is gone', async () => {
    const wrapper = await mountPage(auction())
    vi.mocked(gameService.makeCall).mockRejectedValue(axiosError(403))

    await emitFrom(wrapper, BiddingBox, 'call', pass)

    expect(wrapper.text()).toContain("You don't sit at this table")
  })

  test('a 404 means the table is gone', async () => {
    const wrapper = await mountPage(auction())
    vi.mocked(gameService.makeCall).mockRejectedValue(axiosError(404))

    await emitFrom(wrapper, BiddingBox, 'call', pass)

    expect(wrapper.text()).toContain('This table no longer exists.')
  })

  test('a 401 sends the user to log in', async () => {
    const wrapper = await mountPage(auction())
    vi.mocked(gameService.makeCall).mockRejectedValue(axiosError(401))

    await emitFrom(wrapper, BiddingBox, 'call', pass)

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })

  test('a 422 rereads the bid list, then the board', async () => {
    const wrapper = await mountPage(auction())
    vi.mocked(gameService.makeCall).mockRejectedValue(axiosError(422, 'The selected bid id is invalid.'))

    await emitFrom(wrapper, BiddingBox, 'call', pass)

    expect(showToast).toHaveBeenCalledWith('The selected bid id is invalid.', 'danger')
    expect(gameService.getBids).toHaveBeenCalledTimes(2)
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
  })
})

describe('TablePlayPage claims and Start', () => {
  test('the claimer withdraws, and a refusal is told', async () => {
    const claimed = auction({
      phase: 'play',
      contract: { bid: pass, doubled: 0, declarer: 'S', dummy: 'N' } as unknown as Playing['contract'],
      tricks: [],
      current_trick: [],
      tricks_won: { ns: 0, ew: 0 },
      dummy_hand: hand('N'),
      claim: { seat: 'S', tricks: 13, hand: hand('S'), accepted: [] },
    })
    const wrapper = await mountPage(claimed)
    vi.mocked(gameService.withdrawClaim).mockResolvedValue({ ...claimed, claim: null })

    await emitFrom(wrapper, ClaimPanel, 'withdraw')
    expect(gameService.withdrawClaim).toHaveBeenCalledWith(5)

    useGameStore().applyPlayingUpdate(5, claimed)
    await flushPromises()
    vi.mocked(gameService.withdrawClaim).mockRejectedValue(new Error('offline'))
    await emitFrom(wrapper, ClaimPanel, 'withdraw')
    expect(showToast).toHaveBeenCalledWith('Your claim could not be withdrawn. Please try again.', 'danger')
  })

  test('takes a Start back, and tells a refusal', async () => {
    const waiting = auction({ phase: 'waiting', board: null, turn: null, acting_user_id: null, hand: [] })
    const table = makeTable({ board_id: null })
    table.seats[2].ready = true
    const wrapper = await mountPage(waiting, table)
    vi.mocked(tablesService.cancelStart).mockResolvedValue({ ...table, seats: table.seats.map((s) => ({ ...s, ready: false })) })

    await emitFrom(wrapper, StartBox, 'cancel')
    expect(tablesService.cancelStart).toHaveBeenCalledWith(5)

    vi.mocked(tablesService.cancelStart).mockRejectedValue(axiosError(409, 'The board is dealt.'))
    await emitFrom(wrapper, StartBox, 'cancel')
    expect(showToast).toHaveBeenCalledWith('The board is dealt.', 'danger')
  })
})

// Left alone after the other three were freed (#117): a manager fills the
// empty seats without leaving the game table.
describe('TablePlayPage filling empty seats', () => {
  const waiting = () => auction({ phase: 'waiting', board: null, turn: null, acting_user_id: null, hand: [] })

  // Only the user (Cy, South) is left.
  function alone(canManage: boolean): Table {
    const table = makeTable({ board_id: null, moderated_by: 3, can_manage: canManage })
    return { ...table, seats: table.seats.filter((s) => s.seat === 'S'), free_seats: ['N', 'E', 'W'] }
  }

  function withSeat(table: Table, seat: Seat, user: Table['seats'][number]['user']): Table {
    return {
      ...table,
      seats: [...table.seats, { id: 9, table_id: 5, user_id: user.id, seat, ready: user.is_robot, user }],
      free_seats: table.free_seats.filter((s) => s !== seat),
    }
  }

  const robot = { id: 90, name: 'Robot', username: 'robot-1', description: null, is_robot: true }

  test('a manager gets Seat a player and Add robot per empty seat', async () => {
    const wrapper = await mountPage(waiting(), alone(true))

    const box = wrapper.findComponent(StartBox)
    expect(box.props('manage')).toBe(true)
    expect(wrapper.findAll('.start-fill li').map((li) => li.attributes('data-fill-seat'))).toEqual(['N', 'E', 'W'])
  })

  test('nobody else gets them', async () => {
    const wrapper = await mountPage(waiting(), alone(false))

    expect(wrapper.findComponent(StartBox).props('manage')).toBe(false)
    expect(wrapper.find('.start-fill').exists()).toBe(false)
  })

  test('Add robot seats one and says so', async () => {
    const table = alone(true)
    const wrapper = await mountPage(waiting(), table)
    vi.mocked(tablesService.seatRobot).mockResolvedValue(withSeat(table, 'N', robot))

    await emitFrom(wrapper, StartBox, 'addRobot', 'N')

    expect(tablesService.seatRobot).toHaveBeenCalledWith(5, 'N')
    expect(showToast).toHaveBeenCalledWith('A robot now sits at N.', 'success')
    expect(wrapper.find('[data-fill-seat="N"]').exists()).toBe(false)
  })

  test('one seat at a time', async () => {
    const wrapper = await mountPage(waiting(), alone(true))
    vi.mocked(tablesService.seatRobot).mockReturnValue(new Promise(() => {}))

    await emitFrom(wrapper, StartBox, 'addRobot', 'N')
    expect(wrapper.findComponent(StartBox).props('fillingSeat')).toBe('N')
    await emitFrom(wrapper, StartBox, 'addRobot', 'E')

    expect(tablesService.seatRobot).toHaveBeenCalledTimes(1)
  })

  test('Seat a player opens the search, and the pick is seated', async () => {
    const table = alone(true)
    const wrapper = await mountPage(waiting(), table)
    const ann = { id: 1, name: 'Ann', username: 'ann', seated: false }
    vi.mocked(tablesService.seatUser).mockResolvedValue(withSeat(table, 'E', PLAYERS.N))

    await emitFrom(wrapper, StartBox, 'seatPlayer', 'E')
    expect(wrapper.findComponent(SeatPlayerSheet).props('seat')).toBe('E')
    await emitFrom(wrapper, SeatPlayerSheet, 'select', ann)

    expect(tablesService.seatUser).toHaveBeenCalledWith(5, 1, 'E')
    expect(showToast).toHaveBeenCalledWith('ann now sits at E.', 'success')
    expect(wrapper.findComponent(SeatPlayerSheet).props('seat')).toBeNull()
  })

  test('picking yourself moves you to that seat', async () => {
    const table = alone(true)
    const wrapper = await mountPage(waiting(), table)
    vi.mocked(tablesService.joinSeat).mockResolvedValue({
      ...table,
      seats: table.seats.map((s) => ({ ...s, seat: 'W' as Seat })),
    })

    await emitFrom(wrapper, StartBox, 'seatPlayer', 'W')
    await emitFrom(wrapper, SeatPlayerSheet, 'select', { id: 3, name: 'Cy', username: 'cy', seated: true })

    expect(tablesService.joinSeat).toHaveBeenCalledWith(5, 'W')
    expect(showToast).toHaveBeenCalledWith('You now sit at W.', 'success')
  })

  test('a pick after the search closed seats nobody', async () => {
    const wrapper = await mountPage(waiting(), alone(true))

    await emitFrom(wrapper, StartBox, 'seatPlayer', 'E')
    await emitFrom(wrapper, SeatPlayerSheet, 'close')
    await emitFrom(wrapper, SeatPlayerSheet, 'select', { id: 1, name: 'Ann', username: 'ann', seated: false })

    expect(tablesService.seatUser).not.toHaveBeenCalled()
  })

  test('a refusal is told and the table read again', async () => {
    const wrapper = await mountPage(waiting(), alone(true))
    vi.mocked(tablesService.getTable).mockClear()
    vi.mocked(tablesService.seatRobot).mockRejectedValue(axiosError(409, 'That seat is taken.'))

    await emitFrom(wrapper, StartBox, 'addRobot', 'N')

    expect(showToast).toHaveBeenCalledWith('That seat is taken.', 'danger')
    expect(tablesService.getTable).toHaveBeenCalledWith(5)
    expect(wrapper.findComponent(StartBox).props('fillingSeat')).toBeNull()
  })

  test('a refusal whose reread fails too leaves the page as it was', async () => {
    const wrapper = await mountPage(waiting(), alone(true))
    vi.mocked(tablesService.getTable).mockRejectedValue(new Error('offline'))
    vi.mocked(tablesService.seatUser).mockRejectedValue(axiosError(403, 'You do not manage this table.'))

    await emitFrom(wrapper, StartBox, 'seatPlayer', 'N')
    await emitFrom(wrapper, SeatPlayerSheet, 'select', { id: 1, name: 'Ann', username: 'ann', seated: false })

    expect(showToast).toHaveBeenCalledWith('You do not manage this table.', 'danger')
    expect(wrapper.findComponent(StartBox).exists()).toBe(true)
  })

  test('an expired session goes to log in', async () => {
    const wrapper = await mountPage(waiting(), alone(true))
    vi.mocked(tablesService.seatRobot).mockRejectedValue(axiosError(401))

    await emitFrom(wrapper, StartBox, 'addRobot', 'N')

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
    expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'danger')
  })
})

describe('TablePlayPage leaving between boards', () => {
  test('nothing happens when the user cancels', async () => {
    const wrapper = await mountPage(finished())
    const leave = vi.spyOn(useTablesStore(), 'leave')
    vi.mocked(confirmLeave).mockResolvedValue(false)

    await wrapper.get('.next-leave ion-button').trigger('click')
    await flushPromises()

    expect(confirmLeave).toHaveBeenCalled()

    expect(leave).not.toHaveBeenCalled()
  })

  test.each([
    [{ tableDeleted: false, held: false }, 'You left the table.', 'success'],
    [{ tableDeleted: true, held: false }, 'You left the table. Nobody was left, so it was deleted.', 'success'],
    [{ tableDeleted: false, held: true }, expect.stringContaining('Your seat is kept for 2 minutes'), 'warning'],
  ])('leaves (%o), says how and goes to the list', async (answer, message, color) => {
    const wrapper = await mountPage(finished())
    vi.spyOn(useTablesStore(), 'leave').mockResolvedValue(answer)
    const clear = vi.spyOn(useGameStore(), 'clear')
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await emitFrom(wrapper, NextBoardBox, 'leave')

    expect(clear).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(message, color)
    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })

  test('a failed leave toasts the reason, logs it and reloads', async () => {
    const wrapper = await mountPage(finished())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(useTablesStore(), 'leave').mockRejectedValue(new Error('offline'))
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await emitFrom(wrapper, NextBoardBox, 'leave')

    expect(showToast).toHaveBeenCalledWith('Could not leave the table. Please try again.', 'danger')
    expect(logged).toHaveBeenCalledWith(new Error('offline'))
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    logged.mockRestore()
  })

  test('an expired session on leaving goes to log in', async () => {
    const wrapper = await mountPage(finished())
    vi.spyOn(useTablesStore(), 'leave').mockRejectedValue(axiosError(401))
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await emitFrom(wrapper, NextBoardBox, 'leave')

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
    expect(showToast).not.toHaveBeenCalled()
  })
})

// #121: a set of four boards with robots played to the end. Its last board
// is still on show, the set is over (only the board's copy says so: a board
// finishing sends no TableUpdated), and Start replaces the board's Leave.
describe('TablePlayPage after a set', () => {
  const robot = (id: number, n: number) => ({
    id,
    name: `Robot ${n}`,
    username: `robot-${n}`,
    description: null,
    is_robot: true,
  })
  const ROBOTS = { N: robot(101, 1), E: robot(102, 2), W: robot(103, 3) }
  const running = { id: 8, number: 8, board: 4, of: 4, finished: false, ended: null, replaced: [] }

  // Cy (the user, South) manages it, with robots in the other three seats.
  function robotTable(): Table {
    const table = makeTable({ moderated_by: 3, can_manage: true, set: running })
    return {
      ...table,
      seats: table.seats.map((s) =>
        s.seat === 'S' ? s : { ...s, user_id: ROBOTS[s.seat as 'N'].id, user: ROBOTS[s.seat as 'N'], ready: true },
      ),
    }
  }

  function lastBoard(): Playing {
    return {
      ...finished(),
      players: { ...ROBOTS, S: PLAYERS.S },
      set: { ...running, finished: true, ended: 'completed' },
      next_board_at: null,
    } as Playing
  }

  afterEach(() => vi.restoreAllMocks())

  test('Start offers Leave, and Remove on each robot, in place of the next board', async () => {
    const wrapper = await mountPage(lastBoard(), robotTable())

    expect(wrapper.findComponent(NextBoardBox).exists()).toBe(false)
    const box = wrapper.findComponent(StartBox)
    expect(box.props('canLeave')).toBe(true)
    expect(box.props('removable')).toEqual(['N', 'E', 'W'])
  })

  test('nobody but a manager gets Remove', async () => {
    const wrapper = await mountPage(lastBoard(), { ...robotTable(), can_manage: false })

    expect(wrapper.findComponent(StartBox).props('removable')).toEqual([])
  })

  test('Leave asks with nothing at stake, frees the seat and goes to the list', async () => {
    const wrapper = await mountPage(lastBoard(), robotTable())
    const leave = vi.spyOn(useTablesStore(), 'leave').mockResolvedValue({ tableDeleted: false, held: false })
    vi.mocked(confirmLeave).mockResolvedValue(true)

    await emitFrom(wrapper, StartBox, 'leave')

    expect(confirmLeave).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), 3, 'finished', 7, null)
    expect(leave).toHaveBeenCalledWith(5)
    expect(showToast).toHaveBeenCalledWith('You left the table.', 'success')
    expect(navigate).toHaveBeenCalledWith('/tables', 'back', 'replace')
  })

  test('the chat and the review close before the confirmation', async () => {
    const wrapper = await mountPage(lastBoard(), robotTable())
    const chat = useChatStore()
    await wrapper.get('.chat-toggle').trigger('click')
    expect(chat.open).toBe(true)
    await wrapper.get('.review-and-export').trigger('click')
    expect(wrapper.findComponent(BoardReviewModal).props('open')).toBe(true)
    let openWhenAsked: unknown[] = []
    vi.mocked(confirmLeave).mockImplementation(async () => {
      openWhenAsked = [chat.open, wrapper.findComponent(BoardReviewModal).props('open')]
      return false
    })

    await emitFrom(wrapper, StartBox, 'leave')

    expect(openWhenAsked).toEqual([false, false])
  })

  test('a confirmation that fails is told and logged, never silent', async () => {
    const wrapper = await mountPage(lastBoard(), robotTable())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const leave = vi.spyOn(useTablesStore(), 'leave')
    vi.mocked(confirmLeave).mockRejectedValue(new TypeError('no overlay'))

    await emitFrom(wrapper, StartBox, 'leave')

    expect(leave).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Could not leave the table. Please try again.', 'danger')
    expect(logged).toHaveBeenCalledWith(expect.any(TypeError))
  })

  test('Remove asks, takes the robot out and says so', async () => {
    const table = robotTable()
    const wrapper = await mountPage(lastBoard(), table)
    vi.mocked(confirmRemove).mockResolvedValue(true)
    vi.mocked(tablesService.removePlayer).mockResolvedValue({
      ...table,
      seats: table.seats.filter((s) => s.seat !== 'N'),
      free_seats: ['N'],
    })

    await emitFrom(wrapper, StartBox, 'remove', 'N')

    expect(confirmRemove).toHaveBeenCalledWith(ROBOTS.N, 'N', '')
    expect(tablesService.removePlayer).toHaveBeenCalledWith(5, 101)
    expect(showToast).toHaveBeenCalledWith('robot-1 was removed from the table.', 'success')
    expect(wrapper.findComponent(StartBox).props('removable')).toEqual(['E', 'W'])
  })

  test('a Remove called off sends nothing, nor one for an empty seat', async () => {
    const table = robotTable()
    const wrapper = await mountPage(lastBoard(), { ...table, seats: table.seats.filter((s) => s.seat !== 'W') })
    vi.mocked(confirmRemove).mockResolvedValue(false)

    await emitFrom(wrapper, StartBox, 'remove', 'N')
    await emitFrom(wrapper, StartBox, 'remove', 'W')

    expect(confirmRemove).toHaveBeenCalledTimes(1)
    expect(tablesService.removePlayer).not.toHaveBeenCalled()
  })

  test('one seat at a time', async () => {
    const wrapper = await mountPage(lastBoard(), robotTable())
    vi.mocked(confirmRemove).mockResolvedValue(true)
    vi.mocked(tablesService.removePlayer).mockReturnValue(new Promise(() => {}))

    await emitFrom(wrapper, StartBox, 'remove', 'N')
    expect(wrapper.findComponent(StartBox).props('fillingSeat')).toBe('N')
    await emitFrom(wrapper, StartBox, 'remove', 'E')

    expect(tablesService.removePlayer).toHaveBeenCalledTimes(1)
  })

  test('a refused Remove is told and the table read again', async () => {
    const wrapper = await mountPage(lastBoard(), robotTable())
    vi.mocked(confirmRemove).mockResolvedValue(true)
    vi.mocked(tablesService.removePlayer).mockRejectedValue(axiosError(403, 'You do not manage this table.'))
    vi.mocked(tablesService.getTable).mockClear()

    await emitFrom(wrapper, StartBox, 'remove', 'E')

    expect(showToast).toHaveBeenCalledWith('You do not manage this table.', 'danger')
    expect(tablesService.getTable).toHaveBeenCalledWith(5)
  })

  test('a Remove whose reread fails too leaves the page as it was', async () => {
    const wrapper = await mountPage(lastBoard(), robotTable())
    vi.mocked(confirmRemove).mockResolvedValue(true)
    vi.mocked(tablesService.removePlayer).mockRejectedValue(axiosError(404, 'Gone.'))
    vi.mocked(tablesService.getTable).mockRejectedValue(new Error('offline'))

    await emitFrom(wrapper, StartBox, 'remove', 'E')

    expect(showToast).toHaveBeenCalledWith('Gone.', 'danger')
    expect(wrapper.findComponent(StartBox).props('fillingSeat')).toBeNull()
  })

  test('a failed Remove confirmation is told and logged', async () => {
    const wrapper = await mountPage(lastBoard(), robotTable())
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(confirmRemove).mockRejectedValue(new TypeError('no overlay'))

    await emitFrom(wrapper, StartBox, 'remove', 'E')

    expect(tablesService.removePlayer).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Could not remove that player. Please try again.', 'danger')
    expect(logged).toHaveBeenCalledWith(expect.any(TypeError))
  })

  test('an expired session on Remove goes to log in', async () => {
    const wrapper = await mountPage(lastBoard(), robotTable())
    vi.mocked(confirmRemove).mockResolvedValue(true)
    vi.mocked(tablesService.removePlayer).mockRejectedValue(axiosError(401))

    await emitFrom(wrapper, StartBox, 'remove', 'E')

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
    expect(showToast).not.toHaveBeenCalled()
  })
})

// Refresh shows only once live updates have been off for a few seconds (#76).
describe('TablePlayPage live updates', () => {
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
    const wrapper = await mountPage(auction())

    vi.advanceTimersByTime(OFFLINE_GRACE_MS)
    await flushPromises()

    expect(wrapper.find('.offline-refresh').exists()).toBe(false)
    expect(wrapper.findComponent(IonRefresher).exists()).toBe(true)
  })

  test('a few seconds without live updates bring the note and Refresh, which reloads', async () => {
    setConnection('connected')
    const wrapper = await mountPage(auction())
    expect(wrapper.find('.offline-refresh').exists()).toBe(false)

    vi.advanceTimersByTime(OFFLINE_GRACE_MS)
    await flushPromises()
    expect(wrapper.find('.offline-note').text()).toBe('Live updates are off. Refresh to see the latest.')

    await wrapper.get('ion-button.refresh').trigger('click')
    await flushPromises()
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)

    setSubscribed(5)
    await flushPromises()
    expect(wrapper.find('.offline-refresh').exists()).toBe(false)
  })
})

describe('TablePlayPage turn clock', () => {
  const NOW = Date.parse('2026-10-05T12:00:00Z')
  const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('our turn: "Your turn · m:ss", red with the bidding box ringed in the last 15 s', async () => {
    const wrapper = await mountPage(auction({ turn_deadline: inSeconds(42) }))

    const clock = () => wrapper.get('.turn-clock')
    await flushPromises()
    expect(wrapper.findComponent(BiddingBox).exists()).toBe(true)
    expect(clock().text()).toBe('Your turn · 0:42')
    expect(clock().classes()).toContain('turn-clock-mine')
    expect(clock().classes()).not.toContain('turn-clock-urgent')
    expect(wrapper.get('.bidding-box').classes()).not.toContain('turn-urgent')

    vi.advanceTimersByTime(27_000)
    await flushPromises()
    expect(clock().text()).toBe('Your turn · 0:15')
    expect(clock().classes()).toContain('turn-clock-urgent')
    expect(wrapper.get('.bidding-box').classes()).toContain('turn-urgent')
  })

  test("our time for the set ending first: the line says so, and each seat's bank shows", async () => {
    const set = { id: 8, number: 1, board: 2, of: 4, finished: false, ended: null, replaced: [], minutes: 8 }
    const wrapper = await mountPage(
      auction({
        set: { ...set, time_left: { N: 300, E: 200, S: 42, W: null } },
        turn_started_at: inSeconds(0),
        turn_deadline: inSeconds(42),
        turn_deadline_by: 'set',
      }),
    )

    expect(wrapper.get('.turn-clock').text()).toBe('Your time for the set: 0:42')
    const mine = () => wrapper.get('.side-bottom .seat-bank')
    expect(mine().text()).toBe('0:42')
    expect(mine().classes()).toEqual(expect.arrayContaining(['seat-bank-running', 'seat-bank-low']))
    expect(wrapper.get('.side-top .seat-bank').text()).toBe('5:00')

    vi.advanceTimersByTime(2000)
    await flushPromises()
    expect(mine().text()).toBe('0:40')
    expect(wrapper.get('.turn-clock').text()).toBe('Your time for the set: 0:40')
    expect(wrapper.get('.side-top .seat-bank').text()).toBe('5:00')
  })

  test('in the play, our own hand is ringed when we play from it', async () => {
    const wrapper = await mountPage(
      auction({
        phase: 'play',
        contract: { bid: { id: 9, call: '1N', level: 1, strain: 'NT' }, doubled: 0, declarer: 'W', dummy: 'E' },
        auction: [],
        tricks: [],
        current_trick: [],
        tricks_won: { ns: 0, ew: 0 },
        turn: 'S',
        turn_deadline: inSeconds(10),
      } as unknown as Partial<Playing>),
    )

    expect(wrapper.get('.turn-clock').text()).toBe('Your turn · 0:10')
    expect(wrapper.get('.my-hand .hand').classes()).toContain('turn-urgent')
  })

  test('somebody else\'s turn: "Waiting for East · m:ss", never red', async () => {
    const wrapper = await mountPage(auction({ turn: 'E', acting_user_id: 2, turn_deadline: inSeconds(5) }))

    expect(wrapper.get('.turn-clock').text()).toBe('Waiting for East · 0:05')
    expect(wrapper.get('.turn-clock').classes()).not.toContain('turn-clock-mine')
    expect(wrapper.get('.turn-clock').classes()).not.toContain('turn-clock-urgent')
  })

  test('an away player on turn: named once, no clock in the text; the seats count down', async () => {
    // East and West away together: the board waits for East.
    const table = makeTable()
    table.seats = table.seats.map((s) =>
      s.seat === 'E' || s.seat === 'W'
        ? { ...s, away_since: inSeconds(-30), replace_at: inSeconds(90) }
        : s,
    )
    const wrapper = await mountPage(
      auction({ turn: 'E', acting_user_id: 2, turn_deadline: inSeconds(90), turn_deadline_by: 'away' }),
      table,
    )

    expect(wrapper.get('.turn-clock').text()).toBe('Waiting for East (away)')
    expect(wrapper.get('.status').text()).toBe('')
    expect(wrapper.findAll('.away-line').map((l) => l.text())).toEqual([
      'Away players are replaced by a robot when their clock runs out.',
    ])
    const tag = (seat: Seat) => wrapper.get(`[data-seat="${seat}"] .seat-away-tag`)
    expect(tag('E').text()).toBe('away · 1:30')
    expect(tag('W').text()).toBe('away · 1:30')
    expect(tag('E').classes()).not.toContain('away-tag-urgent')
    expect(wrapper.find('[data-seat="N"] .seat-away-tag').exists()).toBe(false)

    vi.advanceTimersByTime(76_000)
    await flushPromises()
    expect(tag('E').text()).toBe('away · 0:14')
    expect(tag('W').text()).toBe('away · 0:14')
    expect(tag('W').classes()).toContain('away-tag-urgent')
    expect(wrapper.get('.turn-clock').text()).toBe('Waiting for East (away)')

    vi.advanceTimersByTime(14_000)
    await flushPromises()
    expect(tag('E').text()).toBe('replacing…')
  })

  test('no clock (a robot or an admin on turn): the line stays, empty', async () => {
    const wrapper = await mountPage(auction({ turn_deadline: null }))

    expect(wrapper.get('.turn-clock').text()).toBe('')
    vi.advanceTimersByTime(120_000)
    await flushPromises()
    expect(gameService.getPlaying).toHaveBeenCalledTimes(1)
  })

  test('time up: says so, and rereads the game once 2 s after the deadline', async () => {
    const wrapper = await mountPage(auction({ turn: 'E', acting_user_id: 2, turn_deadline: inSeconds(3) }))

    vi.advanceTimersByTime(3000)
    await flushPromises()
    expect(wrapper.get('.turn-clock').text()).toBe('Time is up…')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(2000)
    await flushPromises()
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)

    // Nothing more for the same deadline.
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
  })

  test('replaced by a robot: off to the set we were taken out of', async () => {
    await mountPage(auction())
    const store = useTablesStore()

    store.replacedFrom = { id: 9, number: 2, seat: 'S', reason: 'turn_timeout', tableId: 5 }
    store.kickedFrom = 5
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/sets/9', 'back', 'replace')
  })
})
