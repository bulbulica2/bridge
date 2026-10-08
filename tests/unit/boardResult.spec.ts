import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import BoardResultDialog from '@/components/BoardResultDialog.vue'
import BoardResultPanel from '@/components/BoardResultPanel.vue'
import TablePlayPage from '@/views/TablePlayPage.vue'
import * as gameService from '@/services/game'
import * as historyService from '@/services/history'
import * as tablesService from '@/services/tables'
import type { Bid, BoardResult, Card, Playing, Suit } from '@/services/game'
import type { BoardResults, SetResults } from '@/services/history'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'
import {
  contractShort,
  declaredText,
  doubledMark,
  formatScore,
  madeSuffix,
  otherTableRows,
  percentText,
  resultContract,
  resultSummary,
  scoreFor,
  viewerScore,
} from '@/utils/result'
import { leaveWarning, moveConsequences } from '@/utils/seatMove'
import { showToast } from '@/utils/toast'
import { STALE_GRACE_MS } from '@/composables/useStaleDeadline'

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
  getDoubleDummy: vi.fn(),
  getBoardResults: vi.fn(),
}))
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
  startTable: vi.fn(),
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
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate: vi.fn() }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})

function bid(call: string): Bid {
  const level = Number(call[0])
  const strain = call.slice(1) as Bid['strain']
  return { id: 100 + level, call, level, strain, special: false }
}

function result(overrides: Partial<BoardResult> = {}): BoardResult {
  return {
    contract: bid('4S'),
    doubled: 0,
    declarer: 'N',
    tricks_won: 11,
    score_ns: 450,
    made_by: 1,
    ...overrides,
  }
}

const PASSED_OUT: BoardResult = {
  contract: null,
  doubled: null,
  declarer: null,
  tricks_won: null,
  score_ns: 0,
  made_by: null,
}

// A set two boards in, as GET /sets/{id} answers while it goes on.
function setSoFar(overrides: Partial<SetResults> = {}): SetResults {
  const row = (position: number, scoreNs: number) => ({
    ...result({ score_ns: scoreNs }),
    claimed: false,
    position,
    playing_id: 40 + position,
    board: { id: position, number: position, dealer: 'N' as const, vulnerable: '' as const },
    top: 2,
    matchpoints: { ns: 1, ew: 1 },
  })
  return {
    id: 5,
    number: 1,
    table_id: 5,
    of: 4,
    boards_dealt: 2,
    started_at: '2026-10-01T12:00:00Z',
    finished_at: null,
    finished: false,
    ended: null,
    replaced: [],
    players: { N: null, E: null, S: null, W: null },
    boards: [row(1, 420), row(2, 450)],
    totals: { score: { ns: 870, ew: -870 }, matchpoints: { ns: 2, ew: 2 }, top: 4 },
    winner: null,
    ...overrides,
  }
}

describe('result formatting', () => {
  test('scores carry their sign, with a real minus', () => {
    expect(formatScore(450)).toBe('+450')
    expect(formatScore(-50)).toBe('−50')
    expect(formatScore(0)).toBe('0')
  })

  test('how it went, as written at the table: =, +1…+6, −1…−13', () => {
    expect(madeSuffix(0)).toBe('=')
    for (let n = 1; n <= 6; n++) {
      expect(madeSuffix(n)).toBe(`+${n}`)
    }
    for (let n = 1; n <= 13; n++) {
      expect(madeSuffix(-n)).toBe(`−${n}`)
    }
    // A passed-out board has no contract to make or go down in.
    expect(madeSuffix(null)).toBe('')
  })

  test('doubled and redoubled contracts carry X and XX', () => {
    expect(doubledMark(0)).toBe('')
    expect(doubledMark(null)).toBe('')
    expect(doubledMark(1)).toBe('X')
    expect(doubledMark(2)).toBe('XX')
    expect(resultSummary(result({ doubled: 2, made_by: 0, score_ns: 880 }), 'S')).toBe('4♠XX N = · +880')
  })

  test('percentages', () => {
    expect(percentText(75)).toBe('75 %')
  })

  test("a made contract, from the viewer's side", () => {
    expect(resultSummary(result(), 'N')).toBe('4♠ N +1 · +450')
    expect(resultSummary(result(), 'W')).toBe('4♠ N +1 · −450')
    expect(resultContract(result())).toBe('4♠ by North')
  })

  test("without a seat, the score is N-S's and says so", () => {
    const r = result({ declarer: 'E', score_ns: -650 })
    expect(resultSummary(r)).toBe('4♠ E +1 · N-S −650')
    expect(resultSummary(r, 'E')).toBe('4♠ E +1 · +650')
  })

  test('a defeated contract scores for the defenders', () => {
    const r = result({ contract: bid('3NT'), doubled: 1, declarer: 'S', tricks_won: 7, made_by: -2, score_ns: -500 })
    expect(resultSummary(r, 'E')).toBe('3NTX S −2 · +500')
    expect(resultContract(r)).toBe('3NT doubled by South')
  })

  test('a contract just made', () => {
    const r = result({ contract: bid('2H'), declarer: 'W', tricks_won: 8, made_by: 0, score_ns: -110 })
    expect(resultSummary(r, 'N')).toBe('2♥ W = · −110')
  })

  test('a passed-out board scores 0', () => {
    expect(resultSummary(PASSED_OUT)).toBe('Passed out · 0')
    expect(resultSummary(PASSED_OUT, 'N')).toBe('Passed out · 0')
    expect(resultContract(PASSED_OUT)).toBeNull()
    expect(viewerScore(PASSED_OUT, 'E')).toBe(0)
  })

  test("the score from each side's point of view", () => {
    expect(scoreFor(450, 'ns')).toBe(450)
    expect(scoreFor(450, 'ew')).toBe(-450)
    expect(viewerScore(result(), 'N')).toBe(450)
    expect(viewerScore(result(), 'S')).toBe(450)
    expect(viewerScore(result(), 'E')).toBe(-450)
    expect(viewerScore(result(), 'W')).toBe(-450)
    expect(viewerScore(result({ score_ns: -500 }), 'W')).toBe(500)
    expect(viewerScore(result(), null)).toBeNull()
  })
})

