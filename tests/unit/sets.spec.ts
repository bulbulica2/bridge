import { AxiosError, AxiosHeaders } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import http from '@/services/http'
import { getSet } from '@/services/history'
import type { PlayingHistoryEntry, SetBoardRow, SetResults } from '@/services/history'
import type { Bid, PublicPlaying, SetPosition } from '@/services/game'
import type { BroadcastTable, Seat } from '@/services/tables'
import type { PublicUser } from '@/services/users'
import SetResultsPanel from '@/components/SetResultsPanel.vue'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import {
  currentSet,
  forfeitText,
  forfeitedSeat,
  groupBySet,
  setLabel,
  setTitle,
  setTotals,
  setWinnerText,
} from '@/utils/sets'
import HistoryPage from '@/views/HistoryPage.vue'
import SetResultsPage from '@/views/SetResultsPage.vue'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn() },
}))

const route = { params: { id: '5' } as Record<string, string> }
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

function answer(data: unknown) {
  vi.mocked(http.get).mockResolvedValueOnce({ data: { status: 200, message: 'OK', data } })
}

function user(id: number, username: string): PublicUser {
  return { id, name: username.toUpperCase(), username, description: null, is_robot: false }
}

const ann = user(1, 'ann')
const bo = user(2, 'bo')
const cy = user(3, 'cy')
const di = user(4, 'di')
const fourSpades: Bid = { id: 22, call: '4S', level: 4, strain: 'S', special: false }

function boardRow(position: number, scoreNs: number, overrides: Partial<SetBoardRow> = {}): SetBoardRow {
  return {
    position,
    playing_id: 40 + position,
    board: { id: position, number: 10 + position, dealer: 'N', vulnerable: '' },
    contract: fourSpades,
    doubled: 0,
    declarer: 'N',
    tricks_won: 10,
    score_ns: scoreNs,
    made_by: 0,
    claimed: false,
    top: 2,
    matchpoints: { ns: 2, ew: 0 },
    ...overrides,
  }
}

// Set 3 at table 9, all four boards played: N-S +1160 overall.
function results(overrides: Partial<SetResults> = {}): SetResults {
  return {
    id: 5,
    number: 3,
    table_id: 9,
    of: 4,
    boards_dealt: 4,
    started_at: '2026-10-01T12:00:00Z',
    finished_at: '2026-10-01T13:00:00Z',
    finished: true,
    ended: 'completed',
    forfeited_by: null,
    players: { N: ann, E: bo, S: cy, W: di },
    boards: [
      boardRow(1, 420),
      boardRow(2, 420),
      boardRow(3, -100, { declarer: 'E', made_by: -1, matchpoints: { ns: 1, ew: 1 } }),
      boardRow(4, 420, { top: 0, matchpoints: { ns: 0, ew: 0 } }),
    ],
    totals: { score: { ns: 1160, ew: -1160 }, matchpoints: { ns: 5, ew: 1 }, top: 6 },
    winner: 'NS',
    ...overrides,
  }
}

function position(overrides: Partial<SetPosition> = {}): SetPosition {
  return { id: 5, number: 3, board: 2, of: 4, finished: false, ended: null, forfeited_by: null, ...overrides }
}

function table(set: SetPosition | null, seated: [Seat, PublicUser][] = [['N', ann], ['E', bo], ['S', cy], ['W', di]]): BroadcastTable {
  return {
    id: 9,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: 7,
    unattended_since: null,
    created_at: '',
    updated_at: '',
    seats: seated.map(([seat, u], i) => ({ id: i + 1, table_id: 9, user_id: u.id, seat, ready: false, user: u })),
    free_seats: [],
    set,
  }
}

function entry(playingId: number, set: PlayingHistoryEntry['set'], score: number): PlayingHistoryEntry {
  return {
    playing_id: playingId,
    table_id: 9,
    set,
    board: { id: playingId, number: playingId, dealer: 'N', vulnerable: '' },
    seat: 'E',
    partner: di,
    contract: fourSpades,
    doubled: 0,
    declarer: 'N',
    tricks_won: 10,
    score_ns: -score,
    made_by: 0,
    score,
    finished_at: '2026-10-01T12:00:00.000000Z',
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  route.params = { id: '5' }
})

