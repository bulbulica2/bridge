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
  DOUBLE_DUMMY_UNAVAILABLE,
  bestLeads,
  ddTricks,
  defenceTricks,
  doubleDummyDiff,
  doubleDummyLine,
  doubleDummyLines,
  doubleDummyVerdict,
  leadMarkLabel,
  leadMarks,
  leadSummary,
  leadsInHandOrder,
  pbnOptimumResultTable,
} from '@/utils/doubleDummy'
import BoardReview from '@/components/BoardReview.vue'
import DoubleDummyTable from '@/components/DoubleDummyTable.vue'
import DummyColumns from '@/components/DummyColumns.vue'
import BoardResultsPage from '@/views/BoardResultsPage.vue'
import { setCardSize } from '@/utils/cardSize'

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
    expect(doubleDummyLine({ status: 'unavailable', table: null }, result())).toBe(DOUBLE_DUMMY_UNAVAILABLE)
    expect(doubleDummyLine({ status: 'unavailable', table: null }, PASSED)).toBeNull()
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

  test('the opening lead in words, counted for the defence', () => {
    const ace = lead('E', card('H', 15))
    expect(leadSummary(LEADS, ace, 'E', 'defence')).toBe(
      'Your lead ♥A: the defence can make 3. Best was ♣3 or ♠5: 4.',
    )
    expect(leadSummary(LEADS, lead('E', card('S', 5)), null, 'defence')).toBe(
      "East's lead ♠5: the defence can make 4. That was one of the best leads.",
    )
    expect(leadSummary(LEADS, null, null, 'defence')).toBe('Best lead ♣3 or ♠5: 4.')
    expect(leadSummary([{ card: card('S', 5), tricks: 9 }], null, null, 'defence')).toBe(
      'Every lead lets the defence make 4.',
    )
    expect(leadSummary([], null, null, 'defence')).toBeNull()
  })

  test("the defence's tricks: 13 less declarer's", () => {
    expect(defenceTricks(10)).toBe(3)
    expect(defenceTricks(0)).toBe(13)
    expect(defenceTricks(13)).toBe(0)
  })

  test("each lead's mark: the defence's tricks, the best, the lead made", () => {
    const marks = leadMarks(LEADS, lead('E', card('H', 15)))

    expect(marks).toEqual({
      5: { tricks: 4, best: true, led: false },
      35: { tricks: 3, best: false, led: true },
      22: { tricks: 3, best: false, led: false },
      53: { tricks: 3, best: false, led: false },
      63: { tricks: 4, best: true, led: false },
    })
    // No lead made: nothing marked as made.
    expect(Object.values(leadMarks(LEADS, null)).some((m) => m.led)).toBe(false)
    expect(leadMarks([], null)).toEqual({})
  })

  test('a marked card in words', () => {
    const king: Card = { id: 14, suit: 'S', rank: 14, rank_name: 'King' }

    expect(leadMarkLabel(king, { tricks: 4, best: true, led: false })).toBe(
      'King of spades: the defence makes 4, a best lead',
    )
    expect(leadMarkLabel(king, { tricks: 3, best: false, led: true })).toBe(
      'King of spades: the defence makes 3, the lead made',
    )
    expect(leadMarkLabel(king, { tricks: 4, best: true, led: true })).toBe(
      'King of spades: the defence makes 4, the lead made, a best lead',
    )
    expect(leadMarkLabel(king, { tricks: 2, best: false, led: false })).toBe('King of spades: the defence makes 2')
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

  test('settled: once the board is read, or still pending after its reread', async () => {
    vi.useFakeTimers()
    const id = ref<number | null>(7)
    const { dd } = run(() => id.value)
    expect(dd.settled.value).toBe(false)
    answer(PENDING)
    answer(PENDING)

    await dd.load()
    expect(dd.settled.value).toBe(false)
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    await flushPromises()
    expect(dd.settled.value).toBe(true)
    // A load again for the same board: no second reread, settled at once.
    answer(PENDING)
    await dd.load()
    expect(dd.settled.value).toBe(true)

    // Another board: not until it is read; a failure settles it too.
    id.value = 8
    expect(dd.settled.value).toBe(false)
    answer(READY)
    await dd.load()
    expect(dd.settled.value).toBe(true)
    id.value = 9
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403))
    await dd.load()
    expect(dd.settled.value).toBe(true)
    id.value = null
    expect(dd.settled.value).toBe(false)
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
    ).toBe("Double dummy analysis isn't set up on this server.")
    expect(mount(DoubleDummyTable, { props: { analysis: null } }).find('.double-dummy').exists()).toBe(false)
  })

  test('compact: the grid alone, the contract marked, no title, note or legend', () => {
    const wrapper = mount(DoubleDummyTable, {
      props: { analysis: READY, highlight: { declarer: 'S', strain: 'S' }, compact: true },
    })

    expect(wrapper.get('.double-dummy').classes()).toContain('dd-compact')
    expect(wrapper.find('.dd-title').exists()).toBe(false)
    expect(wrapper.find('.dd-legend').exists()).toBe(false)
    // The caption stays for a screen reader.
    expect(wrapper.get('.dd-caption').classes()).toContain('sr-only')
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(['Declarer', '♣', '♦', '♥', '♠', 'NT'])
    expect(wrapper.findAll('tbody tr').map((r) => r.get('th').text())).toEqual(['N', 'E', 'S', 'W'])
    expect(wrapper.get('.played').attributes('data-cell')).toBe('SS')
  })

  test('compact: nothing at all until it is ready', () => {
    const compact = (analysis: DoubleDummy | null) =>
      mount(DoubleDummyTable, { props: { analysis, compact: true } })

    for (const analysis of [PENDING, { status: 'unavailable', table: null } as DoubleDummy, null]) {
      const wrapper = compact(analysis)
      expect(wrapper.find('.double-dummy').exists()).toBe(false)
      expect(wrapper.text()).toBe('')
    }
    // Ready but without its grid: nothing either.
    expect(compact({ status: 'ready', table: null }).find('.double-dummy').exists()).toBe(false)
  })
})