describe('BoardResultPanel', () => {
  // The issue's own example: 2♣ by West, two overtricks, ended by a claim.
  const twoClubs = result({
    contract: bid('2C'),
    declarer: 'W',
    tricks_won: 10,
    made_by: 2,
    score_ns: -130,
    claimed: true,
  })

  const person = (id: number, username: string) => ({
    id,
    name: username,
    username,
    description: null,
    is_robot: false,
    is_admin: false,
  })

  test("the navy hero: who declared, the contract and how it went, the viewer's score", () => {
    const wrapper = mount(BoardResultPanel, {
      props: { result: twoClubs, mySeat: 'N', players: { W: person(4, 'radu') } },
    })

    expect(wrapper.get('.result-who').text()).toBe('radu declared')
    expect(wrapper.get('.result-contract').text()).toBe('2♣ +2')
    expect(wrapper.get('.result-made').classes()).toContain('made-ok')
    expect(wrapper.get('.result-score').text()).toBe('−130')
    expect(wrapper.get('.result-score').classes()).toContain('score-minus')
    expect(wrapper.find('.result-side').exists()).toBe(false)
    expect(wrapper.get('.result-detail').text()).toBe('10 tricks · by claim')
    // Nothing else until there is something to compare with.
    expect(wrapper.find('.result-mp').exists()).toBe(false)
    expect(wrapper.find('.elsewhere').exists()).toBe(false)
    expect(wrapper.find('.set-strip').exists()).toBe(false)
  })

  test('the declarer is "You", or their side when their name is unknown', () => {
    expect(mount(BoardResultPanel, { props: { result: twoClubs, mySeat: 'W' } }).get('.result-who').text()).toBe(
      'You declared',
    )
    expect(mount(BoardResultPanel, { props: { result: twoClubs, mySeat: 'N' } }).get('.result-who').text()).toBe(
      'E-W declared',
    )
  })

  test('from the other side the same board is a plus', () => {
    const wrapper = mount(BoardResultPanel, { props: { result: twoClubs, mySeat: 'E' } })

    expect(wrapper.get('.result-score').text()).toBe('+130')
    expect(wrapper.get('.result-score').classes()).toContain('score-plus')
  })

  test("someone who didn't play it sees N-S's score, tagged", () => {
    const wrapper = mount(BoardResultPanel, { props: { result: twoClubs, mySeat: null } })

    expect(wrapper.get('.result-side').text()).toBe('N-S')
    expect(wrapper.get('.result-score-value').text()).toBe('−130')
  })

  test('played out, down doubled: no "by claim", the undertrick in red', () => {
    const r = result({ doubled: 1, declarer: 'S', tricks_won: 9, made_by: -1, score_ns: -100 })
    const wrapper = mount(BoardResultPanel, { props: { result: r, mySeat: 'S' } })

    expect(wrapper.get('.result-contract').text()).toBe('4♠X −1')
    expect(wrapper.get('.result-made').classes()).toContain('made-down')
    expect(wrapper.get('.result-detail').text()).toBe('9 tricks')
  })

  test('a contract just made, one trick taken', () => {
    const r = result({ contract: bid('3NT'), declarer: 'N', tricks_won: 1, made_by: 0, score_ns: 400 })
    const wrapper = mount(BoardResultPanel, { props: { result: r, mySeat: 'S' } })

    expect(wrapper.get('.result-contract').text()).toBe('3NT =')
    expect(wrapper.get('.result-detail').text()).toBe('1 trick')
  })

  test("against the other tables: this board's matchpoints for the viewer's side, with a bar", () => {
    const extras = { matchpoints: { ns: 3, ew: 1 }, top: 4 }
    const east = mount(BoardResultPanel, { props: { result: result(), mySeat: 'E', extras } })
    expect(east.get('.result-mp-line span').text()).toBe('Against the other tables')
    expect(east.get('.result-mp-line b').text()).toBe('25 %')
    expect(east.get('.result-mp-bar').attributes('style')).toContain('width: 25%')

    // N-S's for someone who didn't play it.
    const watcher = mount(BoardResultPanel, { props: { result: result(), mySeat: null, extras } })
    expect(watcher.get('.result-mp-line b').text()).toBe('75 %')
  })

  test('a board only this table has played (top 0) says nothing about points', () => {
    const wrapper = mount(BoardResultPanel, {
      props: { result: result(), mySeat: 'N', extras: { matchpoints: { ns: 0, ew: 0 }, top: 0 } },
    })

    expect(wrapper.find('.result-mp').exists()).toBe(false)
  })

  test('a passed-out board', () => {
    const wrapper = mount(BoardResultPanel, { props: { result: PASSED_OUT, mySeat: 'S' } })

    expect(wrapper.get('.result-who').text()).toBe('All four passed')
    expect(wrapper.get('.result-contract').text()).toBe('Passed out')
    expect(wrapper.get('.result-score').text()).toBe('0')
    expect(wrapper.get('.result-score').classes()).toContain('score-zero')
    expect(wrapper.find('.result-detail').exists()).toBe(false)
  })
})

