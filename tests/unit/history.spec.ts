import { AxiosError, AxiosHeaders } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import http from '@/services/http'
import {
  getBoardResults,
  getMyPlayings,
  getUserPlayings,
} from '@/services/history'
import type { BoardResultRow, BoardResults, Page, PlayingHistoryEntry } from '@/services/history'
import type { Bid } from '@/services/game'
import type { PublicUser } from '@/services/users'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import { matchpointPercent, seatOfUser } from '@/utils/result'
import BoardResultsPage from '@/views/BoardResultsPage.vue'
import HistoryPage from '@/views/HistoryPage.vue'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn() },
}))

const route = { params: { id: '7' } as Record<string, string> }
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => route,
}))
const navigate = vi.fn()
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})

function axiosError(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data, statusText: '', headers: {}, config }
  return error
}

function user(id: number, username: string): PublicUser {
  return { id, name: username.toUpperCase(), username, description: null }
}

const ann = user(1, 'ann')
const bo = user(2, 'bo')
const cy = user(3, 'cy')
const di = user(4, 'di')
const board = { id: 7, number: 7, dealer: 'S' as const, vulnerable: 'N-S E-W' as const }
const fourSpades: Bid = { id: 22, call: '4S', level: 4, strain: 'S', special: false }

function entry(playingId: number, overrides: Partial<PlayingHistoryEntry> = {}): PlayingHistoryEntry {
  return {
    playing_id: playingId,
    table_id: 3,
    board,
    seat: 'E',
    partner: di,
    contract: fourSpades,
    doubled: 0,
    declarer: 'N',
    tricks_won: 10,
    score_ns: 620,
    made_by: 0,
    score: -620,
    finished_at: '2026-09-29T12:00:00.000000Z',
    ...overrides,
  }
}

function page(entries: PlayingHistoryEntry[], current: number, last: number): Page<PlayingHistoryEntry> {
  return {
    current_page: current,
    data: entries,
    last_page: last,
    next_page_url: current < last ? `/api/user/playings?page=${current + 1}` : null,
    per_page: 20,
    total: 20 * (last - 1) + entries.length,
  }
}

function row(playingId: number, overrides: Partial<BoardResultRow> = {}): BoardResultRow {
  return {
    playing_id: playingId,
    table_id: 3,
    players: { N: ann, E: bo, S: cy, W: di },
    contract: fourSpades,
    doubled: 0,
    declarer: 'N',
    tricks_won: 10,
    score_ns: 620,
    made_by: 0,
    matchpoints: { ns: 2, ew: 0 },
    finished_at: '2026-09-29T12:00:00.000000Z',
    ...overrides,
  }
}

// Two tables on board 7: ann's (N-S made 620) beat the other (N-S −100).
const RESULTS: BoardResults = {
  board,
  top: 2,
  results: [
    row(42),
    row(43, {
      table_id: null,
      players: { N: user(5, 'ed'), E: user(6, 'fy'), S: user(7, 'gu'), W: user(8, 'ha') },
      tricks_won: 9,
      score_ns: -100,
      made_by: -1,
      matchpoints: { ns: 0, ew: 2 },
    }),
  ],
}

function answer(data: unknown) {
  vi.mocked(http.get).mockResolvedValueOnce({ data: { status: 200, message: 'OK', data } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  route.params = { id: '7' }
})

describe('history service', () => {
  test('getMyPlayings reads a page of the own history', async () => {
    answer(page([entry(42)], 1, 1))

    await expect(getMyPlayings(2)).resolves.toMatchObject({ data: [entry(42)] })
    expect(http.get).toHaveBeenCalledWith('/api/user/playings', { params: { page: 2 } })
  })

  test("getUserPlayings reads another player's history", async () => {
    answer(page([entry(42)], 1, 1))

    await getUserPlayings(9, 3)

    expect(http.get).toHaveBeenCalledWith('/users/9/playings', { params: { page: 3 } })
  })

  test('getBoardResults unwraps the envelope', async () => {
    answer(RESULTS)

    await expect(getBoardResults(7)).resolves.toEqual(RESULTS)
    expect(http.get).toHaveBeenCalledWith('/boards/7/results')
  })

  test("getBoardResults rejects with the 403 for a board you haven't finished", async () => {
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403, { message: 'This action is unauthorized.' }))

    await expect(getBoardResults(7)).rejects.toMatchObject({ response: { status: 403 } })
  })
})

