import { AxiosError, AxiosHeaders } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import http from '@/services/http'
import { getDoubleDummy } from '@/services/history'
import type {
  BoardResults,
  DoubleDummy,
  DoubleDummyTable as Grid,
  LeadTricks,
  PlayingReview,
} from '@/services/history'
import type { Bid, BoardResult, Card, PlayedCard, Suit } from '@/services/game'
import type { Seat } from '@/services/tables'
import type { PublicUser } from '@/services/users'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import { DOUBLE_DUMMY_REREAD_MS, useDoubleDummy } from '@/composables/useDoubleDummy'
import {
  DOUBLE_DUMMY_PENDING,
  bestLeads,
  ddTricks,
  doubleDummyLine,
  doubleDummyLines,
  leadSummary,
  leadsInHandOrder,
  pbnOptimumResultTable,
} from '@/utils/doubleDummy'
import BoardResultPanel from '@/components/BoardResultPanel.vue'
import BoardReview from '@/components/BoardReview.vue'
import DoubleDummyTable from '@/components/DoubleDummyTable.vue'
import LeadAnalysis from '@/components/LeadAnalysis.vue'
import BoardResultsPage from '@/views/BoardResultsPage.vue'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn() },
}))

const route = { params: { id: '7' } as Record<string, string> }
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => route,
}))
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate: vi.fn() }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})

function axiosError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message: 'No.' }, statusText: '', headers: {}, config }
  return error
}

function user(id: number, username: string): PublicUser {
  return { id, name: username.toUpperCase(), username, description: null }
}

const ann = user(1, 'ann')
const bo = user(2, 'bo')
const cy = user(3, 'cy')
const di = user(4, 'di')
const PLAYERS = { N: ann, E: bo, S: cy, W: di }

const card = (suit: Suit, rank: number): Card => ({
  id: 'SHDC'.indexOf(suit) * 20 + rank,
  suit,
  rank,
  rank_name: String(rank),
})
const RANKS = [15, 14, 13, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2]
const hand = (suit: Suit) => RANKS.map((rank) => card(suit, rank))
const DEAL: Record<Seat, Card[]> = { N: hand('S'), E: hand('H'), S: hand('D'), W: hand('C') }

const bid = (id: number, call: string, level: number | null = null): Bid => ({
  id,
  call,
  level,
  strain: level ? (call.slice(1) as Bid['strain']) : null,
  special: level === null,
})
const pass = bid(1, 'P')
const fourSpades = bid(22, '4S', 4)

const TABLE: Grid = {
  N: { C: 7, D: 5, H: 6, S: 10, NT: 6 },
  E: { C: 5, D: 7, H: 6, S: 3, NT: 6 },
  S: { C: 7, D: 5, H: 6, S: 9, NT: 6 },
  W: { C: 5, D: 7, H: 6, S: 3, NT: 6 },
}
const READY: DoubleDummy = { status: 'ready', table: TABLE }
const PENDING: DoubleDummy = { status: 'pending', table: null }

// East's leads against 4♠ by North, in the backend's order (♠ ♥ ♦ ♣, high
// to low): the ♠5 and ♣3 hold declarer to 9, everything else gives 10.
const LEADS: LeadTricks[] = [
  { card: card('S', 5), tricks: 9 },
  { card: card('H', 15), tricks: 10 },
  { card: card('H', 2), tricks: 10 },
  { card: card('D', 13), tricks: 10 },
  { card: card('C', 3), tricks: 9 },
]
const lead = (seat: Seat, c: Card): PlayedCard => ({ seat, card: c })

function result(overrides: Partial<BoardResult> = {}): BoardResult {
  return {
    contract: fourSpades,
    doubled: 0,
    declarer: 'N',
    tricks_won: 10,
    score_ns: 420,
    made_by: 0,
    claimed: false,
    ...overrides,
  }
}

const PASSED: BoardResult = {
  contract: null,
  doubled: null,
  declarer: null,
  tricks_won: null,
  score_ns: 0,
  made_by: null,
  claimed: false,
}