describe('result helpers for the hero and the other tables', () => {
  test('contractShort: the contract and how it went, or null when passed out', () => {
    expect(contractShort(result({ doubled: 2, made_by: -1 }))).toBe('4♠XX N −1')
    expect(contractShort(PASSED_OUT)).toBeNull()
  })

  test('declaredText', () => {
    expect(declaredText('N', 'N')).toBe('You declared')
    expect(declaredText('N', 'S', { N: { username: 'radu' } })).toBe('radu declared')
    expect(declaredText('E', null)).toBe('E-W declared')
    expect(declaredText('S', null, { S: null })).toBe('N-S declared')
  })

})

// The same board at the other tables, as the result dialog lists them.
describe('otherTableRows', () => {
  const person = (id: number, username: string) => ({
    id,
    name: username,
    username,
    description: null,
    is_robot: false,
    is_admin: false,
  })

  // GET /boards/{id}/results: best N-S first, ours (playing 42) third.
  function others(count = 4, mineAt = 2): BoardResults {
    const names = ['anna', 'dan', 'ioana', 'vlad', 'luis', 'carla', 'nick', 'sorin']
    const rows = Array.from({ length: count }, (_, i) => ({
      playing_id: i === mineAt ? 42 : 100 + i,
      table_id: i,
      players: {
        N: person(i * 4 + 1, names[i % names.length]),
        E: person(i * 4 + 2, 'e'),
        S: person(i * 4 + 3, names[(i + 1) % names.length]),
        W: i === 0 ? null : person(i * 4 + 4, 'w'),
      },
      contract: i === 0 ? bid('3NT') : bid('4S'),
      doubled: 0 as const,
      declarer: 'N' as Seat,
      tricks_won: 11 - i,
      score_ns: 460 - i * 10,
      made_by: i === 0 ? 2 : 1 - i,
      matchpoints: { ns: count - 1 - i, ew: i },
      finished_at: '2026-10-01T12:00:00Z',
    }))
    return { board: { id: 7, number: 7, dealer: 'N', vulnerable: '' }, top: 2 * (count - 1), results: rows }
  }

  test('every table with its contract and N-S score, ours named "You"', () => {
    const rows = otherTableRows(others(), 42)

    expect(rows.map((r) => r.label)).toEqual(['anna & dan', 'dan & ioana', 'You', 'vlad & luis'])
    expect(rows.map((r) => r.contract)).toEqual(['3NT N +2', '4♠ N =', '4♠ N −1', '4♠ N −2'])
    expect(rows.map((r) => r.scoreNs)).toEqual([460, 450, 440, 430])
    expect(rows.map((r) => r.mine)).toEqual([false, false, true, false])
    // The whole table for a tooltip, an account gone as "?".
    expect(rows[0].players).toBe('anna, e, dan, ?')
  })

  test('a long list keeps the top ones and ours', () => {
    const rows = otherTableRows(others(8, 6), 42)
    expect(rows).toHaveLength(5)
    expect(rows[4].label).toBe('You')

    const four = otherTableRows(others(8, 6), 42, 4)
    expect(four.map((r) => r.label)).toEqual(['anna & dan', 'dan & ioana', 'ioana & vlad', 'You'])
  })

  test('nothing while only this table has played it, or without results', () => {
    expect(otherTableRows(others(1, 0), 42)).toEqual([])
    expect(otherTableRows(null, 1)).toEqual([])
    expect(otherTableRows(undefined, 1)).toEqual([])
  })

  test('a passed-out table reads so', () => {
    const board = others(2, 0)
    Object.assign(board.results[1], { contract: null, declarer: null, made_by: null, score_ns: 0 })

    expect(otherTableRows(board, 42).map((r) => r.contract)).toEqual(['3NT N +2', 'Passed out'])
  })
})

