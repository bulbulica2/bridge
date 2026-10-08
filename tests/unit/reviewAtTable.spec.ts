import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import TablePlayPage from '@/views/TablePlayPage.vue'
import BoardResultDialog from '@/components/BoardResultDialog.vue'
import BoardReviewModal from '@/components/BoardReviewModal.vue'
import * as gameService from '@/services/game'
import * as historyService from '@/services/history'
import * as tablesService from '@/services/tables'
import type { Bid, Card, PlayedCard, Playing, Seat, SetPosition, Suit } from '@/services/game'
import type { PlayingHistoryEntry, PlayingReview, SetResults } from '@/services/history'
import type { Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'

// The play page's review modal (#97): which boards it offers, that it opens
// without leaving the table, tells us when it is our turn and holds the
// forced card back. The modal itself has its own spec (boardReview.spec.ts).
// The board chat has its own specs: its read never answers here.
vi.mock('@/services/chat', () => ({ getMessages: () => new Promise(() => {}), sendMessage: () => new Promise(() => {}) }))
vi.mock('@/services/game', () => ({
  getPlaying: vi.fn(),
  getBids: vi.fn(),
  makeCall: vi.fn(),
  playCard: vi.fn(),
  nextBoard: vi.fn(),
}))
vi.mock('@/services/history', () => ({
  getMyPlayings: vi.fn(),
  getSet: vi.fn(),
  getPlayingReview: vi.fn(),
}))
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
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
const { navigate, route, enterHooks, leaveHooks } = vi.hoisted(() => ({
  navigate: vi.fn(),
  route: { params: { id: '5' } as Record<string, string> },
  enterHooks: [] as (() => void)[],
  leaveHooks: [] as (() => void)[],
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
    onIonViewWillEnter: (hook: () => void) => {
      enterHooks.push(hook)
      onMounted(hook)
    },
    onIonViewWillLeave: (hook: () => void) => leaveHooks.push(hook),
  }
})

const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null, is_robot: false },
  E: { id: 2, name: 'Bob', username: 'bob', description: null, is_robot: false },
  S: { id: 3, name: 'Cy', username: 'cy', description: null, is_robot: false },
  W: { id: 4, name: 'Di', username: 'di', description: null, is_robot: false },
}

const card = (name: string): Card => {
  const suit = name[0] as Suit
  const rank = { A: 15, K: 14, Q: 13, J: 12 }[name.slice(1)] ?? Number(name.slice(1))
  return { id: 'SHDC'.indexOf(suit) * 20 + rank, suit, rank, rank_name: name.slice(1) }
}
const cards = (...names: string[]) => names.map(card)
const pass = { id: 1, call: 'P', level: null, strain: null } as unknown as Bid
const fourSpades = { id: 22, call: '4S', level: 4, strain: 'S', special: false } as Bid

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

const position = (overrides: Partial<SetPosition> = {}): SetPosition => ({
  id: 5,
  number: 2,
  board: 2,
  of: 4,
  finished: false,
  ended: null,
  replaced: [],
  ...overrides,
})

// The user is South (Cy), on turn to call.
function auction(overrides: Partial<Playing> = {}): Playing {
  return {
    phase: 'auction',
    playing_id: 43,
    set: null,
    board: { id: 8, number: 8, dealer: 'S', vulnerable: '' },
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
    hand: cards('S2', 'H3'),
    ...overrides,
  } as Playing
}

// Board 7, passed out, nobody ready yet.
function finished(overrides: Partial<Playing> = {}): Playing {
  return auction({
    phase: 'finished',
    playing_id: 42,
    board: { id: 7, number: 7, dealer: 'S', vulnerable: '' },
    turn: null,
    acting_user_id: null,
    auction: [1, 2, 3, 4].map(() => ({ seat: 'N' as Seat, bid: pass })),
    result: { contract: null, doubled: null, declarer: null, tricks_won: null, score_ns: 0, made_by: null, claimed: false },
    deal: { N: cards('SA'), E: cards('HA'), S: cards('DA'), W: cards('CA') },
    ready: [],
    hand: [],
    ...overrides,
  })
}

function review(playingId: number, number: number): PlayingReview {
  const state = finished({ playing_id: playingId, board: { id: number, number, dealer: 'S', vulnerable: '' } })
  return { ...state, players: PLAYERS } as unknown as PlayingReview
}

function setResults(id: number, playingIds: [number, number][]): SetResults {
  return {
    id,
    boards: playingIds.map(([playing_id, number], i) => ({
      position: i + 1,
      playing_id,
      board: { id: number, number, dealer: 'N', vulnerable: '' },
      top: 0,
      matchpoints: { ns: 0, ew: 0 },
    })),
    finished: false,
    totals: { score: { ns: 0, ew: 0 }, matchpoints: { ns: 0, ew: 0 }, top: 0 },
  } as unknown as SetResults
}

