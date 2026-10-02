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
import type { SetResults } from '@/services/history'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'
import {
  formatScore,
  madeBy,
  madeText,
  resultContract,
  resultSummary,
  scoreFor,
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
vi.mock('@/services/history', () => ({ getMyPlayings: vi.fn(), getSet: vi.fn() }))
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
    forfeited_by: null,
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
      props: { result: result(), mySeat: 'E', setSoFar: setSoFar() },
    })

    expect(wrapper.get('.result-title').text()).toBe('4♠ by North')
    expect(wrapper.get('.result-detail').text()).toBe('Made with 1 overtrick · 11 tricks')
    expect(wrapper.get('.result-mine-value').text()).toBe('−450')
    expect(wrapper.get('.result-mine').classes()).toContain('score-minus')
    expect(wrapper.get('.result-sides').text()).toContain('N-S +450')
    expect(wrapper.get('.result-sides').text()).toContain('E-W −450')
    expect(wrapper.get('.side-mine').text()).toContain('E-W')
    expect(wrapper.get('.result-session').text()).toContain('Set 1 so far: 2 of 4 boards')
    expect(wrapper.get('.result-session').text()).toContain('you −870')
    expect(wrapper.get('.result-session').text()).toContain('(N-S +870)')
  })

  test('a passed-out board', () => {
    const wrapper = mount(BoardResultPanel, { props: { result: PASSED_OUT, mySeat: 'S' } })

    expect(wrapper.get('.result-title').text()).toBe('Passed out')
    expect(wrapper.get('.result-mine-value').text()).toBe('0')
    expect(wrapper.get('.result-summary').text()).toBe('Passed out: 0')
    expect(wrapper.find('.result-session').exists()).toBe(false)
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
      set: { id: 5, number: 1, board: 2, of: 4, finished: false, ended: null, forfeited_by: null },
      can_manage: false,
    }
  }

  // The fourth board of set 1, just finished: the set is over.
  function lastBoard(): Playing {
    return finished({
      set: { id: 5, number: 1, board: 4, of: 4, finished: true, ended: 'completed', forfeited_by: null },
    })
  }

  // 4♠ by North, made with an overtrick; the user is South.
  function finished(overrides: Partial<Playing> = {}): Playing {
    return {
      phase: 'finished',
      playing_id: 42,
      set: { id: 5, number: 1, board: 2, of: 4, finished: false, ended: null, forfeited_by: null },
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
      set: { id: 5, number: 1, board: 3, of: 4, finished: false, ended: null, forfeited_by: null },
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
    vi.mocked(historyService.getSet).mockResolvedValue(setSoFar())
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
    // The running score is the set's, read from GET /sets/{id}.
    expect(historyService.getSet).toHaveBeenCalledWith(5)
    expect(wrapper.get('.result-session').text()).toContain('Set 1 so far: 2 of 4 boards, you +870')
    // Where the table is in its set.
    expect(wrapper.get('.set-bar').text()).toBe('Board 2 of 4 · Set 1')
    // And the same board at the other tables is one tap away.
    const compare = wrapper.findAllComponents({ name: 'IonButton' }).find((b) => b.classes('compare'))
    expect(compare?.props('routerLink')).toMatch(/^\/boards\/\d+\/results$/)
  })

  test('"Next board" asks once, then waits for the others', async () => {
    const wrapper = await mountPage(finished({ ready: ['N'] }))
    vi.mocked(gameService.nextBoard).mockResolvedValue(finished({ ready: ['N', 'S'] }))

    await nextBox(wrapper).get('.next-button').trigger('click')
    await flushPromises()

    expect(gameService.nextBoard).toHaveBeenCalledWith(5)
    expect(wrapper.find('.next-button').exists()).toBe(false)
    expect(nextBox(wrapper).text()).toContain("You're ready. Waiting for bob, di.")
  })

  test('a manager gets the same "Next board" as everyone, and nothing that deals for the others', async () => {
    const wrapper = await mountPage(finished({ ready: ['N'] }), { ...makeTable(), can_manage: true })

    const buttons = nextBox(wrapper).findAllComponents({ name: 'IonButton' }).map((b) => b.text())
    expect(buttons).toEqual(['Next board', 'Leave the table'])
    expect(nextBox(wrapper).text()).not.toContain('for everyone')
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

  test('a player short: Start replaces Next', async () => {
    const wrapper = await mountPage(finished(), makeTable(['N', 'E', 'S']))

    expect(wrapper.find('.next-board').exists()).toBe(false)
    const box = wrapper.get('.start-box')
    expect(box.text()).toContain('Waiting for a fourth player, and for North (ann), East (bob) and you to press Start.')
    expect(box.get('[data-seat="W"]').text()).toContain('W empty')
  })

  test('a player replaced after the board: Start, which deals the next one here', async () => {
    const eve = { id: 9, name: 'Eve', username: 'eve', description: null }
    const refilled = makeTable()
    refilled.seats[3] = { ...refilled.seats[3], user_id: 9, user: eve }
    const wrapper = await mountPage(finished(), refilled)

    expect(wrapper.find('.next-board').exists()).toBe(false)
    expect(wrapper.get('.start-box').text()).toContain('West (eve)')

    const dealt = { ...refilled, board_id: 8 }
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...dealt, playing: newBoard() })
    await wrapper.get('.start-button').trigger('click')
    await flushPromises()

    expect(tablesService.startTable).toHaveBeenCalledWith(5)
    expect(wrapper.find('.start-box').exists()).toBe(false)
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
  })

  test("after the set's last board: the set's results and Start, not Next", async () => {
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

    expect(wrapper.get('.set-bar').text()).toBe('Board 4 of 4 · Set 1 · set over')
    const panel = wrapper.get('.set-results')
    expect(panel.get('.set-title').text()).toBe('Set 1 over')
    expect(panel.get('.set-winner').text()).toBe('You won the set.')
    expect(panel.findAll('.set-board')).toHaveLength(4)
    expect(panel.get('.set-total-value').text()).toBe('+1160')
    // The board's own result panel and Next give way to the set and Start.
    expect(wrapper.find('.result').exists()).toBe(false)
    expect(wrapper.find('.next-board').exists()).toBe(false)
    expect(wrapper.get('.start-box').text()).toContain('Ready to play?')
  })

  test("Start after a set deals board 1 of the next one", async () => {
    vi.mocked(historyService.getSet).mockResolvedValue(setSoFar({ finished: true, ended: 'completed', winner: 'EW' }))
    const wrapper = await mountPage(lastBoard())

    const next = newBoard()
    next.set = { id: 6, number: 2, board: 1, of: 4, finished: false, ended: null, forfeited_by: null }
    vi.mocked(tablesService.startTable).mockResolvedValue({ ...makeTable(), board_id: 8, set: next.set, playing: next })
    await wrapper.get('.start-button').trigger('click')
    await flushPromises()

    expect(tablesService.startTable).toHaveBeenCalledWith(5)
    expect(wrapper.find('.set-results').exists()).toBe(false)
    expect(wrapper.get('.set-bar').text()).toBe('Board 1 of 4 · Set 2')
    expect(wrapper.findAll('.my-hand .playing-card')).toHaveLength(13)
  })

  test('a forfeit between boards comes with the table and ends the set there', async () => {
    const forfeit = setSoFar({ finished: true, ended: 'forfeit', forfeited_by: 'EW', winner: 'NS' })
    vi.mocked(historyService.getSet).mockResolvedValue(forfeit)
    const wrapper = await mountPage(finished())
    expect(wrapper.find('.set-results').exists()).toBe(false)

    // East went away and didn't come back: their seat is free, the set over.
    const table = makeTable(['N', 'S', 'W'])
    table.set = { ...table.set!, finished: true, ended: 'forfeit', forfeited_by: 'EW' }
    forfeit.players = { N: PLAYERS.N, E: PLAYERS.E, S: PLAYERS.S, W: PLAYERS.W }
    useTablesStore().applyTableUpdate(table)
    await flushPromises()

    expect(historyService.getSet).toHaveBeenCalledTimes(2)
    const panel = wrapper.get('.set-results')
    expect(panel.get('.set-winner').text()).toBe('You won the set by forfeit.')
    expect(panel.get('.set-forfeit').text()).toBe("E-W forfeited, East didn't come back in time.")
    expect(wrapper.get('.start-box').text()).toContain('Waiting for a fourth player')
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