// 4♠ by North, East led the ♥A and the rest was claimed.
function review(overrides: Partial<PlayingReview> = {}): PlayingReview {
  return {
    phase: 'finished',
    playing_id: 42,
    board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
    players: PLAYERS,
    turn: null,
    acting_user_id: null,
    auction: [
      { seat: 'N', bid: fourSpades },
      { seat: 'E', bid: pass },
      { seat: 'S', bid: pass },
      { seat: 'W', bid: pass },
    ],
    contract: { bid: fourSpades, doubled: 0, declarer: 'N', dummy: 'S' },
    tricks: [],
    current_trick: [lead('E', card('H', 15))],
    tricks_won: { ns: 0, ew: 0 },
    dummy_hand: DEAL.S,
    claim: null,
    result: result({ claimed: true }),
    deal: DEAL,
    double_dummy: { status: 'ready', table: TABLE, leads: LEADS },
    ...overrides,
  }
}

function answer(data: unknown) {
  vi.mocked(http.get).mockResolvedValueOnce({ data: { status: 200, message: 'OK', data } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  route.params = { id: '7' }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('double dummy service and store', () => {
  test('reads GET /boards/{id}/double-dummy', async () => {
    answer(READY)

    await expect(getDoubleDummy(7)).resolves.toEqual(READY)
    expect(http.get).toHaveBeenCalledWith('/boards/7/double-dummy')
  })

  test('a ready table is cached and never asked for again', async () => {
    const store = useHistoryStore()
    answer(READY)

    await store.loadDoubleDummy(7)
    await expect(store.loadDoubleDummy(7)).resolves.toEqual(READY)
    expect(http.get).toHaveBeenCalledTimes(1)
    expect(store.doubleDummy[7]).toEqual(READY)
  })

  test('a pending one is asked for again, and replaced', async () => {
    const store = useHistoryStore()
    answer(PENDING)
    answer(READY)

    await expect(store.loadDoubleDummy(7)).resolves.toEqual(PENDING)
    await expect(store.loadDoubleDummy(7)).resolves.toEqual(READY)
    expect(http.get).toHaveBeenCalledTimes(2)
    expect(store.doubleDummy[7]).toEqual(READY)
  })

  test.each([403, 404])('a %i drops the cached copy', async (status) => {
    const store = useHistoryStore()
    store.doubleDummy[7] = PENDING
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(status))

    await expect(store.loadDoubleDummy(7)).rejects.toBeInstanceOf(AxiosError)
    expect(store.doubleDummy[7]).toBeUndefined()
  })

  test('another failure keeps it', async () => {
    const store = useHistoryStore()
    store.doubleDummy[7] = PENDING
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(500))

    await expect(store.loadDoubleDummy(7)).rejects.toBeInstanceOf(AxiosError)
    expect(store.doubleDummy[7]).toEqual(PENDING)
  })

  test('clear() forgets it', () => {
    const store = useHistoryStore()
    store.doubleDummy[7] = READY

    store.clear()
    expect(store.doubleDummy).toEqual({})
  })

  test('a review whose analysis was pending is read again; a ready one is not', async () => {
    const store = useHistoryStore()
    answer(review({ double_dummy: { status: 'pending', table: null, leads: null } }))
    answer(review())

    await store.loadReview(42)
    await store.loadReview(42)
    await store.loadReview(42)
    expect(http.get).toHaveBeenCalledTimes(2)
    expect(store.reviews[42].double_dummy?.status).toBe('ready')
  })
})

describe('double dummy wording', () => {
  test('ddTricks reads one cell, null without a table', () => {
    expect(ddTricks(TABLE, 'S', 'S')).toBe(9)
    expect(ddTricks(null, 'S', 'S')).toBeNull()
  })

  test("the result panel's line", () => {
    expect(doubleDummyLine(READY, result())).toBe('Double dummy: 4♠ by North makes 10')
    expect(doubleDummyLine(READY, result({ declarer: 'S' }))).toBe('Double dummy: 4♠ by South makes 9')
    expect(doubleDummyLine(PENDING, result())).toBe(DOUBLE_DUMMY_PENDING)
    expect(doubleDummyLine({ status: 'unavailable', table: null }, result())).toBeNull()
    expect(doubleDummyLine(READY, PASSED)).toBeNull()
    expect(doubleDummyLine(null, result())).toBeNull()
  })

  test('leads in the order the hand is held, ♥ ♣ ♦ ♠', () => {
    expect(leadsInHandOrder(LEADS).map((l) => l.card.id)).toEqual([35, 22, 63, 53, 5])
  })

  test('the best leads: the fewest tricks, every card that gets there', () => {
    expect(bestLeads(LEADS)).toEqual({ tricks: 9, cards: [card('C', 3), card('S', 5)] })
    expect(bestLeads([])).toBeNull()
  })

  test('the opening lead in words', () => {
    const ace = lead('E', card('H', 15))
    expect(leadSummary(LEADS, ace, 'E')).toBe('Your lead ♥A: declarer can make 10. Best was ♣3 or ♠5: 9.')
    expect(leadSummary(LEADS, ace, 'S')).toBe("East's lead ♥A: declarer can make 10. Best was ♣3 or ♠5: 9.")
    expect(leadSummary(LEADS, lead('E', card('S', 5)), null)).toBe(
      "East's lead ♠5: declarer can make 9. That was one of the best leads.",
    )
    const three = [...LEADS, { card: card('D', 2), tricks: 9 }]
    expect(leadSummary(three, null, null)).toBe('Best lead ♣3, ♦2 or ♠5: 9.')
    expect(leadSummary(LEADS, lead('E', card('C', 15)), null)).toBe('Best lead ♣3 or ♠5: 9.')
    expect(leadSummary([{ card: card('S', 5), tricks: 9 }], null, null)).toBe('Every lead lets declarer make 9.')
    expect(leadSummary([], null, null)).toBeNull()
  })

  test('the text and PBN tables', () => {
    expect(doubleDummyLines(TABLE)[0]).toBe('       ♣   ♦   ♥   ♠  NT')
    expect(doubleDummyLines(TABLE)[3]).toBe('S      7   5   6   9   6')
    const pbn = pbnOptimumResultTable(TABLE)
    expect(pbn).toHaveLength(21)
    expect(pbn[0]).toBe('[OptimumResultTable "Declarer;Denomination\\2R;Result\\2R"]')
    // N, then S, E, W; NT first, clubs last.
    expect(pbn.slice(6, 11)).toEqual(['S NT  6', 'S  S  9', 'S  H  6', 'S  D  5', 'S  C  7'])
    expect(pbn[20]).toBe('W  C  5')
  })
})

describe('useDoubleDummy', () => {
  function run(id: () => number | null) {
    const scope = effectScope()
    const dd = scope.run(() => useDoubleDummy(id))!
    return { scope, dd }
  }

  test('reads the board, and nothing without one', async () => {
    const id = ref<number | null>(null)
    const { dd } = run(() => id.value)

    await dd.load()
    expect(http.get).not.toHaveBeenCalled()
    expect(dd.analysis.value).toBeNull()

    id.value = 7
    answer(READY)
    await dd.load()
    expect(dd.analysis.value).toEqual(READY)
  })

  test('pending: read once more a little later, never again', async () => {
    vi.useFakeTimers()
    const { dd } = run(() => 7)
    answer(PENDING)
    answer(PENDING)

    await dd.load()
    expect(dd.analysis.value).toEqual(PENDING)
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS - 1)
    expect(http.get).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(http.get).toHaveBeenCalledTimes(2)

    // Still pending: no loop.
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS * 3)
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  test('another board by then: no reread', async () => {
    vi.useFakeTimers()
    const id = ref(7)
    const { dd } = run(() => id.value)
    answer(PENDING)

    await dd.load()
    id.value = 8
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  test('the reread is dropped with the scope, and a failure stays quiet', async () => {
    vi.useFakeTimers()
    const { scope, dd } = run(() => 7)
    answer(PENDING)

    await dd.load()
    scope.stop()
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    expect(http.get).toHaveBeenCalledTimes(1)

    const other = run(() => 9).dd
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403))
    await expect(other.load()).resolves.toBeUndefined()
    expect(other.analysis.value).toBeNull()
  })

  test('a failed reread is quiet too', async () => {
    vi.useFakeTimers()
    const { dd } = run(() => 7)
    answer(PENDING)
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(500))

    await dd.load()
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    await flushPromises()
    expect(http.get).toHaveBeenCalledTimes(2)
    expect(dd.analysis.value).toEqual(PENDING)
  })
})

