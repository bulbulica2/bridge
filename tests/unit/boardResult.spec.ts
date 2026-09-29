import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import BoardResultPanel from '@/components/BoardResultPanel.vue'
import TablePlayPage from '@/views/TablePlayPage.vue'
import * as gameService from '@/services/game'
import * as historyService from '@/services/history'
import * as tablesService from '@/services/tables'
import type { Bid, BoardResult, Card, Playing, Suit } from '@/services/game'
import type { PlayingHistoryEntry } from '@/services/history'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import {
  formatScore,
  madeBy,
  madeText,
  resultContract,
  resultSummary,
  scoreFor,
  sessionScore,
  viewerScore,
} from '@/utils/result'
import { leaveWarning, moveConsequences } from '@/utils/seatMove'
import { showToast } from '@/utils/toast'

vi.mock('@/services/game', () => ({
  getPlaying: vi.fn(),
  getBids: vi.fn(),
  makeCall: vi.fn(),
  playCard: vi.fn(),
  nextBoard: vi.fn(),
}))
vi.mock('@/services/history', () => ({ getMyPlayings: vi.fn() }))
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

describe('result formatting', () => {
  test('scores carry their sign, with a real minus', () => {
    expect(formatScore(450)).toBe('+450')
    expect(formatScore(-50)).toBe('−50')
    expect(formatScore(0)).toBe('0')
  })

  test('made, over and under', () => {
    expect(madeBy(1)).toBe('+1')
    expect(madeBy(0)).toBe('made')
    expect(madeBy(-2)).toBe('−2')
    expect(madeText(1)).toBe('Made with 1 overtrick')
    expect(madeText(2)).toBe('Made with 2 overtricks')
    expect(madeText(0)).toBe('Made exactly')
    expect(madeText(-3)).toBe('Down 3')
  })

  test('a made contract names the side that scored', () => {
    expect(resultSummary(result())).toBe('4♠ by N, +1: N-S +450')
    expect(resultContract(result())).toBe('4♠ by North')
  })

  test('an E-W contract made scores for E-W, though score_ns is negative', () => {
    const r = result({ declarer: 'E', score_ns: -650 })
    expect(resultSummary(r)).toBe('4♠ by E, +1: E-W +650')
  })

  test('a defeated contract scores for the defenders', () => {
    const r = result({ contract: bid('3NT'), doubled: 1, declarer: 'S', tricks_won: 7, made_by: -2, score_ns: -500 })
    expect(resultSummary(r)).toBe('3NTX by S, −2: E-W +500')
    expect(resultContract(r)).toBe('3NT doubled by South')
  })

  test('a contract just made', () => {
    const r = result({ contract: bid('2H'), declarer: 'W', tricks_won: 8, made_by: 0, score_ns: -110 })
    expect(resultSummary(r)).toBe('2♥ by W, made: E-W +110')
  })

  test('a passed-out board scores 0', () => {
    expect(resultSummary(PASSED_OUT)).toBe('Passed out: 0')
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
  test('shows the score from an E-W viewer, and both sides', () => {
    const wrapper = mount(BoardResultPanel, {
      props: { result: result(), mySeat: 'E', session: { boards: 2, ns: 870, mine: -870 } },
    })

    expect(wrapper.get('.result-title').text()).toBe('4♠ by North')
    expect(wrapper.get('.result-detail').text()).toBe('Made with 1 overtrick · 11 tricks')
    expect(wrapper.get('.result-mine-value').text()).toBe('−450')
    expect(wrapper.get('.result-mine').classes()).toContain('score-minus')
    expect(wrapper.get('.result-sides').text()).toContain('N-S +450')
    expect(wrapper.get('.result-sides').text()).toContain('E-W −450')
    expect(wrapper.get('.side-mine').text()).toContain('E-W')
    expect(wrapper.get('.result-session').text()).toContain('2 boards')
    expect(wrapper.get('.result-session').text()).toContain('you −870')
  })

  test('a passed-out board', () => {
    const wrapper = mount(BoardResultPanel, { props: { result: PASSED_OUT, mySeat: 'S' } })

    expect(wrapper.get('.result-title').text()).toBe('Passed out')
    expect(wrapper.get('.result-mine-value').text()).toBe('0')
    expect(wrapper.get('.result-summary').text()).toBe('Passed out: 0')
    expect(wrapper.find('.result-session').exists()).toBe(false)
  })
})

describe('session score', () => {
  function entry(tableId: number | null, scoreNs: number, seat: Seat = 'S'): PlayingHistoryEntry {
    return {
      playing_id: 1,
      table_id: tableId,
      board: { id: 1, number: 1, dealer: 'N', vulnerable: '' },
      seat,
      partner: { id: 9, name: 'P', username: 'p', description: null },
      contract: null,
      doubled: null,
      declarer: null,
      tricks_won: null,
      score_ns: scoreNs,
      made_by: null,
      score: seat === 'N' || seat === 'S' ? scoreNs : -scoreNs,
      finished_at: '',
    }
  }

  test('sums the latest run of boards at this table only', () => {
    const total = sessionScore([entry(5, 450), entry(5, -100, 'E'), entry(3, 620), entry(5, 50)], 5)
    expect(total).toEqual({ boards: 2, ns: 350, mine: 550, complete: true })
  })

  test('says when an older page may hold more', () => {
    expect(sessionScore([entry(5, 420)], 5).complete).toBe(false)
    expect(sessionScore([], 5)).toEqual({ boards: 0, ns: 0, mine: 0, complete: false })
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
      can_manage: false,
    }
  }

  // 4♠ by North, made with an overtrick; the user is South.
  function finished(overrides: Partial<Playing> = {}): Playing {
    return {
      phase: 'finished',
      playing_id: 42,
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

  const nextBox = (wrapper: ReturnType<typeof mount>) => wrapper.get('.next-board')

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    logIn(3, 'Cy')
    vi.mocked(gameService.getBids).mockResolvedValue([])
    vi.mocked(historyService.getMyPlayings).mockResolvedValue({
      current_page: 1,
      data: [],
      last_page: 1,
      next_page_url: null,
      per_page: 20,
      total: 0,
    })
  })

  test('shows the result, the whole deal and who is ready', async () => {
    const wrapper = await mountPage(finished({ ready: ['N', 'W'] }))

    expect(wrapper.get('.result-title').text()).toBe('4♠ by North')
    expect(wrapper.get('.result-mine-value').text()).toBe('+450')
    // Every seat shows its 13 cards as dealt; our own hand section is gone.
    expect(wrapper.findAll('.dealt-hand')).toHaveLength(4)
    expect(wrapper.find('.my-hand').exists()).toBe(false)
    expect(nextBox(wrapper).text()).toContain('2 of 4 ready')
    expect(nextBox(wrapper).findAll('li.is-ready').map((li) => li.attributes('data-seat'))).toEqual(['N', 'W'])
    // The running score is read from the history for this table.
    expect(historyService.getMyPlayings).toHaveBeenCalledWith(1)
    // And the same board at the other tables is one tap away.
    const compare = wrapper.findAllComponents({ name: 'IonButton' }).find((b) => b.classes('compare'))
    expect(compare?.props('routerLink')).toMatch(/^\/boards\/\d+\/results$/)
  })

  test('"Next board" asks once, then waits for the others', async () => {
    const wrapper = await mountPage(finished({ ready: ['N'] }))
    vi.mocked(gameService.nextBoard).mockResolvedValue(finished({ ready: ['N', 'S'] }))

    await nextBox(wrapper).get('.next-button').trigger('click')
    await flushPromises()

    expect(gameService.nextBoard).toHaveBeenCalledWith(5, false)
    expect(wrapper.find('.next-button').exists()).toBe(false)
    expect(nextBox(wrapper).text()).toContain("You're ready. Waiting for bob, di.")
  })

  test('the last one to ask gets the new board, and the table resets', async () => {
    const wrapper = await mountPage(finished({ ready: ['N', 'E', 'W'] }))
    vi.mocked(gameService.nextBoard).mockResolvedValue(newBoard())

    await nextBox(wrapper).get('.next-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.result').exists()).toBe(false)
    expect(wrapper.find('.next-board').exists()).toBe(false)
    expect(wrapper.findAll('.dealt-hand')).toHaveLength(0)
    expect(wrapper.findAll('.my-hand .playing-card')).toHaveLength(13)
    expect(wrapper.text()).toContain('Auction: waiting for bob.')
  })

  test('the others see the next board arrive over the channel', async () => {
    const wrapper = await mountPage(finished({ ready: ['N', 'E', 'S'] }))
    const game = useGameStore()

    game.applyPlayingUpdate(5, { ...newBoard(), my_seat: undefined, hand: undefined } as unknown as Playing)
    await flushPromises()
    expect(wrapper.find('.result').exists()).toBe(false)
    expect(wrapper.text()).toContain('Dealing…')

    game.applyHandDealt({ table_id: 5, playing_id: 43, my_seat: 'S', hand: hand('S') })
    await flushPromises()
    expect(wrapper.findAll('.my-hand .playing-card')).toHaveLength(13)
  })

  test('a player short: nothing to confirm, but leaving is still free', async () => {
    const wrapper = await mountPage(finished(), makeTable(['N', 'E', 'S']))

    expect(nextBox(wrapper).text()).toContain('Waiting for a fourth player')
    expect(wrapper.find('.next-button').exists()).toBe(false)
    expect(nextBox(wrapper).text()).toContain('leaving now abandons nothing')
  })

  test('a refused request says why and rereads the board', async () => {
    const wrapper = await mountPage(finished())
    const config = { headers: new AxiosHeaders() }
    const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
    const message = 'The table is short of a player: the next board is dealt as soon as a fourth one sits down.'
    error.response = { status: 409, data: { status: 409, message, data: [] }, statusText: '', headers: {}, config }
    vi.mocked(gameService.nextBoard).mockRejectedValue(error)

    await nextBox(wrapper).get('.next-button').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith(message, 'danger')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
  })

  test('the last card seen live toasts the score', async () => {
    const inPlay = finished({ phase: 'play', result: null, deal: null, ready: null, turn: 'W', acting_user_id: 4 })
    await mountPage(inPlay)

    useGameStore().applyPlayingUpdate(5, finished())
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('Board over: 4♠ by N, +1: N-S +450.', 'success')
  })
})