describe('set helpers', () => {
  test('the set bar', () => {
    expect(setLabel(position())).toBe('Board 2 of 4 · Set 3')
  })

  test("the table's set and the board's agree on whatever either knows", () => {
    const fromTable = position({ board: 4 })
    const fromBoard = position({ board: 4, finished: true, ended: 'completed' })
    // The last board finishing sends no TableUpdated: the board knows.
    expect(currentSet(table(fromTable), { set: fromBoard } as PublicPlaying)).toMatchObject({
      finished: true,
      ended: 'completed',
    })
    // A forfeit between boards comes with the table only.
    const forfeit = position({ finished: true, ended: 'forfeit', forfeited_by: 'EW' })
    expect(currentSet(table(forfeit), { set: position() } as PublicPlaying)).toMatchObject({
      finished: true,
      forfeited_by: 'EW',
    })
    // A new set beats the old one, whichever holds it.
    const next = position({ id: 6, number: 4, board: 1 })
    expect(currentSet(table(next), { set: fromBoard } as PublicPlaying)).toBe(next)
    expect(currentSet(null, { set: next } as PublicPlaying)).toBe(next)
    expect(currentSet(table(null), null)).toBeNull()
  })

  test('the title, while it goes on and once over', () => {
    expect(setTitle(results())).toBe('Set 3 over')
    expect(setTitle(results({ finished: false, ended: null, boards: [boardRow(1, 420)] }))).toBe(
      'Set 3: 1 of 4 boards played',
    )
  })

  test("the winner from each side's point of view", () => {
    expect(setWinnerText(results(), 'N')).toBe('You won the set.')
    expect(setWinnerText(results(), 'W')).toBe('You lost the set.')
    expect(setWinnerText(results(), null)).toBe('N-S won the set.')
    expect(setWinnerText(results({ winner: 'EW' }), null)).toBe('E-W won the set.')
    expect(setWinnerText(results({ winner: null }), 'N')).toBe('A tie: no winner.')
    expect(setWinnerText(results({ ended: 'abandoned', winner: null }), 'N')).toBe('Abandoned: no winner.')
    expect(setWinnerText(results({ finished: false, ended: null, winner: null }), 'N')).toBeNull()
  })

  test('a forfeit: who won it, who gave it up and why', () => {
    const forfeit = results({ ended: 'forfeit', forfeited_by: 'EW', winner: 'NS' })
    expect(setWinnerText(forfeit, 'S')).toBe('You won the set by forfeit.')
    expect(setWinnerText(forfeit, 'E')).toBe('You lost the set by forfeit.')
    // East's seat is free (or someone else's) now: East is who went.
    const gone = forfeitedSeat(forfeit, table(position(), [['N', ann], ['S', cy], ['W', di]]))
    expect(gone).toBe('E')
    expect(forfeitText(forfeit, gone)).toBe("E-W forfeited, East didn't come back in time.")
    expect(forfeitText(forfeit)).toBe('E-W forfeited the set.')
    expect(forfeitedSeat(forfeit, null)).toBeNull()
    expect(forfeitText(results())).toBeNull()
  })

  test("the totals turned to the viewer's side", () => {
    expect(setTotals(results(), 'E')).toEqual({ side: 'ew', score: -1160, matchpoints: 1, top: 6, percent: 17 })
    expect(setTotals(results(), null)).toMatchObject({ side: 'ns', score: 1160, percent: 83 })
  })

  test('the history in runs of one set, each with its total', () => {
    const one = { id: 5, number: 3, board: 0, of: 4 }
    const two = { id: 4, number: 2, board: 0, of: 4 }
    const groups = groupBySet([
      entry(48, { ...one, board: 2 }, 420),
      entry(47, { ...one, board: 1 }, -100),
      entry(46, { ...two, board: 4 }, 50),
      entry(45, null, 620),
    ])
    expect(groups.map((g) => [g.set?.id ?? null, g.entries.map((e) => e.playing_id), g.score])).toEqual([
      [5, [48, 47], 320],
      [4, [46], 50],
      [null, [45], 620],
    ])
    expect(new Set(groups.map((g) => g.key)).size).toBe(3)
  })
})