describe('DoubleDummyTable', () => {
  test('declarers down the side, ♣ ♦ ♥ ♠ NT across, plain tricks', () => {
    const wrapper = mount(DoubleDummyTable, { props: { analysis: READY } })

    const heads = wrapper.findAll('thead th').map((th) => th.text())
    expect(heads).toEqual(['Declarer', '♣', '♦', '♥', '♠', 'NT'])
    expect(wrapper.findAll('thead th')[3].classes()).toContain('red')
    expect(wrapper.findAll('thead th')[3].attributes('aria-label')).toBe('hearts')
    expect(wrapper.findAll('thead th')[5].attributes('aria-label')).toBe('no trump')
    const rows = wrapper.findAll('tbody tr')
    expect(rows.map((r) => r.get('th').text())).toEqual(['N', 'E', 'S', 'W'])
    expect(rows[0].findAll('td').map((td) => td.text())).toEqual(['7', '5', '6', '10', '6'])
    expect(wrapper.find('.played').exists()).toBe(false)
    expect(wrapper.find('.dd-legend').exists()).toBe(false)
  })

  test('marks the contract played', () => {
    const wrapper = mount(DoubleDummyTable, {
      props: { analysis: READY, highlight: { declarer: 'S', strain: 'S' } },
    })

    const played = wrapper.findAll('.played')
    expect(played).toHaveLength(1)
    expect(played[0].attributes('data-cell')).toBe('SS')
    expect(played[0].text()).toBe('9 (the contract played at this table)')
    expect(wrapper.get('.dd-legend').text()).toBe('The contract played at this table')
  })

  test('pending, unavailable, and nothing before it is read', () => {
    expect(mount(DoubleDummyTable, { props: { analysis: PENDING } }).get('.dd-note').text()).toBe(
      DOUBLE_DUMMY_PENDING,
    )
    expect(
      mount(DoubleDummyTable, { props: { analysis: { status: 'unavailable', table: null } } })
        .get('.dd-note')
        .text(),
    ).toContain("isn't available")
    expect(mount(DoubleDummyTable, { props: { analysis: null } }).find('.double-dummy').exists()).toBe(false)
  })
})