describe('history store', () => {
  test('loadHistory keeps the first page and says whether there is more', async () => {
    answer(page([entry(42), entry(41)], 1, 2))
    const store = useHistoryStore()

    await store.loadHistory(null)

    expect(store.listOf(null)).toMatchObject({ page: 1, lastPage: 2, total: 22 })
    expect(store.listOf(null)!.entries.map((e) => e.playing_id)).toEqual([42, 41])
    expect(store.hasMore(null)).toBe(true)
  })

  test('loadMore appends the next page and skips rows that slid down into it', async () => {
    answer(page([entry(42), entry(41)], 1, 2))
    const store = useHistoryStore()
    await store.loadHistory(null)
    // A board finished meanwhile pushed 41 onto page 2.
    answer(page([entry(41), entry(40)], 2, 2))

    await store.loadMore(null)

    expect(http.get).toHaveBeenLastCalledWith('/api/user/playings', { params: { page: 2 } })
    expect(store.listOf(null)!.entries.map((e) => e.playing_id)).toEqual([42, 41, 40])
    expect(store.hasMore(null)).toBe(false)
  })

  test('loadMore on the last page asks for nothing', async () => {
    answer(page([entry(42)], 1, 1))
    const store = useHistoryStore()
    await store.loadHistory(null)

    await store.loadMore(null)

    expect(http.get).toHaveBeenCalledTimes(1)
  })

  test("another player's history is kept apart from the own one", async () => {
    answer(page([entry(42)], 1, 1))
    answer(page([entry(50, { seat: 'N' })], 1, 1))
    const store = useHistoryStore()

    await store.loadHistory(null)
    await store.loadHistory(9)

    expect(http.get).toHaveBeenLastCalledWith('/users/9/playings', { params: { page: 1 } })
    expect(store.listOf(null)!.entries[0].playing_id).toBe(42)
    expect(store.listOf(9)!.entries[0].playing_id).toBe(50)
  })

  test('loadResults caches a board and a 403 drops it', async () => {
    answer(RESULTS)
    const store = useHistoryStore()
    await store.loadResults(7)
    expect(store.results[7]).toEqual(RESULTS)

    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403, { message: 'This action is unauthorized.' }))

    await expect(store.loadResults(7)).rejects.toMatchObject({ response: { status: 403 } })
    expect(store.results[7]).toBeUndefined()
  })

  test('a failed page keeps what was already shown', async () => {
    answer(page([entry(42)], 1, 2))
    const store = useHistoryStore()
    await store.loadHistory(null)
    vi.mocked(http.get).mockRejectedValueOnce(new Error('Network Error'))

    await expect(store.loadMore(null)).rejects.toThrow('Network Error')
    expect(store.listOf(null)!.entries).toHaveLength(1)
  })

  test('clear forgets everything (on logout)', async () => {
    answer(RESULTS)
    const store = useHistoryStore()
    await store.loadResults(7)

    store.clear()

    expect(store.results).toEqual({})
    expect(store.lists).toEqual({})
  })
})

describe('matchpoint helpers', () => {
  test('matchpointPercent is a share of the top, or null with nothing to compare', () => {
    expect(matchpointPercent(5, 6)).toBe(83)
    expect(matchpointPercent(0, 6)).toBe(0)
    expect(matchpointPercent(0, 0)).toBeNull()
  })

  test("seatOfUser finds the user's seat in a snapshot", () => {
    expect(seatOfUser({ N: ann, E: bo, S: cy, W: di }, 4)).toBe('W')
    expect(seatOfUser({ N: ann, E: null, S: cy, W: di }, 2)).toBeNull()
    expect(seatOfUser({ N: ann }, undefined)).toBeNull()
  })
})

