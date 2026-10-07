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
import { IonButton } from '@ionic/vue'
import { fireIonEvent, pullToRefresh } from './ionEvents'
import SetResultsPanel from '@/components/SetResultsPanel.vue'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import {
  currentSet,
  groupBySet,
  replacedFromText,
  replacedText,
  replacedTogetherText,
  replacementOf,
  seatInSet,
  setLabel,
  setTitle,
  setPercent,
  setTotals,
  setWinnerText,
  setStripTiles,
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
    replaced: [],
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
  return { id: 5, number: 3, board: 2, of: 4, finished: false, ended: null, replaced: [], ...overrides }
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
    // A set broken off between boards comes with the table only.
    const abandoned = position({ finished: true, ended: 'abandoned' })
    expect(currentSet(table(abandoned), { set: position() } as PublicPlaying)).toMatchObject({
      finished: true,
      ended: 'abandoned',
    })
    // Replacements only add up: whichever copy knows more of them.
    const robotEast = position({ replaced: [{ seat: 'E', user_id: 2, reason: 'turn_timeout' }] })
    expect(currentSet(table(position()), { set: robotEast } as PublicPlaying)?.replaced).toEqual(robotEast.replaced)
    expect(currentSet(table(robotEast), { set: position() } as PublicPlaying)?.replaced).toEqual(robotEast.replaced)
    // An older payload without the list reads as none.
    const bare = { ...position(), replaced: undefined } as unknown as SetPosition
    expect(currentSet(table(bare), { set: bare } as PublicPlaying)?.replaced).toBeUndefined()
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

  test('a robot taking a seat over, said of somebody else and of the player it replaced', () => {
    expect(replacedText({ seat: 'E', reason: 'turn_timeout' })).toBe("East didn't play in time: a robot took their seat.")
    expect(replacedText({ seat: 'E', reason: 'turn_timeout' }, true)).toBe(
      "You didn't play in time: a robot took your seat.",
    )
    expect(replacedText({ seat: 'N', reason: 'away' })).toBe('North was away: a robot took their seat.')
    expect(replacedText({ seat: 'N', reason: 'away' }, true)).toBe('You were away: a robot took your seat.')
    expect(replacedText({ seat: 'S', reason: 'moved' })).toBe('South moved to another table: a robot took their seat.')
    expect(replacedText({ seat: 'W', reason: 'kicked' })).toBe('West was removed while away: a robot took their seat.')
    expect(replacedText({ seat: 'W', reason: 'kicked' }, true)).toBe('You were removed while away: a robot took your seat.')
    // Their time for the set ran out (bb#131).
    expect(replacedText({ seat: 'E', reason: 'set_time' })).toBe(
      'East ran out of time for the set: a robot took their seat.',
    )
    expect(replacedText({ seat: 'E', reason: 'set_time' }, true)).toBe(
      'You ran out of time for the set: a robot took your seat.',
    )
    expect(replacedFromText({ seat: 'E', reason: 'turn_timeout', number: 3 })).toBe(
      "You didn't play in time: a robot took your seat. You may sit down at that table again once set 3 is over.",
    )
  })

  test('several replaced at once, told in one line', () => {
    expect(replacedTogetherText([{ seat: 'S', reason: 'away' }])).toBe('South was away: a robot took their seat.')
    expect(
      replacedTogetherText([
        { seat: 'S', reason: 'away' },
        { seat: 'W', reason: 'away' },
      ]),
    ).toBe('South and West were away: robots took their seats.')
    expect(
      replacedTogetherText([
        { seat: 'N', reason: 'turn_timeout' },
        { seat: 'E', reason: 'turn_timeout' },
        { seat: 'W', reason: 'turn_timeout' },
      ]),
    ).toBe("North, East and West didn't play in time: robots took their seats.")
    expect(
      replacedTogetherText([
        { seat: 'E', reason: 'moved' },
        { seat: 'W', reason: 'kicked' },
      ]),
    ).toBe('East moved to another table: a robot took their seat. West was removed while away: a robot took their seat.')
  })

  test("the user's own replacement, but never a move they made themselves", () => {
    const set = position({
      replaced: [
        { seat: 'E', user_id: 2, reason: 'turn_timeout' },
        { seat: 'W', user_id: 4, reason: 'moved' },
      ],
    })
    expect(replacementOf(set, 2)).toEqual({ seat: 'E', user_id: 2, reason: 'turn_timeout' })
    expect(replacementOf(set, 4)).toBeNull()
    expect(replacementOf(set, 1)).toBeNull()
    expect(replacementOf(null, 2)).toBeNull()
  })

  test("the viewer's seat in a set: the one they play, or the one a robot took over", () => {
    const robot = { ...bo, id: 100, username: 'robot-1', is_robot: true }
    const set = results({
      players: { N: ann, E: robot, S: cy, W: di },
      replaced: [{ seat: 'E', user_id: bo.id, reason: 'turn_timeout' }],
    })
    expect(seatInSet(set, ann.id)).toBe('N')
    expect(seatInSet(set, bo.id)).toBe('E')
    expect(seatInSet(set, 99)).toBeNull()
    expect(seatInSet(set, null)).toBeNull()
    expect(seatInSet({ ...set, replaced: undefined } as unknown as SetResults, bo.id)).toBeNull()
  })

  test("the totals turned to the viewer's side", () => {
    // Matchpoints only: no score is added up over a set.
    expect(setTotals(results(), 'E')).toEqual({ side: 'ew', matchpoints: 1, top: 6, percent: 17 })
    expect(setTotals(results(), null)).toMatchObject({ side: 'ns', percent: 83 })
    expect(setPercent(results(), 'N')).toBe(83)
    expect(setPercent(results(), 'W')).toBe(17)
    expect(setPercent(undefined, 'N')).toBeNull()
    expect(setPercent(results({ totals: { score: { ns: 0, ew: 0 }, matchpoints: { ns: 0, ew: 0 }, top: 0 } }), 'N')).toBeNull()
  })

  test("the history in runs of one set, with the owner's seat, no summed score", () => {
    const one = { id: 5, number: 3, board: 0, of: 4 }
    const two = { id: 4, number: 2, board: 0, of: 4 }
    const groups = groupBySet([
      entry(48, { ...one, board: 2 }, 420),
      entry(47, { ...one, board: 1 }, -100),
      entry(46, { ...two, board: 4 }, 50),
      entry(45, null, 620),
    ])
    expect(groups.map((g) => [g.set?.id ?? null, g.entries.map((e) => e.playing_id), g.seat])).toEqual([
      [5, [48, 47], 'E'],
      [4, [46], 'E'],
      [null, [45], 'E'],
    ])
    expect(groups[0]).not.toHaveProperty('score')
    expect(new Set(groups.map((g) => g.key)).size).toBe(3)
  })
})