describe('LeadAnalysis', () => {
  test("the leader's cards as held, the lead made marked, the best ringed, then in words", () => {
    const wrapper = mount(LeadAnalysis, {
      props: { leads: LEADS, leader: 'E', lead: lead('E', card('H', 15)), mySeat: 'E' },
    })

    expect(wrapper.get('.lead-title').text()).toBe('Opening lead · East')
    const leads = wrapper.findAll('.lead')
    expect(leads.map((l) => l.attributes('data-card'))).toEqual(['35', '22', '63', '53', '5'])
    expect(leads.map((l) => l.get('.lead-tricks').text())).toEqual(['10', '10', '9', '10', '9'])
    expect(wrapper.findAll('.lead-suit')).toHaveLength(4)
    expect(leads[0].classes()).toContain('led')
    expect(leads[0].attributes('aria-label')).toBe('A of hearts: declarer makes 10, the lead made')
    expect(wrapper.findAll('.best').map((l) => l.attributes('data-card'))).toEqual(['63', '5'])
    expect(leads[2].attributes('aria-label')).toBe('3 of clubs: declarer makes 9, a best lead')
    expect(wrapper.get('.lead-legend').text()).toContain('the lead made is raised')
    expect(wrapper.get('.lead-summary').text()).toBe(
      'Your lead ♥A: declarer can make 10. Best was ♣3 or ♠5: 9.',
    )
  })

  test('no lead made: only the best', () => {
    const wrapper = mount(LeadAnalysis, { props: { leads: LEADS, leader: 'E', lead: null, mySeat: null } })

    expect(wrapper.find('.led').exists()).toBe(false)
    expect(wrapper.get('.lead-legend').text()).not.toContain('raised')
    expect(wrapper.get('.lead-summary').text()).toBe('Best lead ♣3 or ♠5: 9.')
  })
})