describe('DummyColumns with lead marks', () => {
  const cards = [card('S', 14), card('S', 10), card('H', 3), card('C', 12)]
  const marks = {
    [card('S', 14).id]: { tricks: 4, best: true, led: false },
    [card('S', 10).id]: { tricks: 3, best: false, led: true },
    [card('H', 3).id]: { tricks: 10, best: false, led: false },
  }

  test('a pill right after each marked rank, best green, the lead made ringed, said in words', () => {
    const wrapper = mount(DummyColumns, { props: { cards, marks } })

    expect(wrapper.get('.dummy-columns').classes()).toContain('with-marks')
    const marked = wrapper.findAll('.marked')
    expect(marked.map((m) => m.attributes('data-card'))).toEqual(['14', '10', '23'])
    expect(marked.map((m) => m.get('.rank-text').text())).toEqual(['K', '10', '3'])
    expect(marked.map((m) => m.get('.lead-pill').text())).toEqual(['4', '3', '10'])
    expect(marked[0].classes()).toContain('best')
    expect(marked[0].classes()).not.toContain('led')
    expect(marked[1].classes()).toContain('led')
    expect(marked[2].classes()).not.toContain('best')
    expect(marked[0].attributes('role')).toBe('img')
    expect(marked[0].attributes('aria-label')).toBe('14 of spades: the defence makes 4, a best lead')
    expect(marked[1].attributes('aria-label')).toBe('10 of spades: the defence makes 3, the lead made')
    // A card without a mark is a plain rank.
    const plain = wrapper.findAll('.rank:not(.marked)')
    expect(plain.map((r) => r.text())).toEqual(['J'])
  })

  test('without marks: plain ranks, no pills, the usual size', () => {
    const wrapper = mount(DummyColumns, { props: { cards } })

    expect(wrapper.get('.dummy-columns').classes()).not.toContain('with-marks')
    expect(wrapper.find('.lead-pill').exists()).toBe(false)
    expect(wrapper.findAll('.rank').map((r) => r.text())).toEqual(['K', '10', '3', 'J'])
  })
})