describe('leaving, by phase', () => {
  test('during a board it is abandoned; between boards nothing is', () => {
    expect(leaveWarning('play', 7)).toBe('Board 7 is in progress: leaving abandons it for the other three players.')
    expect(leaveWarning('auction', null)).toContain('The board is in progress')
    expect(leaveWarning('finished', 7)).toBe('Board 7 is over, so leaving abandons nothing: its score is kept.')
    expect(leaveWarning('waiting', 7)).toBe('')
    expect(leaveWarning(null)).toBe('')
  })

  test('moving off a table between boards abandons nothing either', () => {
    const table = {
      id: 5,
      name: 'Club',
      created_by: 1,
      moderated_by: 1,
      board_id: 7,
      created_at: '',
      updated_at: '',
      seats: [
        { id: 1, table_id: 5, user_id: 1, seat: 'N', user: { id: 1, name: 'A', username: 'a', description: null } },
        { id: 2, table_id: 5, user_id: 3, seat: 'S', user: { id: 3, name: 'C', username: 'c', description: null } },
      ],
      free_seats: ['E', 'W'],
      can_manage: false,
    } as Table
    expect(moveConsequences(table, 3).join(' ')).toContain('will be abandoned')
    expect(moveConsequences(table, 3, 'finished').join(' ')).not.toContain('abandoned')
  })
})