describe('BoardReview double dummy', () => {
  test('the table with the contract marked, and the opening lead', () => {
    useAuthStore().user = { ...bo, email: 'bo@example.com' } as never
    const wrapper = mount(BoardReview, { props: { review: review() } })

    expect(wrapper.get('.played').attributes('data-cell')).toBe('NS')
    expect(wrapper.get('.lead-title').text()).toBe('Opening lead · East')
    expect(wrapper.get('.led').attributes('data-card')).toBe('35')
    expect(wrapper.get('.lead-summary').text()).toBe(
      'Your lead ♥A: declarer can make 10. Best was ♣3 or ♠5: 9.',
    )
  })

  test('a passed-out board: only the table', () => {
    const passed = review({
      auction: [1, 2, 3, 4].map(() => ({ seat: 'N' as Seat, bid: pass })),
      contract: null,
      tricks: null,
      current_trick: null,
      tricks_won: null,
      dummy_hand: null,
      result: PASSED,
      double_dummy: { status: 'ready', table: TABLE, leads: null },
    })
    const wrapper = mount(BoardReview, { props: { review: passed } })

    expect(wrapper.findAll('.dd-table tbody tr')).toHaveLength(4)
    expect(wrapper.find('.played').exists()).toBe(false)
    expect(wrapper.find('.lead-analysis').exists()).toBe(false)
  })

  test('no analysis at all (an older payload): nothing', () => {
    const wrapper = mount(BoardReview, { props: { review: review({ double_dummy: undefined }) } })

    expect(wrapper.find('.double-dummy').exists()).toBe(false)
    expect(wrapper.find('.lead-analysis').exists()).toBe(false)
  })

  test('pending: the note, then the numbers once read again (once)', async () => {
    vi.useFakeTimers()
    const store = useHistoryStore()
    store.reviews[42] = review({ double_dummy: { status: 'pending', table: null, leads: null } })
    const wrapper = mount(
      { components: { BoardReview }, template: '<BoardReview :review="store.reviews[42]" />', setup: () => ({ store }) },
    )

    expect(wrapper.get('.dd-note').text()).toBe(DOUBLE_DUMMY_PENDING)
    expect(wrapper.find('.lead-analysis').exists()).toBe(false)

    answer(review())
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    await flushPromises()
    expect(http.get).toHaveBeenCalledWith('/playings/42')
    expect(wrapper.findAll('.dd-table tbody tr')).toHaveLength(4)
    expect(wrapper.find('.lead-analysis').exists()).toBe(true)
  })

  test('pending again after the reread, or a failed one: no loop', async () => {
    vi.useFakeTimers()
    const store = useHistoryStore()
    const pending = () => review({ double_dummy: { status: 'pending', table: null, leads: null } })
    store.reviews[42] = pending()
    const wrapper = mount(
      { components: { BoardReview }, template: '<BoardReview :review="store.reviews[42]" />', setup: () => ({ store }) },
    )

    vi.mocked(http.get).mockRejectedValueOnce(axiosError(500))
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    await flushPromises()
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS * 3)
    await flushPromises()
    expect(http.get).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.dd-note').text()).toBe(DOUBLE_DUMMY_PENDING)
  })

  test('leaving before the reread drops it', async () => {
    vi.useFakeTimers()
    const wrapper = mount(BoardReview, {
      props: { review: review({ double_dummy: { status: 'pending', table: null, leads: null } }) },
    })

    wrapper.unmount()
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    await nextTick()
    expect(http.get).not.toHaveBeenCalled()
  })

  test('another pending playing gets its own reread', async () => {
    vi.useFakeTimers()
    const pending = { status: 'pending' as const, table: null, leads: null }
    const wrapper = mount(BoardReview, { props: { review: review({ double_dummy: pending }) } })

    await wrapper.setProps({ review: review({ playing_id: 43, double_dummy: pending }) })
    answer(review({ playing_id: 43 }))
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    await flushPromises()
    expect(http.get).toHaveBeenCalledTimes(1)
    expect(http.get).toHaveBeenCalledWith('/playings/43')
  })
})