describe('BoardReview double dummy', () => {
  const corner = (wrapper: ReturnType<typeof mount>) => wrapper.find('.corner-bottom-right')
  const control = (wrapper: ReturnType<typeof mount>, label: string) =>
    wrapper.get(`ion-button[aria-label="${label}"]`)

  test('the small grid bottom right, the contract marked, before the lead only; the opening lead below', async () => {
    useAuthStore().user = { ...bo, email: 'bo@example.com' } as never
    const wrapper = mount(BoardReview, { props: { review: review() } })

    expect(wrapper.get('.bridge-table').classes()).toContain('room-bottom-right')
    const grid = corner(wrapper).get('.double-dummy')
    expect(grid.classes()).toContain('dd-compact')
    expect(grid.classes()).not.toContain('layer-off')
    expect(grid.attributes('aria-hidden')).toBeUndefined()
    expect(grid.get('.played').attributes('data-cell')).toBe('NS')
    // Only the one, in the corner.
    expect(wrapper.findAll('.double-dummy')).toHaveLength(1)
    expect(wrapper.get('.lead-summary').text()).toBe(
      'Your lead ♥A: the defence can make 3. Best was ♣3 or ♠5: 4.',
    )

    // From the first card it keeps its room, unseen.
    await control(wrapper, 'Next card').trigger('click')
    expect(corner(wrapper).get('.double-dummy').classes()).toContain('layer-off')
    expect(corner(wrapper).get('.double-dummy').attributes('aria-hidden')).toBe('true')

    await control(wrapper, 'Before the opening lead').trigger('click')
    expect(corner(wrapper).get('.double-dummy').classes()).not.toContain('layer-off')
  })

  // Every card East held, ♥A to ♥2: declarer makes 10 after the honours,
  // 9 after the small ones.
  const EAST_LEADS: LeadTricks[] = DEAL.E.map((c) => ({ card: c, tricks: c.rank > 10 ? 10 : 9 }))
  const withEast = () =>
    review({ double_dummy: { status: 'ready', table: TABLE, leads: EAST_LEADS } })
  const seatOf = (wrapper: ReturnType<typeof mount>, seat: Seat) => wrapper.get(`.seat[data-seat="${seat}"]`)

  test("before the lead, a pill on each of the leader's cards: the leader at the bottom", async () => {
    useAuthStore().user = { ...bo, email: 'bo@example.com' } as never
    const wrapper = mount(BoardReview, { props: { review: withEast() } })

    const east = seatOf(wrapper, 'E')
    expect(east.classes()).toContain('side-bottom')
    const marked = east.findAll('.marked')
    expect(marked).toHaveLength(13)
    expect(marked.map((m) => m.get('.lead-pill').text())).toEqual([
      '3', '3', '3', '3', '4', '4', '4', '4', '4', '4', '4', '4', '4',
    ])
    expect(marked[0].classes()).toContain('led')
    expect(marked[0].classes()).not.toContain('best')
    expect(marked[0].attributes('aria-label')).toBe('15 of hearts: the defence makes 3, the lead made')
    expect(marked[4].classes()).toContain('best')
    expect(marked[4].attributes('aria-label')).toBe('10 of hearts: the defence makes 4, a best lead')
    expect(east.get('.dummy-columns').classes()).toContain('with-marks')
    // Only the leader's hand.
    expect(wrapper.findAll('.with-marks')).toHaveLength(1)
    expect(wrapper.get('.lead-summary').text()).toBe(
      'Your lead ♥A: the defence can make 3. Best was ♥10, ♥9, ♥8, ♥7, ♥6, ♥5, ♥4, ♥3 or ♥2: 4.',
    )

    // From the first card on, none, and the hand its usual size; back
    // before the lead, there again.
    await control(wrapper, 'Next card').trigger('click')
    expect(wrapper.find('.marked').exists()).toBe(false)
    expect(wrapper.find('.with-marks').exists()).toBe(false)
    expect(wrapper.find('.lead-summary').exists()).toBe(true)
    await control(wrapper, 'End of the play').trigger('click')
    expect(wrapper.find('.marked').exists()).toBe(false)
    await control(wrapper, 'Before the opening lead').trigger('click')
    expect(seatOf(wrapper, 'E').findAll('.marked')).toHaveLength(13)
  })

  test('the leader on a side seat (the viewer declared) and at the top (partner led)', () => {
    useAuthStore().user = { ...ann, email: 'ann@example.com' } as never
    const declarer = mount(BoardReview, { props: { review: withEast() } })

    expect(seatOf(declarer, 'E').classes()).toContain('side-left')
    expect(seatOf(declarer, 'E').findAll('.marked')).toHaveLength(13)
    expect(declarer.get('.lead-summary').text()).toContain("East's lead ♥A")

    useAuthStore().user = { ...di, email: 'di@example.com' } as never
    const partner = mount(BoardReview, { props: { review: withEast() } })

    expect(seatOf(partner, 'E').classes()).toContain('side-top')
    expect(seatOf(partner, 'E').findAll('.marked')).toHaveLength(13)
  })

  test('leaving the step before the lead, the table keeps its height there, until let go', async () => {
    const wrapper = mount(BoardReview, { props: { review: withEast() }, attachTo: document.body })
    const box = () => wrapper.get('.review-table').element as HTMLElement
    vi.spyOn(box(), 'getBoundingClientRect').mockReturnValue({ height: 612 } as DOMRect)

    expect(box().style.minHeight).toBe('')
    await control(wrapper, 'Next card').trigger('click')
    expect(box().style.minHeight).toBe('612px')
    // Further on, still held.
    await control(wrapper, 'Next trick').trigger('click')
    expect(box().style.minHeight).toBe('612px')

    // A phone's address bar (the height alone) keeps it; a new width lets go.
    window.dispatchEvent(new Event('resize'))
    expect(box().style.minHeight).toBe('612px')
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width + 100 })
    window.dispatchEvent(new Event('resize'))
    expect(box().style.minHeight).toBe('')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })

    // Back before the lead, let go; held again on leaving it; another card
    // size lets go.
    await control(wrapper, 'Next card').trigger('click')
    expect(box().style.minHeight).toBe('')
    await control(wrapper, 'Before the opening lead').trigger('click')
    await control(wrapper, 'Next card').trigger('click')
    expect(box().style.minHeight).toBe('612px')
    await control(wrapper, 'Before the opening lead').trigger('click')
    expect(box().style.minHeight).toBe('')
    await control(wrapper, 'Next card').trigger('click')
    setCardSize('xlarge')
    await nextTick()
    expect(box().style.minHeight).toBe('')
    setCardSize('large')
    wrapper.unmount()
  })

  test('no pills, nothing held', async () => {
    const wrapper = mount(BoardReview, {
      props: { review: review({ double_dummy: { status: 'pending', table: null, leads: null } }) },
    })

    await control(wrapper, 'Next card').trigger('click')
    expect((wrapper.get('.review-table').element as HTMLElement).style.minHeight).toBe('')
  })

  test('nobody seated: South at the bottom, the leader on the right', () => {
    const wrapper = mount(BoardReview, { props: { review: withEast() } })

    expect(seatOf(wrapper, 'E').classes()).toContain('side-right')
    expect(seatOf(wrapper, 'E').findAll('.marked')).toHaveLength(13)
  })

  test('a passed-out board: only the grid, nothing marked', () => {
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

    expect(corner(wrapper).findAll('.dd-table tbody tr')).toHaveLength(4)
    expect(wrapper.find('.played').exists()).toBe(false)
    expect(wrapper.find('.lead-summary').exists()).toBe(false)
    expect(wrapper.find('.marked').exists()).toBe(false)
  })

  test('no analysis at all (an older payload): an empty corner', () => {
    const wrapper = mount(BoardReview, { props: { review: review({ double_dummy: undefined }) } })

    expect(corner(wrapper).exists()).toBe(false)
    expect(wrapper.get('.bridge-table').classes()).not.toContain('room-bottom-right')
    expect(wrapper.find('.double-dummy').exists()).toBe(false)
    expect(wrapper.find('.marked').exists()).toBe(false)
  })

  test('a server without a solver: an empty corner, no words about it, never read again', async () => {
    vi.useFakeTimers()
    const wrapper = mount(BoardReview, {
      props: { review: review({ double_dummy: { status: 'unavailable', table: null, leads: null } }) },
    })

    expect(corner(wrapper).exists()).toBe(false)
    expect(wrapper.find('.double-dummy').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(DOUBLE_DUMMY_UNAVAILABLE)
    expect(wrapper.text()).not.toContain('Double dummy')
    expect(wrapper.find('.marked').exists()).toBe(false)
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    await nextTick()
    expect(http.get).not.toHaveBeenCalled()
  })

  test('pending: an empty corner, then the grid once read again (once)', async () => {
    vi.useFakeTimers()
    const store = useHistoryStore()
    store.reviews[42] = review({ double_dummy: { status: 'pending', table: null, leads: null } })
    const wrapper = mount(
      { components: { BoardReview }, template: '<BoardReview :review="store.reviews[42]" />', setup: () => ({ store }) },
    )

    expect(corner(wrapper).exists()).toBe(false)
    expect(wrapper.text()).not.toContain(DOUBLE_DUMMY_PENDING)
    expect(wrapper.find('.marked').exists()).toBe(false)

    answer(review())
    vi.advanceTimersByTime(DOUBLE_DUMMY_REREAD_MS)
    await flushPromises()
    expect(http.get).toHaveBeenCalledWith('/playings/42')
    expect(corner(wrapper).findAll('.dd-table tbody tr')).toHaveLength(4)
    expect(wrapper.find('.lead-summary').exists()).toBe(true)
    // The leads that are in East's hand: ♥A and ♥2.
    expect(wrapper.findAll('.marked').map((m) => m.attributes('data-card'))).toEqual(['35', '22'])
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
    expect(corner(wrapper).exists()).toBe(false)
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

  test('a server without a solver: the note', async () => {
    useAuthStore().user = { ...cy, email: 'cy@example.com' } as never
    answer(RESULTS)
    answer({ status: 'unavailable', table: null })

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    expect(wrapper.get('.dd-note').text()).toBe(DOUBLE_DUMMY_UNAVAILABLE)
    expect(wrapper.find('.dd-table').exists()).toBe(false)
  })

  test('results refused: no double dummy asked for', async () => {
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403))

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    expect(http.get).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.double-dummy').exists()).toBe(false)
  })
})