describe('SetResultsPanel', () => {
  test("an E-W player's view: each board and the totals from their side", () => {
    const wrapper = mount(SetResultsPanel, { props: { set: results(), mySeat: 'E' } })

    expect(wrapper.get('.set-title').text()).toBe('Set 3 over')
    expect(wrapper.get('.set-winner').text()).toBe('You lost the set.')
    expect(wrapper.get('.set-winner').classes()).toContain('score-minus')
    const rows = wrapper.findAllComponents({ name: 'IonItem' })
    expect(rows).toHaveLength(4)
    expect(rows[0].props('routerLink')).toBe('/playings/41')
    expect(rows[0].text()).toContain('1. Board 11')
    expect(rows[0].text()).toContain('4♠ by N, made')
    expect(rows[0].get('.set-row-score').text()).toBe('−420')
    expect(rows[0].get('.set-row-mp').text()).toBe('MP 0%')
    expect(rows[2].get('.set-row-score').text()).toBe('+100')
    // Only this table has played board 4: nothing to compare with.
    expect(rows[3].get('.set-row-mp').text()).toBe('MP —')
    expect(wrapper.get('.set-total-value').text()).toBe('−1160')
    expect(wrapper.get('.set-total-sides').text()).toContain('N-S +1160')
    expect(wrapper.get('.side-mine').text()).toContain('E-W −1160')
    expect(wrapper.get('.set-total-mp').text()).toBe('Matchpoints: 1 of 6 (17%)')
    expect(wrapper.find('.set-forfeit').exists()).toBe(false)
  })

  test('a forfeit names the side and the player who went', () => {
    const forfeit = results({ ended: 'forfeit', forfeited_by: 'NS', winner: 'EW', boards: [boardRow(1, 420)] })
    const wrapper = mount(SetResultsPanel, { props: { set: forfeit, mySeat: 'W', gone: 'N' } })

    expect(wrapper.get('.set-winner').text()).toBe('You won the set by forfeit.')
    expect(wrapper.get('.set-forfeit').text()).toBe("N-S forfeited, North didn't come back in time.")
  })
})

describe('sets in the history store', () => {
  test('getSet unwraps the envelope', async () => {
    answer(results())

    await expect(getSet(5)).resolves.toEqual(results())
    expect(http.get).toHaveBeenCalledWith('/sets/5')
  })

  test('loadSet replaces the cached set on every read, a 403 drops it, clear forgets it', async () => {
    const store = useHistoryStore()
    answer(results({ finished: false, boards: [boardRow(1, 420)] }))
    await store.loadSet(5)
    answer(results())
    await store.loadSet(5)
    expect(store.sets[5].boards).toHaveLength(4)

    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403, { message: 'This action is unauthorized.' }))
    await expect(store.loadSet(5)).rejects.toBeInstanceOf(AxiosError)
    expect(store.sets[5]).toBeUndefined()

    answer(results())
    await store.loadSet(5)
    store.clear()
    expect(store.sets).toEqual({})
  })
})

describe('My boards, by set', () => {
  test("each set's boards under a header with the set's total, opening its results", async () => {
    useAuthStore().user = { id: 2, name: 'Bo', username: 'bo', email: 'bo@example.com' }
    const set = { id: 5, number: 3, board: 0, of: 4 }
    answer({
      current_page: 1,
      data: [entry(48, { ...set, board: 2 }, 420), entry(47, { ...set, board: 1 }, -100), entry(45, null, 620)],
      last_page: 1,
      next_page_url: null,
      per_page: 20,
      total: 3,
    })

    const wrapper = mount(HistoryPage)
    await flushPromises()

    const header = wrapper.get('.set-header')
    expect(header.text()).toContain('Set 3 · table 9')
    expect(header.text()).toContain('2 of 4 boards')
    expect(header.get('.set-head-score').text()).toBe('+320')
    const items = wrapper.findAllComponents({ name: 'IonItem' })
    expect(items.map((item) => item.props('routerLink'))).toEqual([
      '/sets/5',
      '/playings/48',
      '/playings/47',
      '/playings/45',
    ])
  })
})

describe('SetResultsPage', () => {
  test("shows the set from the viewer's seat", async () => {
    useAuthStore().user = { id: 4, name: 'Di', username: 'di', email: 'di@example.com' }
    answer(results())

    const wrapper = mount(SetResultsPage)
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/sets/5')
    expect(wrapper.text()).toContain('Table 9')
    expect(wrapper.get('.set-players').text()).toContain('N-S ann & cy')
    expect(wrapper.get('.set-winner').text()).toBe('You lost the set.')
  })

  test('explains the 403 for a set you neither played nor finished', async () => {
    useAuthStore().user = { id: 7, name: 'Ed', username: 'ed', email: 'ed@example.com' }
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403, { message: 'This action is unauthorized.' }))

    const wrapper = mount(SetResultsPage)
    await flushPromises()

    expect(wrapper.get('.gone').text()).toContain('if you played in it')
  })

  test('a bad id asks for nothing', async () => {
    route.params = { id: 'abc' }

    const wrapper = mount(SetResultsPage)
    await flushPromises()

    expect(http.get).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("This set doesn't exist.")
  })
})