describe('TablePlayPage between boards', () => {
  const PLAYERS = {
    N: { id: 1, name: 'Ann', username: 'ann', description: null },
    E: { id: 2, name: 'Bob', username: 'bob', description: null },
    S: { id: 3, name: 'Cy', username: 'cy', description: null },
    W: { id: 4, name: 'Di', username: 'di', description: null },
  }

  function hand(seat: Seat): Card[] {
    const suits: Suit[] = ['S', 'H', 'D', 'C']
    const offset = ['N', 'E', 'S', 'W'].indexOf(seat)
    return Array.from({ length: 13 }, (_, i) => {
      const n = offset * 13 + i
      return { id: n + 1, suit: suits[Math.floor(n / 13)], rank: 2 + (n % 13), rank_name: '' }
    })
  }

  function makeTable(seated: Seat[] = ['N', 'E', 'S', 'W']): Table {
    return {
      id: 5,
      name: 'Club',
      created_by: 1,
      moderated_by: 1,
      board_id: 7,
      created_at: '',
      updated_at: '',
      seats: seated.map((seat, i) => ({ id: i + 1, table_id: 5, user_id: PLAYERS[seat].id, seat, user: PLAYERS[seat] })),
      free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !seated.includes(s)),
      set: { id: 5, number: 1, board: 2, of: 4, finished: false, ended: null, replaced: [] },
      can_manage: false,
    }
  }

  // The fourth board of set 1, just finished: the set is over.
  function lastBoard(): Playing {
    return finished({
      set: { id: 5, number: 1, board: 4, of: 4, finished: true, ended: 'completed', replaced: [] },
    })
  }

  // 4♠ by North, made with an overtrick; the user is South.
  function finished(overrides: Partial<Playing> = {}): Playing {
    return {
      phase: 'finished',
      playing_id: 42,
      set: { id: 5, number: 1, board: 2, of: 4, finished: false, ended: null, replaced: [] },
      board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
      players: PLAYERS,
      turn: null,
      acting_user_id: null,
      auction: [],
      contract: { bid: bid('4S'), doubled: 0, declarer: 'N', dummy: 'S' },
      tricks: [],
      current_trick: [],
      tricks_won: { ns: 11, ew: 2 },
      dummy_hand: [],
      result: result(),
      deal: { N: hand('N'), E: hand('E'), S: hand('S'), W: hand('W') },
      ready: [],
      next_board_at: null,
      my_seat: 'S',
      hand: [],
      ...overrides,
    }
  }

  function newBoard(): Playing {
    return {
      ...finished(),
      phase: 'auction',
      playing_id: 43,
      set: { id: 5, number: 1, board: 3, of: 4, finished: false, ended: null, replaced: [] },
      board: { id: 8, number: 8, dealer: 'E', vulnerable: 'N-S' },
      turn: 'E',
      acting_user_id: 2,
      contract: null,
      tricks: null,
      current_trick: null,
      tricks_won: null,
      dummy_hand: null,
      result: null,
      deal: null,
      ready: null,
      hand: hand('S'),
    }
  }

  function logIn(id: number, name: string) {
    useAuthStore().user = { id, name, username: name.toLowerCase(), email: `${id}@example.com` }
  }

  const modalStub = { template: '<div><slot /></div>' }

  async function mountPage(playing: Playing, table = makeTable()) {
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
    const wrapper = mount(TablePlayPage, {
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
    await flushPromises()
    return wrapper
  }

  const dialog = (wrapper: ReturnType<typeof mount>) => wrapper.findComponent(BoardResultDialog)
  const isOpen = (wrapper: ReturnType<typeof mount>) => dialog(wrapper).props('open') as boolean

  // The board at this table only, as GET /boards/{id}/results answers it.
  const onlyHere: BoardResults = { board: { id: 7, number: 7, dealer: 'N', vulnerable: '' }, top: 0, results: [] }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    logIn(3, 'Cy')
    vi.mocked(gameService.getBids).mockResolvedValue([])
    vi.mocked(historyService.getSet).mockResolvedValue(setSoFar())
    // The double dummy table has its own specs: it never answers here.
    vi.mocked(historyService.getDoubleDummy).mockReturnValue(new Promise(() => {}))
    vi.mocked(historyService.getBoardResults).mockResolvedValue(onlyHere)
  })

  test('the same board at the other tables, ours tinted', async () => {
    const row = (playingId: number, n: string, scoreNs: number) => ({
      playing_id: playingId,
      table_id: playingId,
      players: {
        N: { id: playingId * 10, name: n, username: n, description: null, is_robot: false, is_admin: false },
        E: null,
        S: { id: playingId * 10 + 2, name: 's', username: 's', description: null, is_robot: false, is_admin: false },
        W: null,
      },
      contract: bid('4S'),
      doubled: 0 as const,
      declarer: 'N' as Seat,
      tricks_won: 10,
      score_ns: scoreNs,
      made_by: scoreNs > 420 ? 1 : 0,
      matchpoints: { ns: 1, ew: 1 },
      finished_at: '2026-10-01T12:00:00Z',
    })
    vi.mocked(historyService.getBoardResults).mockResolvedValue({
      board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
      top: 2,
      results: [row(42, 'ann', 450), row(9, 'dan', 420)],
    })
    const wrapper = await mountPage(finished())

    const rows = wrapper.findAll('.others-row:not(.others-head)')
    expect(rows.map((r) => r.get('.others-contract').text())).toEqual(['4♠ N +1', '4♠ N ='])
    expect(rows[0].classes()).toContain('others-mine')
    // Two tables: no need for the whole list.
    expect(wrapper.find('.others-compare').exists()).toBe(false)
  })

  test('a refused read of the other tables leaves the list out', async () => {
    vi.mocked(historyService.getBoardResults).mockRejectedValue(new Error('offline'))
    const wrapper = await mountPage(finished())

    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.find('.others').exists()).toBe(false)
    expect(wrapper.find('.others-skeleton').exists()).toBe(false)
    expect(wrapper.find('.dialog-hero').exists()).toBe(true)
  })

  test('the result in a dialog, the whole deal on the table, nothing stacked under it', async () => {
    const wrapper = await mountPage(
      finished({ ready: ['N', 'W'], next_board_at: new Date(Date.now() + 14_500).toISOString() }),
    )

    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.get('.dialog-contract').text().replace(/\s+/g, ' ')).toBe('4♠ by North +1')
    expect(wrapper.get('.dialog-score').text()).toBe('+450')
    expect(wrapper.get('.dialog-detail').text()).toBe('11 tricks')
    // Every seat shows its 13 cards as dealt; our own hand section is gone.
    expect(wrapper.findAll('.dealt-hand')).toHaveLength(4)
    expect(wrapper.find('.my-hand').exists()).toBe(false)
    // Counting down to the next board, our vote still to give.
    expect(wrapper.get('.vote-ring').text()).toMatch(/^0:1[45]$/)
    expect(wrapper.get('.vote-button').text()).toBe('Deal next board')
    // This board's matchpoints, read from GET /sets/{id}: no set strip and
    // no running prose about the set.
    expect(historyService.getSet).toHaveBeenCalledWith(5)
    expect(wrapper.get('.dialog-mp-value').text()).toBe('50 %')
    expect(wrapper.find('.set-strip').exists()).toBe(false)
    expect(historyService.getBoardResults).toHaveBeenCalledWith(7)
    // Where the table is in its set: in the header.
    expect(wrapper.get('.title-sub').text()).toMatch(/^Board 2 of 4 · Set \d+$/)
    // The page itself is just the table now (#174).
    expect(wrapper.find('.result').exists()).toBe(false)
    expect(wrapper.find('.next-board').exists()).toBe(false)
    expect(wrapper.find('.compare').exists()).toBe(false)
    expect(wrapper.find('.review-and-export').exists()).toBe(false)
    // The header's way to the review stays.
    expect(wrapper.find('.review-boards').exists()).toBe(true)
  })

  test('the X closes it to look at the deal; the pill in the corner opens it again', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-04T12:00:00Z'))
    const wrapper = await mountPage(finished({ next_board_at: '2026-10-04T12:00:12Z' }))
    expect(wrapper.find('.result-pill').exists()).toBe(false)

    await wrapper.findAllComponents({ name: 'IonButton' }).find((b) => b.classes('result-close'))!.trigger('click')

    expect(isOpen(wrapper)).toBe(false)
    const pill = wrapper.get('.bridge-table .corner-top-right .result-pill')
    expect(pill.text()).toBe('Result · 0:12')
    // Closed, it stays closed while the board is on show.
    vi.advanceTimersByTime(2000)
    await flushPromises()
    expect(isOpen(wrapper)).toBe(false)
    expect(wrapper.get('.result-pill').text()).toBe('Result · 0:10')

    await wrapper.get('.result-pill').trigger('click')
    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.find('.result-pill').exists()).toBe(false)
    vi.useRealTimers()
  })

  test('the backdrop closes it too', async () => {
    const wrapper = await mountPage(finished())

    dialog(wrapper).vm.$emit('close')
    await flushPromises()

    expect(isOpen(wrapper)).toBe(false)
    expect(wrapper.get('.result-pill').text()).toBe('Result')
  })

  test('it waits a second at most for the other tables, holding their row meanwhile', async () => {
    vi.useFakeTimers()
    vi.mocked(historyService.getBoardResults).mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPage(finished())

    expect(isOpen(wrapper)).toBe(false)
    vi.advanceTimersByTime(999)
    await flushPromises()
    expect(isOpen(wrapper)).toBe(false)
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.find('.others-skeleton').exists()).toBe(true)
    // The double dummy line is still being read as well.
    expect(wrapper.find('.dd-skeleton').exists()).toBe(true)
    vi.useRealTimers()
  })

  test('one double dummy line in it, and Review opens the review over it', async () => {
    vi.mocked(historyService.getDoubleDummy).mockResolvedValue({
      status: 'ready',
      table: {
        N: { C: 7, D: 5, H: 6, S: 10, NT: 6 },
        E: { C: 5, D: 7, H: 6, S: 3, NT: 6 },
        S: { C: 7, D: 5, H: 6, S: 10, NT: 6 },
        W: { C: 5, D: 7, H: 6, S: 3, NT: 6 },
      },
    })
    const wrapper = await mountPage(finished())

    expect(historyService.getDoubleDummy).toHaveBeenCalledWith(7)
    expect(wrapper.get('.dialog-dd').text()).toBe('Double dummy: 4♠ by North makes 10')
    expect(wrapper.find('.dd-skeleton').exists()).toBe(false)
    // Not the whole grid: that is in the review.
    expect(wrapper.find('.dd-table').exists()).toBe(false)

    await wrapper.get('.result-review').trigger('click')
    const review = wrapper.findComponent({ name: 'BoardReviewModal' })
    expect(review.props('open')).toBe(true)
    expect(isOpen(wrapper)).toBe(false)

    review.vm.$emit('close')
    await flushPromises()
    expect(isOpen(wrapper)).toBe(true)
  })

  test('no double dummy asked for before the board is over', async () => {
    const wrapper = await mountPage(newBoard())

    expect(historyService.getDoubleDummy).not.toHaveBeenCalled()
    expect(isOpen(wrapper)).toBe(false)
    expect(wrapper.find('.result-pill').exists()).toBe(false)
  })

  test('"Deal next board" votes once, then waits for the others', async () => {
    const wrapper = await mountPage(finished({ ready: ['N'] }))
    vi.mocked(gameService.nextBoard).mockResolvedValue(finished({ ready: ['N', 'S'] }))

    await wrapper.get('.vote-button').trigger('click')
    await flushPromises()

    expect(gameService.nextBoard).toHaveBeenCalledWith(5)
    expect(wrapper.get('.vote-button').text()).toBe('Waiting for bob, di…')
  })

  test('a manager gets the same vote as everyone, and nothing that deals for the others', async () => {
    const wrapper = await mountPage(finished({ ready: ['N'] }), { ...makeTable(), can_manage: true })

    expect(dialog(wrapper).props('vote')).toBe(true)
    expect(wrapper.get('.result-sheet').text()).not.toContain('for everyone')
  })

  test('the last one to vote gets the new board, and the dialog closes', async () => {
    const wrapper = await mountPage(finished({ ready: ['N', 'E', 'W'] }))
    vi.mocked(gameService.nextBoard).mockResolvedValue(newBoard())

    await wrapper.get('.vote-button').trigger('click')
    await flushPromises()

    expect(isOpen(wrapper)).toBe(false)
    expect(wrapper.find('.result-pill').exists()).toBe(false)
    expect(wrapper.findAll('.dealt-hand')).toHaveLength(0)
    expect(wrapper.findAll('.my-hand .playing-card')).toHaveLength(13)
    expect(wrapper.get('.turn-line-text').text()).toBe('Waiting for East')
  })

  test('the others see the next board arrive over the channel', async () => {
    const wrapper = await mountPage(finished({ ready: ['N', 'E', 'S'] }))
    const game = useGameStore()

    game.applyPlayingUpdate(5, { ...newBoard(), my_seat: undefined, hand: undefined } as unknown as Playing)
    await flushPromises()
    expect(isOpen(wrapper)).toBe(false)
    expect(wrapper.text()).toContain('Dealing…')

    game.applyHandDealt({ table_id: 5, playing_id: 43, my_seat: 'S', hand: hand('S') })
    await flushPromises()
    expect(wrapper.findAll('.my-hand .playing-card')).toHaveLength(13)
  })

  describe('the next board by itself', () => {
    const NOW = Date.parse('2026-10-04T12:00:00Z')
    const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString()

    afterEach(() => {
      vi.useRealTimers()
    })

    test('counts down to next_board_at, and the board arriving in time means no reread', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const wrapper = await mountPage(finished({ next_board_at: inSeconds(15) }))

      expect(wrapper.get('.vote-ring').text()).toBe('0:15')
      vi.advanceTimersByTime(2000)
      await flushPromises()
      expect(wrapper.get('.vote-ring').text()).toBe('0:13')
      vi.advanceTimersByTime(13_000)
      await flushPromises()
      expect(wrapper.get('.vote-ring').text()).toBe('0:00')
      expect(wrapper.get('.vote-button').text()).toBe('Dealing…')
      // The result is still there to read until the new board lands.
      expect(isOpen(wrapper)).toBe(true)
      expect(wrapper.findAll('.dealt-hand')).toHaveLength(4)

      const game = useGameStore()
      game.applyPlayingUpdate(5, { ...newBoard(), my_seat: undefined, hand: undefined } as unknown as Playing)
      game.applyHandDealt({ table_id: 5, playing_id: 43, my_seat: 'S', hand: hand('S') })
      await flushPromises()
      expect(isOpen(wrapper)).toBe(false)
      expect(wrapper.findAll('.my-hand .playing-card')).toHaveLength(13)

      vi.advanceTimersByTime(STALE_GRACE_MS)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(1)
    })

    test('with nothing 2 s after next_board_at, the page rereads the game once', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const wrapper = await mountPage(finished({ next_board_at: inSeconds(15) }))
      vi.mocked(gameService.getPlaying).mockResolvedValue(newBoard())

      vi.advanceTimersByTime(15_000 + STALE_GRACE_MS - 1)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
      expect(gameService.getPlaying).toHaveBeenLastCalledWith(5)
      expect(isOpen(wrapper)).toBe(false)
      expect(wrapper.findAll('.my-hand .playing-card')).toHaveLength(13)
    })

    test('a reread that fails, or finds the same board, leaves it for the next update', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const wrapper = await mountPage(finished({ next_board_at: inSeconds(15) }))
      vi.mocked(gameService.getPlaying).mockRejectedValueOnce(new Error('offline'))

      vi.advanceTimersByTime(15_000 + STALE_GRACE_MS)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
      expect(wrapper.get('.vote-button').text()).toBe('Dealing…')

      // Nothing more for the same deadline.
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    })

    test('no deadline: no countdown and no reread', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const wrapper = await mountPage(finished({ next_board_at: null }))

      expect(wrapper.find('.vote-ring').exists()).toBe(false)
      expect(wrapper.get('.vote-button').text()).toBe('Deal next board')
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(1)
    })
  })

  test('a player short: Start on the page, the result with no vote', async () => {
    const wrapper = await mountPage(finished(), makeTable(['N', 'E', 'S']))

    expect(isOpen(wrapper)).toBe(true)
    expect(dialog(wrapper).props('vote')).toBe(false)
    expect(wrapper.find('.vote').exists()).toBe(false)
    const box = wrapper.get('.start-box')
    expect(box.text()).toContain('Waiting for a fourth player, and for North (ann), East (bob) and you to press Start.')
    expect(box.get('[data-seat="W"]').text()).toBe('Empty · West')
  })

  test('a player replaced after the board: Start, which deals the next one here', async () => {
    const eve = { id: 9, name: 'Eve', username: 'eve', description: null }
    const refilled = makeTable()
    refilled.seats[3] = { ...refilled.seats[3], user_id: 9, user: eve }
    const wrapper = await mountPage(finished(), refilled)

    expect(wrapper.find('.vote').exists()).toBe(false)
    expect(wrapper.get('.start-box').text()).toContain('West (eve)')

    const dealt = { ...refilled, board_id: 8 }
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...dealt, playing: newBoard() })
    await wrapper.get('.start-button').trigger('click')
    await flushPromises()

    expect(tablesService.startTable).toHaveBeenCalledWith(5)
    expect(wrapper.find('.start-box').exists()).toBe(false)
    expect(isOpen(wrapper)).toBe(false)
    expect(wrapper.findAll('.my-hand .playing-card')).toHaveLength(13)
    // The answer was the new board: no second read of it.
    expect(gameService.getPlaying).toHaveBeenCalledTimes(1)
  })

  test('the game table opened before Start shows the same Start box', async () => {
    const waiting = {
      ...finished(),
      phase: 'waiting',
      playing_id: null,
      board: null,
      players: null,
      contract: null,
      tricks: null,
      current_trick: null,
      tricks_won: null,
      dummy_hand: null,
      result: null,
      deal: null,
      ready: null,
      my_seat: null,
      hand: null,
    } as Playing
    const wrapper = await mountPage(waiting, { ...makeTable(), board_id: null })

    expect(wrapper.text()).toContain('Waiting for Start')
    expect(wrapper.get('.start-box').text()).toContain('Ready to play?')
    expect(wrapper.get('.start-box').findAll('.start-seats li')).toHaveLength(4)
    expect(isOpen(wrapper)).toBe(false)
  })

  test("after the set's last board: the set's results in the dialog, Start on the page", async () => {
    const over = setSoFar({
      finished: true,
      ended: 'completed',
      finished_at: '2026-10-01T13:00:00Z',
      boards_dealt: 4,
      boards: [1, 2, 3, 4].map((position) => ({
        ...setSoFar().boards[0],
        position,
        playing_id: 40 + position,
        score_ns: position === 3 ? -100 : 420,
        board: { id: position, number: position, dealer: 'N' as const, vulnerable: '' as const },
      })),
      totals: { score: { ns: 1160, ew: -1160 }, matchpoints: { ns: 5, ew: 3 }, top: 8 },
      winner: 'NS',
    })
    vi.mocked(historyService.getSet).mockResolvedValue(over)
    const wrapper = await mountPage(lastBoard())

    expect(wrapper.get('.title-sub').text()).toMatch(/^Board 4 of 4 · Set \d+ · set over$/)
    expect(isOpen(wrapper)).toBe(true)
    const panel = wrapper.get('.result-sheet .set-results')
    expect(wrapper.get('.result-title').text()).toBe('Set results')
    expect(panel.get('.set-title').text()).toBe('Set 1 over')
    expect(panel.get('.set-winner').text()).toBe('You won the set.')
    expect(panel.findAll('.set-board')).toHaveLength(4)
    // The set's matchpoints for our side, not a summed score.
    expect(panel.get('.set-total-value').text()).toBe('63 %')
    expect(panel.text()).not.toContain('1160')
    // No board result, no countdown and no vote: Start deals the next set.
    expect(wrapper.find('.dialog-hero').exists()).toBe(false)
    expect(wrapper.find('.vote').exists()).toBe(false)
    expect(wrapper.get('.start-box').text()).toContain('Ready to play?')
  })

  test("the last board's dialog waits for the set's results rather than show the board first", async () => {
    vi.useFakeTimers()
    vi.mocked(historyService.getSet).mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPage(lastBoard())

    expect(isOpen(wrapper)).toBe(false)
    vi.advanceTimersByTime(1000)
    await flushPromises()
    // A set read that never comes: the board's result after all.
    expect(isOpen(wrapper)).toBe(true)
    expect(wrapper.find('.dialog-hero').exists()).toBe(true)
    vi.useRealTimers()
  })

  test("Start after a set deals board 1 of the next one", async () => {
    vi.mocked(historyService.getSet).mockResolvedValue(setSoFar({ finished: true, ended: 'completed', winner: 'EW' }))
    const wrapper = await mountPage(lastBoard())

    const next = newBoard()
    next.set = { id: 6, number: 2, board: 1, of: 4, finished: false, ended: null, replaced: [] }
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...makeTable(), board_id: 8, set: next.set, playing: next })
    await wrapper.get('.start-button').trigger('click')
    await flushPromises()

    expect(tablesService.startTable).toHaveBeenCalledWith(5)
    expect(isOpen(wrapper)).toBe(false)
    expect(wrapper.get('.title-sub').text()).toBe('Board 1 of 4 · Set 2')
    expect(wrapper.findAll('.my-hand .playing-card')).toHaveLength(13)
  })

  test('a set broken off between boards comes with the table and ends the set there', async () => {
    const abandoned = setSoFar({ finished: true, ended: 'abandoned', winner: null })
    vi.mocked(historyService.getSet).mockResolvedValue(abandoned)
    const wrapper = await mountPage(finished())
    expect(wrapper.find('.set-results').exists()).toBe(false)
    expect(dialog(wrapper).props('vote')).toBe(true)

    // East was kicked while there: their seat is free, the set over.
    const table = makeTable(['N', 'S', 'W'])
    table.set = { ...table.set!, finished: true, ended: 'abandoned' }
    useTablesStore().applyTableUpdate(table)
    await flushPromises()

    expect(historyService.getSet).toHaveBeenCalledTimes(2)
    const panel = wrapper.get('.result-sheet .set-results')
    expect(panel.get('.set-winner').text()).toBe('Abandoned: no winner.')
    expect(panel.find('.set-replaced').exists()).toBe(false)
    expect(dialog(wrapper).props('vote')).toBe(false)
    expect(wrapper.get('.start-box').text()).toContain('Waiting for a fourth player')
  })

  test('a refused vote says why and rereads the board', async () => {
    const wrapper = await mountPage(finished())
    const config = { headers: new AxiosHeaders() }
    const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
    const message = 'The table is short of a player: the next board is dealt as soon as a fourth one sits down.'
    error.response = { status: 409, data: { status: 409, message, data: [] }, statusText: '', headers: {}, config }
    vi.mocked(gameService.nextBoard).mockRejectedValue(error)

    await wrapper.get('.vote-button').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith(message, 'danger')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
  })

  test('the last card seen live toasts the score and opens the dialog', async () => {
    const inPlay = finished({ phase: 'play', result: null, deal: null, ready: null, turn: 'W', acting_user_id: 4 })
    const wrapper = await mountPage(inPlay)
    expect(isOpen(wrapper)).toBe(false)

    useGameStore().applyPlayingUpdate(5, finished())
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('Board over: 4♠ N +1 · +450.', 'success')
    expect(isOpen(wrapper)).toBe(true)
  })
})