describe('how declarer did against double dummy', () => {
  test('the tricks taken less the tricks double dummy makes', () => {
    expect(doubleDummyDiff(READY, result())).toBe(0)
    expect(doubleDummyDiff(READY, result({ made_by: 2 }))).toBe(2)
    expect(doubleDummyDiff(READY, result({ made_by: -1 }))).toBe(-1)
  })

  test('nothing to compare before it is solved, without a solver, or with no contract', () => {
    expect(doubleDummyDiff(null, result())).toBeNull()
    expect(doubleDummyDiff(PENDING, result())).toBeNull()
    expect(doubleDummyDiff({ status: 'unavailable', table: null }, result())).toBeNull()
    expect(doubleDummyDiff(READY, PASSED)).toBeNull()
    // A table without that declarer's row.
    expect(doubleDummyDiff({ status: 'ready', table: {} as Grid }, result())).toBeNull()
    expect(doubleDummyVerdict(PENDING, result(), 'N')).toBeNull()
  })

  test('"You" for the declarer, "Declarer" for everyone else', () => {
    expect(doubleDummyVerdict(READY, result(), 'N')).toBe('You found every trick.')
    expect(doubleDummyVerdict(READY, result(), 'S')).toBe('Declarer found every trick.')
    expect(doubleDummyVerdict(READY, result({ made_by: -3 }), null)).toBe('Declarer took 3 fewer.')
  })
})