function historyPage(entries: [number, number | null, number][]) {
  return {
    current_page: 1,
    last_page: 1,
    total: entries.length,
    per_page: 20,
    next_page_url: null,
    data: entries.map(([playing_id, table_id, number]) => ({
      playing_id,
      table_id,
      board: { id: number, number, dealer: 'N', vulnerable: '' },
    })) as unknown as PlayingHistoryEntry[],
  }
}

const modalStub = { template: '<div><slot /></div>' }

async function mountPage(playing: Playing, table: Table = makeTable()) {
  vi.mocked(tablesService.getTable).mockResolvedValue(table)
  vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
  const wrapper = mount(TablePlayPage, {
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub, 'router-link': true } },
  })
  await flushPromises()
  return wrapper
}

const reviewButton = (wrapper: VueWrapper) => wrapper.find('.review-boards')
const modal = (wrapper: VueWrapper) => wrapper.findComponent(BoardReviewModal)

async function openReview(wrapper: VueWrapper) {
  await reviewButton(wrapper).trigger('click')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  enterHooks.length = 0
  leaveHooks.length = 0
  route.params = { id: '5' }
  useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
  vi.mocked(gameService.getBids).mockResolvedValue([pass])
  vi.mocked(historyService.getPlayingReview).mockImplementation(async (id) => review(id, id - 35))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the review modal at the table', () => {
  test('a finished board opens in the modal: the page stays at the table', async () => {
    const wrapper = await mountPage(finished())

    expect(modal(wrapper).props('open')).toBe(false)
    expect(wrapper.find('.board-review').exists()).toBe(false)

    await wrapper.get('.review-boards').trigger('click')
    await flushPromises()

    expect(navigate).not.toHaveBeenCalled()
    expect(modal(wrapper).props('open')).toBe(true)
    expect(modal(wrapper).props('choices')).toEqual([{ playingId: 42, position: null }])
    expect(historyService.getPlayingReview).toHaveBeenCalledWith(42)
    expect(wrapper.find('.board-review').exists()).toBe(true)
    // The next board comes by itself: nothing waits for us meanwhile.
    expect(wrapper.find('.turn-text').exists()).toBe(false)
  })

  test('while the next board is bid, the last one is still there, and our turn shows', async () => {
    const wrapper = await mountPage(finished())
    const game = useGameStore()

    game.applyPlayingUpdate(5, { ...auction(), acting_user_id: 4, turn: 'W' })
    await flushPromises()
    await openReview(wrapper)

    expect(modal(wrapper).props('choices')).toEqual([{ playingId: 42, position: null }])
    expect(wrapper.find('.turn-notice').exists()).toBe(false)

    // West passes: our call. The modal says so and stays open.
    game.applyPlayingUpdate(5, { ...auction(), auction: [{ seat: 'W', bid: pass }] })
    await flushPromises()
    expect(modal(wrapper).props('open')).toBe(true)
    expect(wrapper.get('.turn-text').text()).toBe('Your turn to bid')

    await wrapper.get('.close-review').trigger('click')
    expect(modal(wrapper).props('open')).toBe(false)
    expect(wrapper.findComponent({ name: 'BiddingBox' }).exists()).toBe(true)
  })

  test("switches between the running set's finished boards", async () => {
    vi.mocked(historyService.getSet).mockResolvedValue(setResults(5, [[41, 6], [42, 7]]))
    const wrapper = await mountPage(finished({ set: position() }))

    expect(historyService.getSet).toHaveBeenCalledWith(5)
    await openReview(wrapper)

    expect(wrapper.findAll('ion-segment-button').map((b) => b.text())).toEqual(['Board 1', 'Board 2'])
    expect(modal(wrapper).find('ion-title').text()).toBe('Board 2 review')
    expect(historyService.getPlayingReview).toHaveBeenCalledWith(42)
  })

  test("on the next set's first board, the previous set's last board", async () => {
    vi.mocked(historyService.getSet).mockResolvedValue(setResults(5, [[41, 6], [42, 7]]))
    const wrapper = await mountPage(finished({ set: position({ board: 4, finished: true, ended: 'completed' }) }))

    useGameStore().applyPlayingUpdate(5, auction({ set: position({ id: 6, number: 3, board: 1 }) }))
    await flushPromises()

    expect(reviewButton(wrapper).exists()).toBe(true)
    expect(modal(wrapper).props('choices')).toEqual([{ playingId: 42, position: 4 }])
  })

  test('after a reload mid-set, the set is read for its boards', async () => {
    vi.mocked(historyService.getSet).mockResolvedValue(setResults(5, [[41, 6], [42, 7]]))
    const wrapper = await mountPage(auction({ set: position({ board: 3 }) }))

    expect(historyService.getSet).toHaveBeenCalledWith(5)
    expect(historyService.getMyPlayings).not.toHaveBeenCalled()
    expect(modal(wrapper).props('choices')).toHaveLength(2)
  })

  test("after a reload on a set's first board, our latest board at this table", async () => {
    vi.mocked(historyService.getMyPlayings).mockResolvedValue(
      historyPage([
        [50, 9, 3],
        [44, 5, 8],
        [40, 5, 4],
      ]),
    )
    const wrapper = await mountPage(auction({ set: position({ id: 6, number: 3, board: 1 }) }))

    expect(historyService.getSet).not.toHaveBeenCalled()
    expect(historyService.getMyPlayings).toHaveBeenCalledWith(1)
    expect(modal(wrapper).props('choices')).toEqual([{ playingId: 44, position: null }])
  })

  test('nothing to review while nothing may have been finished here, or nothing is found', async () => {
    let wrapper = await mountPage(auction())
    expect(reviewButton(wrapper).exists()).toBe(false)
    wrapper.unmount()

    wrapper = await mountPage(auction({ set: position({ number: 1, board: 1 }) }))
    expect(reviewButton(wrapper).exists()).toBe(false)
    expect(historyService.getSet).not.toHaveBeenCalled()
    expect(historyService.getMyPlayings).not.toHaveBeenCalled()
    wrapper.unmount()

    // A newcomer: their set is out of bounds (403) and their history has
    // nothing here.
    vi.mocked(historyService.getSet).mockRejectedValue(new Error('403'))
    vi.mocked(historyService.getMyPlayings).mockRejectedValue(new Error('500'))
    wrapper = await mountPage(auction({ set: position({ board: 3 }) }))
    expect(historyService.getMyPlayings).toHaveBeenCalled()
    expect(reviewButton(wrapper).exists()).toBe(false)
  })

  test('leaving the view closes the modal', async () => {
    const wrapper = await mountPage(finished())
    await openReview(wrapper)
    expect(modal(wrapper).props('open')).toBe(true)

    leaveHooks.forEach((hook) => hook())
    await flushPromises()
    expect(modal(wrapper).props('open')).toBe(false)
  })

  test('leaving the view closes the result dialog, and coming back shows it again', async () => {
    vi.useFakeTimers()
    const wrapper = await mountPage(finished())
    const dialog = () => wrapper.findComponent(BoardResultDialog)
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(dialog().props('open')).toBe(true)
    // Closed with its X: it stays closed while we look at the deal…
    dialog().vm.$emit('close')
    await flushPromises()
    expect(dialog().props('open')).toBe(false)

    leaveHooks.forEach((hook) => hook())
    await flushPromises()
    expect(dialog().props('open')).toBe(false)

    // …but another page and back shows the result again.
    enterHooks.forEach((hook) => hook())
    await flushPromises()
    expect(dialog().props('open')).toBe(true)
  })

  test('the forced card waits while the review is open', async () => {
    vi.useFakeTimers()
    vi.mocked(gameService.playCard).mockReturnValue(new Promise(() => {}))
    // 4♠ by South (the user), North dummy with one spade; West led the ♠3
    // after board 7 was finished here.
    const wrapper = await mountPage(finished())
    const contract = { bid: fourSpades, doubled: 0 as const, declarer: 'S' as Seat, dummy: 'N' as Seat }
    useGameStore().applyPlayingUpdate(
      5,
      auction({
        phase: 'play',
        turn: 'N',
        contract,
        tricks: [],
        current_trick: [{ seat: 'W', card: card('S3') }] as PlayedCard[],
        tricks_won: { ns: 0, ew: 0 },
        dummy_hand: cards('SQ', 'H3', 'C9'),
        hand: cards('SA', 'H2', 'D2'),
      }),
    )
    await flushPromises()
    expect(wrapper.find('.forced').exists()).toBe(true)

    await openReview(wrapper)
    expect(wrapper.find('.forced').exists()).toBe(false)
    expect(wrapper.get('.turn-text').text()).toBe('Your turn to play')
    vi.advanceTimersByTime(10_000)
    await flushPromises()
    expect(gameService.playCard).not.toHaveBeenCalled()

    // Back at the table, the countdown starts again.
    await wrapper.get('.back-to-table').trigger('click')
    await flushPromises()
    expect(wrapper.find('.forced').exists()).toBe(true)
    vi.advanceTimersByTime(3000)
    await flushPromises()
    expect(gameService.playCard).toHaveBeenCalledWith(5, card('SQ').id)
  })

  test('entering for another table closes the modal; the same table keeps it', async () => {
    const wrapper = await mountPage(finished())
    await openReview(wrapper)

    enterHooks.forEach((hook) => hook())
    await flushPromises()
    expect(modal(wrapper).props('open')).toBe(true)

    // Ionic reuses the page for the next table's route.
    route.params = { id: '6' }
    enterHooks.forEach((hook) => hook())
    await flushPromises()
    expect(modal(wrapper).props('open')).toBe(false)
  })
})