describe('BoardResultPanel double dummy line', () => {
  test('one line, with the review a tap away', async () => {
    const wrapper = mount(BoardResultPanel, {
      props: { result: result(), mySeat: 'S', doubleDummy: READY, reviewable: true },
    })

    expect(wrapper.get('.result-dd').text()).toBe('Double dummy: 4♠ by North makes 10 Review')
    await wrapper.get('.result-dd-review').trigger('click')
    expect(wrapper.emitted('review')).toHaveLength(1)
  })

  test('the note while pending; no button when there is nothing to review', () => {
    const wrapper = mount(BoardResultPanel, {
      props: { result: result(), mySeat: 'S', doubleDummy: PENDING },
    })

    expect(wrapper.get('.result-dd').text()).toBe(DOUBLE_DUMMY_PENDING)
    expect(wrapper.find('.result-dd-review').exists()).toBe(false)
  })

  test('nothing without it, or on a passed-out board', () => {
    expect(mount(BoardResultPanel, { props: { result: result(), mySeat: 'S' } }).find('.result-dd').exists()).toBe(
      false,
    )
    expect(
      mount(BoardResultPanel, { props: { result: PASSED, mySeat: 'S', doubleDummy: READY } })
        .find('.result-dd')
        .exists(),
    ).toBe(false)
  })
})

describe('BoardResultsPage double dummy', () => {
  const row = (playingId: number, overrides = {}) => ({
    playing_id: playingId,
    table_id: 3,
    players: PLAYERS,
    contract: fourSpades,
    doubled: 0 as const,
    declarer: 'N' as Seat,
    tricks_won: 10,
    score_ns: 420,
    made_by: 0,
    matchpoints: { ns: 2, ew: 0 },
    finished_at: '2026-09-29T12:00:00.000000Z',
    ...overrides,
  })
  const RESULTS: BoardResults = {
    board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
    top: 2,
    results: [
      row(42),
      row(43, {
        players: { N: user(5, 'ed'), E: user(6, 'fy'), S: user(7, 'gu'), W: user(8, 'ha') },
        declarer: 'S',
        matchpoints: { ns: 0, ew: 2 },
      }),
    ],
  }

  test('the table above the results, after them, with your contract marked', async () => {
    useAuthStore().user = { ...cy, email: 'cy@example.com' } as never
    answer(RESULTS)
    answer(READY)

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    expect(vi.mocked(http.get).mock.calls.map((c) => c[0])).toEqual([
      '/boards/7/results',
      '/boards/7/double-dummy',
    ])
    const html = wrapper.html()
    expect(html.indexOf('double-dummy')).toBeLessThan(html.indexOf('result-item'))
    expect(wrapper.get('.played').attributes('data-cell')).toBe('NS')
    expect(wrapper.get('.dd-legend').text()).toBe('Your contract')
  })

  test("someone who didn't declare a contract: nothing marked; pending: the note", async () => {
    useAuthStore().user = { ...cy, email: 'cy@example.com' } as never
    answer({ ...RESULTS, results: [row(42, { contract: null, declarer: null, made_by: null, tricks_won: null })] })
    answer(PENDING)

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    expect(wrapper.get('.dd-note').text()).toBe(DOUBLE_DUMMY_PENDING)
    expect(wrapper.find('.played').exists()).toBe(false)
  })

  test('results refused: no double dummy asked for', async () => {
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403))

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    expect(http.get).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.double-dummy').exists()).toBe(false)
  })
})