// Logged in as bo (id 2), who sat East at table 3.
function loginAs(u: PublicUser) {
  useAuthStore().user = { ...u, email: `${u.username}@example.com` } as never
}

describe('BoardResultsPage', () => {
  test("highlights the viewer's table with their side's matchpoint %", async () => {
    loginAs(bo)
    answer(RESULTS)

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    const items = wrapper.findAll('.result-item')
    expect(items).toHaveLength(2)
    expect(items[0].classes()).toContain('mine')
    expect(items[1].classes()).not.toContain('mine')
    expect(items[1].text()).toContain('Table closed')
    // Each contract in table notation: just made, one down.
    expect(items[0].get('.result-contract').text()).toBe('4♠ by N = · 10 tricks')
    expect(items[1].get('.result-contract').text()).toBe('4♠ by N −1 · 9 tricks')
    // bo sat E-W, which scored 0 of 2 matchpoints on that table.
    expect(wrapper.find('.summary-value').text()).toBe('0%')
    expect(wrapper.find('.summary-detail').text()).toContain('0 of 2 matchpoints')
    expect(wrapper.find('.summary-detail').text()).toContain('E-W −620')
    // Both sides vulnerable, bo's too, and who dealt.
    expect(wrapper.get('.board-info .vul-label').text()).toBe('Vulnerable: Both (you too)')
    expect(wrapper.get('.board-info').text()).toContain('Dealer South')
  })

  test('says there is nothing to compare when only one table has finished', async () => {
    loginAs(ann)
    answer({ board, top: 0, results: [row(42, { matchpoints: { ns: 0, ew: 0 } })] })

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    expect(wrapper.find('.summary-value').exists()).toBe(false)
    expect(wrapper.find('.summary').text()).toContain('No other table has finished this board yet')
  })

  test("explains the 403 for a board you haven't finished", async () => {
    loginAs(ann)
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403, { message: 'This action is unauthorized.' }))

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    expect(wrapper.find('.gone').text()).toContain('once you have finished it yourself')
    expect(wrapper.find('.result-item').exists()).toBe(false)
  })

  test('a bad id asks for nothing', async () => {
    loginAs(ann)
    route.params = { id: 'abc' }

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    expect(http.get).not.toHaveBeenCalled()
    expect(wrapper.find('.gone').text()).toContain("doesn't exist")
  })
})

describe('HistoryPage', () => {
  test('lists the finished boards, each opening its replay', async () => {
    loginAs(bo)
    answer(
      page(
        [
          entry(42),
          entry(41, { contract: null, declarer: null, made_by: null, score_ns: 0, score: 0, tricks_won: null, doubled: null }),
          entry(40, { doubled: 1, made_by: 2, tricks_won: 12, score_ns: 990, score: -990 }),
        ],
        1,
        1,
      ),
    )

    const wrapper = mount(HistoryPage)
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/api/user/playings', { params: { page: 1 } })
    const items = wrapper.findAllComponents({ name: 'IonItem' })
    expect(items).toHaveLength(3)
    expect(items[0].props('routerLink')).toBe('/playings/42')
    expect(items[0].text()).toContain('You sat East with di')
    expect(items[0].get('.entry-contract').text()).toBe('4♠ by N =')
    expect(items[0].text()).toContain('−620')
    expect(items[1].get('.entry-contract').text()).toBe('Passed out')
    expect(items[2].get('.entry-contract').text()).toBe('4♠X by N +2')
  })

  test('shows the empty state', async () => {
    loginAs(bo)
    answer(page([], 1, 1))

    const wrapper = mount(HistoryPage)
    await flushPromises()

    expect(wrapper.text()).toContain("You haven't finished a board yet")
  })

  test('a 401 goes back to login', async () => {
    loginAs(bo)
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(401, { message: 'Unauthenticated.' }))

    mount(HistoryPage)
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })
})