describe('SetResultsPanel', () => {
  test("an E-W player's view: each board and the matchpoints from their side", () => {
    const wrapper = mount(SetResultsPanel, { props: { set: results(), mySeat: 'E' } })

    expect(wrapper.get('.set-title').text()).toBe('Set 3 over')
    expect(wrapper.get('.set-winner').text()).toBe('You lost the set.')
    expect(wrapper.get('.set-winner').classes()).toContain('score-minus')
    const rows = wrapper.findAllComponents({ name: 'IonItem' })
    expect(rows).toHaveLength(4)
    expect(rows[0].props('routerLink')).toBe('/playings/41')
    expect(rows[0].text()).toContain('1. Board 11')
    expect(rows[0].text()).toContain('4♠ by N =')
    expect(rows[0].get('.set-row-score').text()).toBe('−420')
    expect(rows[0].get('.set-row-mp').text()).toBe('MP 0 %')
    expect(rows[2].get('.set-row-score').text()).toBe('+100')
    // Only this table has played board 4: nothing to compare with.
    expect(rows[3].get('.set-row-mp').text()).toBe('MP —')
    // The set's total is its matchpoints, never a summed score.
    expect(wrapper.get('.set-total-label').text()).toBe('Your matchpoints')
    expect(wrapper.get('.set-total-value').text()).toBe('17 %')
    expect(wrapper.get('.set-total-mp').text()).toBe('1 of 6')
    expect(wrapper.text()).not.toContain('1160')
    expect(wrapper.text()).not.toContain('Your total')
    expect(wrapper.find('.set-total-none').exists()).toBe(false)
    expect(wrapper.find('.set-replaced').exists()).toBe(false)
  })

  test('says whom a robot replaced, "you" for the viewer it replaced', () => {
    const set = results({
      replaced: [
        { seat: 'N', user_id: ann.id, reason: 'turn_timeout' },
        { seat: 'W', user_id: di.id, reason: 'moved' },
      ],
      boards: [boardRow(1, 420)],
    })

    const other = mount(SetResultsPanel, { props: { set, mySeat: 'E' } })
    expect(other.findAll('.set-replaced').map((l) => l.text())).toEqual([
      "North didn't play in time: a robot took their seat.",
      'West moved to another table: a robot took their seat.',
    ])
    // The set's result stands for the seats as they ended it.
    expect(other.get('.set-winner').text()).toBe('You lost the set.')

    const replaced = mount(SetResultsPanel, { props: { set, mySeat: 'N' } })
    expect(replaced.get('.set-replaced').text()).toBe("You didn't play in time: a robot took your seat.")
  })

  test("someone who didn't play it sees N-S's matchpoints", () => {
    const wrapper = mount(SetResultsPanel, { props: { set: results(), mySeat: null } })

    expect(wrapper.get('.set-total-label').text()).toBe('N-S matchpoints')
    expect(wrapper.get('.set-total-value').text()).toBe('83 %')
  })

  test('nothing to compare with: says so, and no score total', () => {
    const alone = results({
      boards: [boardRow(1, 420)].map((row) => ({ ...row, top: 0, matchpoints: { ns: 0, ew: 0 } })),
      totals: { score: { ns: 420, ew: -420 }, matchpoints: { ns: 0, ew: 0 }, top: 0 },
    })
    const wrapper = mount(SetResultsPanel, { props: { set: alone, mySeat: 'N' } })

    expect(wrapper.get('.set-total-none').text()).toBe('No other table has played these boards yet.')
    expect(wrapper.find('.set-total-value').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('+420 ')
  })

  test('a set broken off before any board: no totals at all', () => {
    const wrapper = mount(SetResultsPanel, {
      props: { set: results({ ended: 'abandoned', winner: null, boards: [] }), mySeat: 'N' },
    })

    expect(wrapper.get('.set-empty').text()).toBe('No board of this set was finished.')
    expect(wrapper.find('.set-totals').exists()).toBe(false)
  })

  test('a claimed, doubled board reads in table notation', () => {
    const row = { ...boardRow(1, -200), doubled: 1 as const, made_by: -1, claimed: true }
    const wrapper = mount(SetResultsPanel, { props: { set: results({ boards: [row] }), mySeat: 'N' } })

    expect(wrapper.get('.set-row-contract').text()).toBe('4♠X by N −1 · by claim')
  })
})

describe("SetResultsPanel's time used", () => {
  test("each human's time used of their time for the set", () => {
    const set = results({
      minutes: 16,
      time_left: { N: 312, E: 0, S: 405, W: null },
      time_used: { N: 648, E: 960, S: 555, W: null },
      replaced: [{ seat: 'E', user_id: bo.id, reason: 'set_time' }],
    })
    const wrapper = mount(SetResultsPanel, { props: { set, mySeat: 'S' } })

    expect(wrapper.get('.set-time-title').text()).toBe('Time used · 16 minutes each')
    expect(wrapper.findAll('.set-time-row').map((r) => r.text())).toEqual([
      'North · ann10:48 of 16:00',
      'East · bo16:00 of 16:00',
      'South (you)9:15 of 16:00',
    ])
    expect(wrapper.findAll('.set-replaced').map((r) => r.text())).toEqual([
      'East ran out of time for the set: a robot took their seat.',
    ])
  })

  test('nothing for a set from before the clock', () => {
    const wrapper = mount(SetResultsPanel, { props: { set: results(), mySeat: 'S' } })
    expect(wrapper.find('.set-time').exists()).toBe(false)
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
  test("each set's boards under a header, no summed score, opening its results", async () => {
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
    // No score is added up over the set, and its matchpoints aren't known yet.
    expect(header.text()).not.toContain('320')
    expect(header.find('.set-head-mp').exists()).toBe(false)
    const items = wrapper.findAllComponents({ name: 'IonItem' })
    expect(items.map((item) => item.props('routerLink'))).toEqual([
      '/sets/5',
      '/playings/48',
      '/playings/47',
      '/playings/45',
    ])
  })
})

describe('My boards, by set, once a set has been read', () => {
  test("the header shows the owner's matchpoints over the set", async () => {
    useAuthStore().user = { id: 2, name: 'Bo', username: 'bo', email: 'bo@example.com' }
    // Its results were read already (its page, or the play page).
    useHistoryStore().sets[5] = results()
    const set = { id: 5, number: 3, board: 0, of: 4 }
    answer({
      current_page: 1,
      data: [entry(48, { ...set, board: 2 }, 420), entry(45, null, 620)],
      last_page: 1,
      next_page_url: null,
      per_page: 20,
      total: 2,
    })

    const wrapper = mount(HistoryPage)
    await flushPromises()

    // Bo sat East: E-W's 1 of 6.
    const mp = wrapper.get('.set-header').get('.set-head-mp')
    expect(mp.text()).toBe('17 %')
    expect(mp.attributes('aria-label')).toBe('Set matchpoints 17 %')
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

  test('a player a robot replaced still sees it from their side', async () => {
    useAuthStore().user = { id: 4, name: 'Di', username: 'di', email: 'di@example.com' }
    const robot = { ...di, id: 100, username: 'robot-1', is_robot: true }
    answer(results({ players: { N: ann, E: bo, S: cy, W: robot }, replaced: [{ seat: 'W', user_id: 4, reason: 'turn_timeout' }] }))

    const wrapper = mount(SetResultsPage)
    await flushPromises()

    expect(wrapper.get('.set-winner').text()).toBe('You lost the set.')
    expect(wrapper.get('.set-replaced').text()).toBe("You didn't play in time: a robot took your seat.")
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

describe('SetResultsPage failures and refreshing', () => {
  test('a 404 is a set that does not exist', async () => {
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(404, { message: 'Not Found' }))

    const wrapper = mount(SetResultsPage)
    await flushPromises()

    expect(wrapper.get('.gone').text()).toContain("This set doesn't exist.")
  })

  test('a 401 sends the user to log in', async () => {
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(401, { message: 'Unauthenticated.' }))

    mount(SetResultsPage)
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })

  test('another failure shows an error; Refresh and pull to refresh read it again', async () => {
    useAuthStore().user = { id: 4, name: 'Di', username: 'di', email: 'di@example.com' }
    vi.mocked(http.get).mockRejectedValueOnce(new Error('offline'))
    const wrapper = mount(SetResultsPage)
    await flushPromises()
    expect(wrapper.get('.error').text()).toBe('Could not load the set. Please try again.')

    answer(results())
    const complete = vi.fn()
    await pullToRefresh(wrapper, complete)
    await flushPromises()
    expect(complete).toHaveBeenCalled()
    expect(wrapper.find('.error').exists()).toBe(false)

    answer(results())
    await wrapper.findAllComponents(IonButton).find((b) => b.classes('refresh'))!.trigger('click')
    await flushPromises()
    expect(http.get).toHaveBeenCalledTimes(3)
  })

  test('pull to refresh on a dead set only closes the refresher', async () => {
    route.params = { id: 'abc' }
    const wrapper = mount(SetResultsPage)
    await flushPromises()
    const complete = vi.fn()

    await pullToRefresh(wrapper, complete)
    await flushPromises()

    expect(http.get).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalled()
  })
})

describe('My boards, paging and refreshing', () => {
  const firstPage = (last: number) => ({
    current_page: 1,
    data: [entry(48, null, 420)],
    last_page: last,
    next_page_url: null,
    per_page: 20,
    total: 2,
  })

  beforeEach(() => {
    useAuthStore().user = { id: 2, name: 'Bo', username: 'bo', email: 'bo@example.com' }
  })

  test('pull to refresh reads the first page again', async () => {
    answer(firstPage(1))
    const wrapper = mount(HistoryPage)
    await flushPromises()
    const complete = vi.fn()

    answer(firstPage(1))
    await pullToRefresh(wrapper, complete)
    await flushPromises()

    expect(http.get).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalled()
  })

  test('scrolling down pages in older boards', async () => {
    answer(firstPage(2))
    const wrapper = mount(HistoryPage)
    await flushPromises()
    const complete = vi.fn()

    answer({ ...firstPage(2), current_page: 2, data: [entry(40, null, -50)] })
    await fireIonEvent(wrapper, 'ion-infinite-scroll', 'ion-infinite', complete)
    await flushPromises()

    expect(complete).toHaveBeenCalled()
    expect(wrapper.findAllComponents({ name: 'IonItem' }).map((i) => i.props('routerLink'))).toEqual([
      '/playings/48',
      '/playings/40',
    ])
  })

  test('a failed older page says so, and an expired session goes to log in', async () => {
    answer(firstPage(3))
    const wrapper = mount(HistoryPage)
    await flushPromises()
    const complete = vi.fn()

    vi.mocked(http.get).mockRejectedValueOnce(new Error('offline'))
    await fireIonEvent(wrapper, 'ion-infinite-scroll', 'ion-infinite', complete)
    await flushPromises()
    expect(wrapper.get('.error').text()).toBe('Could not load older boards. Pull down to try again.')
    expect(complete).toHaveBeenCalled()

    vi.mocked(http.get).mockRejectedValueOnce(axiosError(401, { message: 'Unauthenticated.' }))
    await fireIonEvent(wrapper, 'ion-infinite-scroll', 'ion-infinite', complete)
    await flushPromises()
    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })
})

describe('setStripTiles', () => {
  const row = (position: number, ns: number, top = 4) => ({ position, matchpoints: { ns, ew: top - ns }, top })

  test("one tile per board, the finished ones with the side's matchpoints, the one on now marked", () => {
    expect(setStripTiles(4, 3, [row(1, 3), row(2, 1)], 'ns')).toEqual([
      { position: 1, label: 'B1', played: true, percent: 75, current: false },
      { position: 2, label: 'B2', played: true, percent: 25, current: false },
      { position: 3, label: 'B3', played: false, percent: null, current: true },
      { position: 4, label: 'B4', played: false, percent: null, current: false },
    ])
    expect(setStripTiles(2, null, [row(1, 3)], 'ew').map((t) => t.percent)).toEqual([25, null])
  })

  test('a board nobody else has played has no percentage yet', () => {
    expect(setStripTiles(1, 1, [row(1, 0, 0)], 'ns')[0]).toMatchObject({ played: true, percent: null, current: true })
  })
})
