import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import AuctionHistory from '@/components/AuctionHistory.vue'
import BiddingBox from '@/components/BiddingBox.vue'
import ExplainCallSheet from '@/components/ExplainCallSheet.vue'
import TablePlayPage from '@/views/TablePlayPage.vue'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import * as echo from '@/services/echo'
import type { AuctionCall, Bid, Playing, PublicPlaying, Strain } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import {
  NO_EXPLANATION,
  alertLines,
  alertText,
  answerText,
  emptyBook,
  isOpponent,
  isPartner,
  noteAlert,
  noteQuestion,
  openQuestion,
  questionText,
  takeNotes,
  withNotes,
} from '@/utils/alerts'
import { showToast } from '@/utils/toast'

// The board chat has its own specs: its read never answers here.
vi.mock('@/services/chat', () => ({ getMessages: () => new Promise(() => {}), sendMessage: () => new Promise(() => {}) }))
vi.mock('@/services/game', () => ({
  getPlaying: vi.fn(),
  getBids: vi.fn(),
  getCards: vi.fn(),
  makeCall: vi.fn(),
  askAboutCall: vi.fn(),
  explainCall: vi.fn(),
}))
vi.mock('@/services/history', () => ({ getSet: vi.fn() }))
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

// Ids run against the rank on purpose: nothing may lean on them.
const CODES = ['P', 'X', 'XX']
for (const level of [1, 2, 3, 4, 5, 6, 7]) {
  for (const strain of ['C', 'D', 'H', 'S', 'NT']) {
    CODES.push(`${level}${strain}`)
  }
}

function bid(call: string): Bid {
  const id = 100 - CODES.indexOf(call)
  const match = /^(\d)(C|D|H|S|NT)$/.exec(call)
  return match
    ? { id, call, level: Number(match[1]), strain: match[2] as Strain, special: false }
    : { id, call, level: null, strain: null, special: true }
}

const BIDS = CODES.map(bid)

// "N 1NT, E P, S 2C": North deals.
function calls(written: string): AuctionCall[] {
  return written
    ? written.split(', ').map((made) => {
        const [seat, call] = made.split(' ')
        return { seat: seat as Seat, bid: bid(call) }
      })
    : []
}

// As GET /playing answers for South: every call with its notes.
function noted(written: string, notes: Record<number, Partial<AuctionCall>> = {}): AuctionCall[] {
  return calls(written).map((call, i) => ({ ...call, alert: null, question: null, ...notes[i] }))
}

const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null },
  E: { id: 2, name: 'Bob', username: 'bob', description: null },
  S: { id: 3, name: 'Cy', username: 'cy', description: null },
  W: { id: 4, name: 'Di', username: 'di', description: null },
}

// The user is Cy, South; North deals.
function publicState(overrides: Partial<PublicPlaying> = {}): PublicPlaying {
  return {
    phase: 'auction',
    playing_id: 42,
    set: null,
    board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
    players: PLAYERS,
    turn: 'S',
    acting_user_id: 3,
    auction: calls('N 1NT, E P'),
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    claim: null,
    result: null,
    deal: null,
    ready: null,
    next_board_at: null,
    ...overrides,
  }
}

function state(overrides: Partial<Playing> = {}): Playing {
  return {
    ...publicState(),
    auction: noted('N 1NT, E P'),
    my_seat: 'S',
    hand: [],
    declarer_hand: null,
    ...overrides,
  }
}

function failure(status: number, message: string) {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { status, message, data: [] }, statusText: '', headers: {}, config }
  return error
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
})

describe('alert helpers', () => {
  test('an alert reads as its explanation, or says nothing was given', () => {
    expect(alertText({ explanation: 'Stayman' })).toBe('Stayman')
    expect(alertText({ explanation: null })).toBe(NO_EXPLANATION)
    expect(alertText({ explanation: '  ' })).toBe('Alerted, no explanation given.')
  })

  test('opponents are the other side, never for somebody not seated', () => {
    expect(isOpponent('E', 'S')).toBe(true)
    expect(isOpponent('W', 'N')).toBe(true)
    expect(isOpponent('N', 'S')).toBe(false)
    expect(isOpponent('S', 'S')).toBe(false)
    expect(isOpponent('E', null)).toBe(false)
  })

  test('partner sits across, never for somebody not seated', () => {
    expect(isPartner('N', 'S')).toBe(true)
    expect(isPartner('W', 'E')).toBe(true)
    expect(isPartner('E', 'S')).toBe(false)
    expect(isPartner('S', 'S')).toBe(false)
    expect(isPartner('N', null)).toBe(false)
  })

  test("partner's alerts come with the play's state and stay", () => {
    // During the auction partner's call has none for us.
    let book = takeNotes(emptyBook(), state({ auction: noted('N 2C, E P, S 2D, W P') }))
    expect(book.calls[0]).toEqual({ alert: null, question: null })

    book = takeNotes(
      book,
      state({
        phase: 'play',
        auction: noted('N 2C, E P, S 2D, W P, N 2H, E P, S P, W P', { 0: { alert: { explanation: 'Strong' } } }),
      }),
    )
    expect(book.calls[0]).toEqual({ alert: { explanation: 'Strong' }, question: null })
    const shown = withNotes(publicState({ phase: 'play', auction: calls('N 2C, E P, S 2D, W P, N 2H, E P, S P, W P') }), book)
    expect(shown.auction?.[0].alert).toEqual({ explanation: 'Strong' })
  })

  test('the book takes a state’s notes and lays them on a PlayingUpdated', () => {
    const book = takeNotes(
      emptyBook(),
      state({ auction: noted('N 1NT, E 2C', { 1: { alert: { explanation: 'Majors' }, question: { asked_by: 'S' } } }) }),
    )

    expect(book.playingId).toBe(42)
    expect(book.calls[1]).toEqual({ alert: { explanation: 'Majors' }, question: { asked_by: 'S' } })
    const shown = withNotes(publicState({ auction: calls('N 1NT, E 2C, S P') }), book)
    expect(shown.auction).toEqual([
      { ...calls('N 1NT')[0], alert: null, question: null },
      { ...calls('N 1NT, E 2C')[1], alert: { explanation: 'Majors' }, question: { asked_by: 'S' } },
      calls('N 1NT, E 2C, S P')[2],
    ])
  })

  test('a known alert outlives a state without it; a question is the state’s', () => {
    let book = noteAlert(emptyBook(), 42, 1, 'Majors')
    book = noteQuestion(book, 42, 0, 'W')

    book = takeNotes(book, state({ auction: noted('N 1NT, E 2C') }))
    expect(book.calls[1]).toEqual({ alert: { explanation: 'Majors' }, question: null })
    expect(book.calls[0]).toEqual({ alert: null, question: null })

    // Calls without notes (the public shape) leave the book as it is.
    book = takeNotes(book, publicState({ auction: calls('N 1NT, E 2C') }))
    expect(book.calls[1].alert).toEqual({ explanation: 'Majors' })
  })

  test('a new board starts a new book; an older board’s news is dropped', () => {
    const book = noteAlert(emptyBook(), 42, 1, 'Majors')

    expect(takeNotes(book, state({ playing_id: 43, auction: noted('N P') })).calls).toEqual({
      0: { alert: null, question: null },
    })
    expect(takeNotes(book, state({ playing_id: 41 }))).toBe(book)
    expect(takeNotes(book, state({ playing_id: null, auction: null }))).toEqual(emptyBook())
    expect(noteAlert(book, 41, 0, 'Old')).toBe(book)
    expect(noteQuestion(book, 41, 0, 'W')).toBe(book)
    expect(noteAlert(book, 43, 0, null)).toEqual({
      playingId: 43,
      calls: { 0: { alert: { explanation: null }, question: null } },
    })
  })

  test('notes go only on their own board', () => {
    const book = noteAlert(emptyBook(), 42, 0, 'Strong')
    const other = publicState({ playing_id: 43 })
    const none = publicState({ auction: null })

    expect(withNotes(other, book)).toBe(other)
    expect(withNotes(none, book)).toBe(none)
  })

  test('an answer clears the question; a question keeps the alert', () => {
    let book = noteAlert(emptyBook(), 42, 0, 'Strong')
    book = noteQuestion(book, 42, 0, 'E')
    expect(book.calls[0]).toEqual({ alert: { explanation: 'Strong' }, question: { asked_by: 'E' } })

    book = noteAlert(book, 42, 0, '15-17')
    expect(book.calls[0]).toEqual({ alert: { explanation: '15-17' }, question: null })
  })

  test('the first unanswered question about our own calls', () => {
    const auction = noted('N 1NT, E P, S 2C, W P', { 2: { question: { asked_by: 'W' } } })

    expect(openQuestion(auction, 'S')).toEqual({ index: 2, call: auction[2] })
    expect(openQuestion(auction, 'N')).toBeNull()
    expect(openQuestion(null, 'S')).toBeNull()
  })

  test('the words for a question, an answer and the export', () => {
    const [stayman] = calls('S 2C')

    expect(questionText('W', stayman)).toBe('West asks what your 2♣ means.')
    expect(questionText('E', null)).toBe('East asks what your call means.')
    expect(answerText(stayman, { explanation: 'Stayman' })).toBe('South explains 2♣: Stayman')
    expect(
      alertLines([
        { ...stayman, alert: { explanation: 'Stayman' } },
        ...calls('W P'),
        { ...calls('N 2D')[0], alert: { explanation: null } },
      ]),
    ).toEqual(['2♣ by South: Stayman', '2♦ by North: Alerted, no explanation given.'])
  })
})

describe('game store alerts', () => {
  async function loaded(playing: Playing = state()) {
    vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
    const game = useGameStore()
    await game.load(5)
    return game
  }

  const strong = () =>
    state({ auction: noted('N 2C, E P', { 0: { alert: { explanation: 'Strong, any shape' } } }) })

  test('PlayingUpdated carries no alerts, so the known ones stay', async () => {
    const game = await loaded(strong())

    game.applyPlayingUpdate(5, publicState({ auction: calls('N 2C, E P, S 2D'), turn: 'W', acting_user_id: 4 }))

    expect(game.playing?.auction?.[0].alert).toEqual({ explanation: 'Strong, any shape' })
    expect(game.playing?.auction?.[2]).toEqual(calls('N 2C, E P, S 2D')[2])
  })

  test('a new board drops them', async () => {
    const game = await loaded(strong())

    game.applyPlayingUpdate(5, publicState({ playing_id: 43, auction: calls('N 2C') }))

    expect(game.playing?.auction?.[0].alert).toBeUndefined()
  })

  test('CallAlerted puts an opponent’s alert on the board we hold', async () => {
    const game = await loaded()

    game.applyCallAlerted({ table_id: 5, playing_id: 42, index: 0, explanation: '15-17' })
    game.applyCallAlerted({ table_id: 6, playing_id: 42, index: 1, explanation: 'Other table' })

    expect(game.playing?.auction?.[0].alert).toEqual({ explanation: '15-17' })
    expect(game.playing?.auction?.[1].alert).toBeNull()
    expect(showToast).not.toHaveBeenCalled()
  })

  test('CallAlerted that beats its call shows once the call arrives', async () => {
    const game = await loaded()

    game.applyCallAlerted({ table_id: 5, playing_id: 42, index: 2, explanation: 'Transfer' })
    game.applyPlayingUpdate(5, publicState({ auction: calls('N 1NT, E P, S P, W 2D') }))

    expect(game.playing?.auction?.[3].alert).toBeUndefined()
    game.applyPlayingUpdate(5, publicState({ auction: calls('N 1NT, E 2D, S P') }))
    expect(game.playing?.auction?.[2].alert).toEqual({ explanation: 'Transfer' })
  })

  test('the answer to a question about an opponent’s call is told', async () => {
    const game = await loaded(state({ auction: noted('N 1NT, E 2C', { 1: { question: { asked_by: 'S' } } }) }))

    game.applyCallAlerted({ table_id: 5, playing_id: 42, index: 1, explanation: 'Both majors' })

    expect(game.playing?.auction?.[1]).toMatchObject({ alert: { explanation: 'Both majors' }, question: null })
    expect(showToast).toHaveBeenCalledWith('East explains 2♣: Both majors', 'success')
  })

  test('CallQuestioned marks our call and says so, wherever we are', async () => {
    const game = await loaded(state({ auction: noted('N 1NT, E P, S 2C, W P') }))

    game.applyCallQuestioned({ table_id: 5, playing_id: 42, index: 2, asked_by: 'W' })
    expect(game.playing?.auction?.[2].question).toEqual({ asked_by: 'W' })
    expect(showToast).toHaveBeenCalledWith('West asks what your 2♣ means.', 'warning', 'top')

    game.applyCallQuestioned({ table_id: 6, playing_id: 50, index: 0, asked_by: 'E' })
    expect(showToast).toHaveBeenLastCalledWith('East asks what your call means.', 'warning', 'top')
  })

  test('CallQuestioned before any board is held still marks it for later', async () => {
    const game = useGameStore()
    game.tableId = 5

    game.applyCallQuestioned({ table_id: 5, playing_id: 42, index: 0, asked_by: 'E' })
    game.applyCallAlerted({ table_id: 5, playing_id: 42, index: 1, explanation: null })

    expect(game.playing).toBeNull()
    expect(showToast).toHaveBeenCalledWith('East asks what your call means.', 'warning', 'top')
  })

  test('a call with its alert, a question and an explanation take their answers', async () => {
    const game = await loaded()
    vi.mocked(gameService.makeCall).mockResolvedValue(
      state({ auction: noted('N 1NT, E P, S 2C', { 2: { alert: { explanation: 'Stayman' } } }), turn: 'W' }),
    )
    vi.mocked(gameService.askAboutCall).mockResolvedValue(
      state({ auction: noted('N 1NT, E P, S 2C', { 0: { alert: { explanation: '15-17' } }, 2: { alert: { explanation: 'Stayman' } } }) }),
    )
    vi.mocked(gameService.explainCall).mockResolvedValue(
      state({ auction: noted('N 1NT, E P, S 2C', { 0: { alert: { explanation: '15-17' } }, 2: { alert: { explanation: 'Asks for a major' } } }) }),
    )

    await game.call(bid('2C').id, { alert: true, explanation: 'Stayman' })
    expect(gameService.makeCall).toHaveBeenCalledWith(5, bid('2C').id, { alert: true, explanation: 'Stayman' })
    expect(game.playing?.auction?.[2].alert).toEqual({ explanation: 'Stayman' })

    await game.askAboutCall(0)
    expect(gameService.askAboutCall).toHaveBeenCalledWith(5, 0)
    expect(game.playing?.auction?.[0].alert).toEqual({ explanation: '15-17' })

    await game.explainCall(2, 'Asks for a major')
    expect(gameService.explainCall).toHaveBeenCalledWith(5, 2, 'Asks for a major')
    expect(game.playing?.auction?.[2].alert).toEqual({ explanation: 'Asks for a major' })
  })

  test('the user channel hands its alerts and questions to the store', async () => {
    // Watching starts from a clean store, as at login.
    useGameStore().watchUser(3)
    const game = await loaded()
    const [, , , , onAlerted, onQuestioned] = vi.mocked(echo.listenToUser).mock.calls[0]

    onAlerted({ table_id: 5, playing_id: 42, index: 0, explanation: 'Weak' })
    onQuestioned({ table_id: 5, playing_id: 42, index: 1, asked_by: 'W' })

    expect(game.playing?.auction?.[0].alert).toEqual({ explanation: 'Weak' })
    expect(game.playing?.auction?.[1].question).toEqual({ asked_by: 'W' })
  })

  // The auction just ended: 2♣ by North (partner), passed out round to 2♥.
  const played = (overrides: Partial<Playing> = {}) =>
    state({
      phase: 'play',
      turn: 'E',
      acting_user_id: 2,
      auction: noted('N 2C, E P, S 2D, W P, N 2H, E P, S P, W P'),
      ...overrides,
    })

  test("AuctionAlertsShown lays partner's alerts on the board we hold", async () => {
    const game = await loaded(played())

    game.applyAuctionAlertsShown({
      table_id: 5,
      playing_id: 42,
      alerts: [
        { index: 0, explanation: 'Strong' },
        { index: 4, explanation: null },
      ],
    })

    expect(game.playing?.auction?.[0].alert).toEqual({ explanation: 'Strong' })
    expect(game.playing?.auction?.[4].alert).toEqual({ explanation: null })
    expect(game.playing?.auction?.[2].alert).toBeNull()
    // PlayingUpdated carries none: they stay.
    game.applyPlayingUpdate(5, publicState({ phase: 'play', turn: 'S', auction: calls('N 2C, E P, S 2D, W P, N 2H, E P, S P, W P') }))
    expect(game.playing?.auction?.[0].alert).toEqual({ explanation: 'Strong' })
    expect(showToast).not.toHaveBeenCalled()
  })

  test('AuctionAlertsShown for another table, an older or a newer board is dropped', async () => {
    const game = await loaded(played())
    const alerts = [{ index: 0, explanation: 'Strong' }]

    game.applyAuctionAlertsShown({ table_id: 6, playing_id: 42, alerts })
    game.applyAuctionAlertsShown({ table_id: 5, playing_id: 41, alerts })
    game.applyAuctionAlertsShown({ table_id: 5, playing_id: 43, alerts })
    expect(game.playing?.auction?.[0].alert).toBeNull()

    // Nor is anything noted while no board is held.
    game.clear()
    game.tableId = 5
    game.applyAuctionAlertsShown({ table_id: 5, playing_id: 42, alerts })
    expect(game.playing).toBeNull()
    vi.mocked(gameService.getPlaying).mockResolvedValue(played())
    await game.load(5)
    expect(game.playing?.auction?.[0].alert).toBeNull()
  })

  test("a reload in the play reads partner's alerts from the state", async () => {
    const game = await loaded(
      played({ auction: noted('N 2C, E P, S 2D, W P, N 2H, E P, S P, W P', { 0: { alert: { explanation: 'Strong' } } }) }),
    )

    expect(game.playing?.auction?.[0].alert).toEqual({ explanation: 'Strong' })
  })

  test("CallAlerted in the play may be partner's or our own answer: noted, never told back to us", async () => {
    const game = await loaded(
      played({ auction: noted('N 2C, E P, S 2D, W P, N 2H, E P, S P, W P', { 2: { question: { asked_by: 'W' } } }) }),
    )

    game.applyCallAlerted({ table_id: 5, playing_id: 42, index: 0, explanation: 'Strong' })
    game.applyCallAlerted({ table_id: 5, playing_id: 42, index: 2, explanation: 'Waiting' })

    expect(game.playing?.auction?.[0].alert).toEqual({ explanation: 'Strong' })
    expect(game.playing?.auction?.[2]).toMatchObject({ alert: { explanation: 'Waiting' }, question: null })
    expect(showToast).not.toHaveBeenCalled()
  })

  test("the user channel hands partner's alerts to the store", async () => {
    useGameStore().watchUser(3)
    const game = await loaded(played())
    const onAlertsShown = vi.mocked(echo.listenToUser).mock.calls[0][7]

    onAlertsShown({ table_id: 5, playing_id: 42, alerts: [{ index: 0, explanation: 'Strong' }] })

    expect(game.playing?.auction?.[0].alert).toEqual({ explanation: 'Strong' })
  })

  test('clearing forgets them', async () => {
    const game = await loaded(strong())

    game.clear()
    vi.mocked(gameService.getPlaying).mockResolvedValue(state({ auction: noted('N 2C, E P') }))
    await game.load(5)

    expect(game.playing?.auction?.[0].alert).toBeNull()
  })
})

describe('AuctionHistory alerts', () => {
  const board = { id: 7, number: 7, dealer: 'N' as Seat, vulnerable: '' as const }
  let wrapper: VueWrapper | null = null

  function mountAuction(auction: AuctionCall[], props: Record<string, unknown> = {}) {
    wrapper = mount(AuctionHistory, {
      props: { auction, board, mySeat: 'S', ...props },
      attachTo: document.body,
    })
    return wrapper
  }

  function cell(w: VueWrapper, text: string) {
    return w.findAll('.call-cell').find((c) => c.get('.call-button').text().startsWith(text))!
  }

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  test('an alerted call stands out with a "!"; the rest are plain in a review', () => {
    const w = mountAuction(noted('N 2C, E P, S 2D, W P', { 0: { alert: { explanation: 'Strong' } } }))

    expect(w.findAll('.call-button')).toHaveLength(1)
    const button = w.get('.call-button')
    expect(button.classes()).toContain('alerted')
    expect(button.get('.alert-mark').text()).toBe('!')
    expect(button.attributes('aria-label')).toBe('2 clubs, alerted')
  })

  test('a mouse hovering shows the explanation; moving away hides it', async () => {
    const w = mountAuction(noted('N 2C', { 0: { alert: { explanation: 'Strong' } } }))
    const c = cell(w, '2♣')

    await c.trigger('pointerenter', { pointerType: 'touch' })
    expect(w.find('.call-popup').exists()).toBe(false)

    await c.trigger('pointerenter', { pointerType: 'mouse' })
    expect(w.get('.call-popup').text()).toContain('2♣ by North')
    expect(w.get('.alert-text').text()).toBe('Partner alerted: Strong')

    await c.trigger('pointerleave', { pointerType: 'mouse' })
    expect(w.find('.call-popup').exists()).toBe(false)
  })

  test('a tap toggles it; Escape or a tap outside closes it', async () => {
    const w = mountAuction(noted('N P, E 2C', { 1: { alert: { explanation: null } } }))
    const button = w.get('.call-button')

    await button.trigger('click')
    expect(w.get('.alert-text').text()).toBe('Alerted, no explanation given.')
    expect(button.attributes('aria-expanded')).toBe('true')
    await button.trigger('click')
    expect(w.find('.call-popup').exists()).toBe(false)

    await button.trigger('click')
    ;(button.element as HTMLButtonElement).focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('.call-popup').exists()).toBe(false)
    expect(document.activeElement).toBe(button.element)

    await button.trigger('click')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(w.find('.call-popup').exists()).toBe(false)
  })

  test('the explanation is plain text, never HTML', async () => {
    const w = mountAuction(noted('N 2C', { 0: { alert: { explanation: '<b>Strong</b>' } } }))

    await w.get('.call-button').trigger('click')

    expect(w.get('.alert-text').text()).toBe('Partner alerted: <b>Strong</b>')
    expect(w.find('.alert-text b').exists()).toBe(false)
  })

  test('our own alerted call says what the opponents were told', async () => {
    const w = mountAuction(noted('N 1NT, E P, S 2C', { 2: { alert: { explanation: 'Stayman' } } }))

    await w.get('.call-button').trigger('click')

    expect(w.get('.call-title').text()).toBe('Your 2♣')
    expect(w.get('.alert-text').text()).toBe('You alerted: Stayman')
  })

  test("during the auction partner's call shows no alert, even one held", () => {
    const w = mountAuction(
      noted('N 2C, E P, S 2D, W 2H', { 0: { alert: { explanation: 'Strong' } }, 3: { alert: { explanation: 'Majors' } } }),
      { live: true, bidding: true },
    )

    // Partner's 2♣ is plain; West's 2♥ is alerted, East's pass askable.
    expect(w.findAll('.call-button').map((b) => b.text())).toEqual(['Pass', '2♥!'])
    expect(w.findAll('.alert-mark')).toHaveLength(1)
  })

  test("once the auction is over partner's alert shows, with no Ask", async () => {
    const w = mountAuction(
      noted('N 2C, E P, S 2D, W P, N 2H', { 0: { alert: { explanation: 'Strong' } }, 4: { alert: { explanation: null } } }),
      { live: true },
    )

    const strong = cell(w, '2♣')
    expect(strong.get('.call-button').classes()).toContain('alerted')
    expect(strong.get('.call-button').attributes('aria-label')).toBe('2 clubs, alerted')
    await strong.get('.call-button').trigger('click')
    expect(w.get('.call-title').text()).toBe('2♣ by North')
    expect(w.get('.alert-text').text()).toBe('Partner alerted: Strong')
    expect(w.find('.popup-action.ask').exists()).toBe(false)
    expect(w.find('.popup-action.ask-in-chat').exists()).toBe(false)
    expect(w.find('.popup-action.answer').exists()).toBe(false)

    await cell(w, '2♥').get('.call-button').trigger('click')
    expect(cell(w, '2♥').get('.alert-text').text()).toBe('Partner alerted: Alerted, no explanation given.')
  })

  test("while the board is on, any opponent's call can be asked about", async () => {
    const w = mountAuction(noted('N 1NT, E 2C, S P, W 2D'), { live: true })

    // East and West only: partner's calls and ours aren't asked about.
    expect(w.findAll('.call-button').map((b) => b.text())).toEqual(['2♣', '2♦'])
    await cell(w, '2♦').get('.call-button').trigger('click')
    expect(w.get('.no-alert').text()).toBe('Not alerted.')
    await w.get('.popup-action.ask').trigger('click')

    expect(w.emitted('ask')).toEqual([[3]])
  })

  test('while asked, it waits for the answer, and Ask is busy meanwhile', async () => {
    const w = mountAuction(
      noted('N 1NT, E 2C, S P, W 2D', { 1: { question: { asked_by: 'S' } }, 3: { question: { asked_by: 'N' } } }),
      { live: true, busy: true },
    )

    expect(cell(w, '2♣').find('.question-mark').exists()).toBe(true)
    await cell(w, '2♣').get('.call-button').trigger('click')
    expect(w.get('.question-text').text()).toBe('You asked: waiting for the answer.')
    // No second question until it is answered; the chat is still there.
    expect(w.find('.popup-action.ask').exists()).toBe(false)
    expect(w.find('.popup-action.ask-in-chat').exists()).toBe(true)

    await cell(w, '2♦').get('.call-button').trigger('click')
    expect(cell(w, '2♦').get('.question-text').text()).toBe('North asked: waiting for the answer.')

    const fresh = mountAuction(noted('N 1NT, E 2C'), { live: true, busy: true })
    await fresh.get('.call-button').trigger('click')
    expect((fresh.get('.popup-action.ask').element as HTMLButtonElement).disabled).toBe(true)
  })

  test('a question about our own call offers Answer', async () => {
    const w = mountAuction(noted('N 1NT, E P, S 2C', { 2: { question: { asked_by: 'E' } } }), {
      live: true,
    })

    await cell(w, '2♣').get('.call-button').trigger('click')
    expect(w.get('.question-text').text()).toBe('East asks what it means.')
    await w.get('.popup-action.answer').trigger('click')

    expect(w.emitted('explain')).toEqual([[2]])
    expect(w.find('.call-popup').exists()).toBe(false)
  })
})

describe('BiddingBox alert', () => {
  function mountBox(props: Record<string, unknown> = {}) {
    return mount(BiddingBox, {
      props: { bids: BIDS, auction: calls('N 1NT, E P'), seat: 'S' as Seat, busy: false, ...props },
    })
  }

  test('says who sees it, and typing an explanation alerts the call', async () => {
    const wrapper = mountBox()

    expect(wrapper.get('.alert-hint').text()).toBe('Only the opponents see this. Your partner doesn\'t.')
    expect(wrapper.get('.alert-input').attributes('maxlength')).toBe('200')
    await wrapper.get('.alert-input').setValue('  ')
    expect(wrapper.emitted('update:alert')).toBeUndefined()
    await wrapper.get('.alert-input').setValue('Stayman')

    expect(wrapper.emitted('update:explanation')).toEqual([['  '], ['Stayman']])
    expect(wrapper.emitted('update:alert')).toEqual([[true]])
  })

  test('the toggle alerts with nothing written; turned off, it drops the text', async () => {
    const off = mountBox()
    await off.get('.alert-toggle').trigger('click')
    expect(off.emitted('update:alert')).toEqual([[true]])

    const on = mountBox({ alert: true, explanation: 'Stayman' })
    expect(on.get('.alert-toggle').attributes('aria-pressed')).toBe('true')
    await on.get('.alert-toggle').trigger('click')
    expect(on.emitted('update:alert')).toEqual([[false]])
    expect(on.emitted('update:explanation')).toEqual([['']])
  })

  test('nothing can be changed while a call is on its way', () => {
    const wrapper = mountBox({ busy: true })

    expect((wrapper.get('.alert-input').element as HTMLInputElement).disabled).toBe(true)
    expect((wrapper.get('.alert-toggle').element as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ExplainCallSheet', () => {
  const modalStub = { template: '<div><slot /></div>' }

  function mountSheet(call: AuctionCall | null, busy = false) {
    return mount(ExplainCallSheet, {
      props: { open: true, call, busy },
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
  }

  test('starts from what was said, and sends the explanation trimmed', async () => {
    const wrapper = mountSheet({
      ...calls('S 2C')[0],
      alert: { explanation: 'Stayman' },
      question: { asked_by: 'W' },
    })

    expect(wrapper.get('.explain-title').text()).toBe('Explain your 2♣')
    expect(wrapper.get('.explain-asked').text()).toBe('West asks what it means.')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Stayman')
    await wrapper.get('textarea').setValue('  Asks for a major  ')
    expect(wrapper.get('.explain-hint').text()).toContain('20/200')
    await wrapper.get('.send-explanation').trigger('click')

    expect(wrapper.emitted('explain')).toEqual([['Asks for a major']])
  })

  test('nothing to send until something is written; nothing at all without a call', async () => {
    const wrapper = mountSheet(calls('S 2C')[0])

    expect(wrapper.find('.explain-asked').exists()).toBe(false)
    expect((wrapper.get('.send-explanation').element as HTMLButtonElement).disabled).toBe(true)
    expect(mountSheet(null).find('.explain-sheet').exists()).toBe(false)
    expect(mountSheet(calls('S 2C')[0], true).find('ion-spinner').exists()).toBe(true)
  })
})

describe('TablePlayPage alerts', () => {
  const table: Table = {
    id: 5,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: 7,
    created_at: '',
    updated_at: '',
    seats: (['N', 'E', 'S', 'W'] as Seat[]).map((seat, i) => ({
      id: i + 1,
      table_id: 5,
      user_id: PLAYERS[seat].id,
      seat,
      user: PLAYERS[seat],
    })),
    free_seats: [],
    can_manage: false,
  }

  const modalStub = { template: '<div><slot /></div>' }
  let wrapper: VueWrapper | null = null

  async function mountPage(playing: Playing) {
    vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
    wrapper = mount(TablePlayPage, {
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
      attachTo: document.body,
    })
    await flushPromises()
    return wrapper
  }

  function callButton(w: VueWrapper, text: string) {
    return w.findAll('.auction .call-button').find((b) => b.text().startsWith(text))!
  }

  beforeEach(() => {
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    vi.mocked(gameService.getBids).mockResolvedValue(BIDS)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  test('the next call goes out with its alert, which then clears', async () => {
    const w = await mountPage(state())
    // As if still our turn, to see the box again.
    vi.mocked(gameService.makeCall).mockResolvedValue(state({ auction: noted('N 1NT, E P, S 2C, W P, N 2D, E P') }))

    await w.get('.alert-input').setValue(' Stayman ')
    await w.get('button[data-call="2C"]').trigger('click')
    await flushPromises()

    expect(gameService.makeCall).toHaveBeenCalledWith(5, bid('2C').id, { alert: true, explanation: 'Stayman' })
    expect((w.get('.alert-input').element as HTMLInputElement).value).toBe('')
    expect(w.get('.alert-toggle').attributes('aria-pressed')).toBe('false')

    // The toggle alone alerts with nothing said; nothing at all, no alert.
    await w.get('.alert-toggle').trigger('click')
    await w.get('button[data-call="2NT"]').trigger('click')
    await flushPromises()
    expect(gameService.makeCall).toHaveBeenLastCalledWith(5, bid('2NT').id, { alert: true, explanation: null })
    await w.get('button[data-call="3C"]').trigger('click')
    await flushPromises()
    expect(gameService.makeCall).toHaveBeenLastCalledWith(5, bid('3C').id, null)
  })

  test('a refused call keeps the alert typed', async () => {
    const w = await mountPage(state())
    vi.mocked(gameService.makeCall).mockRejectedValue(failure(409, 'Bid higher than 1NT.'))

    await w.get('.alert-input').setValue('Stayman')
    await w.get('button[data-call="2C"]').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('Bid higher than 1NT.', 'danger')
    expect((w.get('.alert-input').element as HTMLInputElement).value).toBe('Stayman')
    expect(w.get('.alert-toggle').attributes('aria-pressed')).toBe('true')
  })

  test('a new board starts with nothing typed', async () => {
    const w = await mountPage(state())

    await w.get('.alert-input').setValue('Stayman')
    useGameStore().applyPlayingUpdate(5, publicState({ playing_id: 43, auction: [] }))
    await flushPromises()

    expect((w.get('.alert-input').element as HTMLInputElement).value).toBe('')
  })

  test("an opponent's alert stands out; Ask brings a robot's answer at once", async () => {
    const auction = 'N P, E 1NT, S P, W 2D'
    const w = await mountPage(
      state({ turn: 'N', acting_user_id: 1, auction: noted(auction, { 3: { alert: { explanation: 'Transfer' } } }) }),
    )
    vi.mocked(gameService.askAboutCall).mockResolvedValue(
      state({
        turn: 'N',
        acting_user_id: 1,
        auction: noted(auction, { 1: { alert: { explanation: '15-17 balanced' } }, 3: { alert: { explanation: 'Transfer' } } }),
      }),
    )

    expect(callButton(w, '2♦').classes()).toContain('alerted')
    expect(callButton(w, '1NT').classes()).not.toContain('alerted')
    await callButton(w, '1NT').trigger('click')
    await w.get('.popup-action.ask').trigger('click')
    await flushPromises()

    expect(gameService.askAboutCall).toHaveBeenCalledWith(5, 1)
    expect(w.get('.alert-text').text()).toBe('15-17 balanced')
  })

  test('a refused question says why and rereads the board', async () => {
    const w = await mountPage(state({ turn: 'N', acting_user_id: 1, auction: noted('N P, E 1NT, S P, W P') }))
    vi.mocked(gameService.askAboutCall).mockRejectedValue(failure(409, 'West has asked about that call already.'))

    await callButton(w, '1NT').trigger('click')
    await w.get('.popup-action.ask').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('West has asked about that call already.', 'danger')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
  })

  test('a question about our call opens the sheet; the answer goes out', async () => {
    const w = await mountPage(state({ turn: 'N', acting_user_id: 1, auction: noted('N 1NT, E P, S 2C, W P') }))
    expect(w.find('.explain-sheet').exists()).toBe(false)
    vi.mocked(gameService.explainCall).mockResolvedValue(
      state({ turn: 'N', acting_user_id: 1, auction: noted('N 1NT, E P, S 2C, W P', { 2: { alert: { explanation: 'Stayman' } } }) }),
    )

    useGameStore().applyCallQuestioned({ table_id: 5, playing_id: 42, index: 2, asked_by: 'W' })
    await flushPromises()

    expect(w.get('.explain-asked').text()).toBe('West asks what it means.')
    await w.get('.explain-input').setValue('Stayman')
    await w.get('.send-explanation').trigger('click')
    await flushPromises()

    expect(gameService.explainCall).toHaveBeenCalledWith(5, 2, 'Stayman')
    expect(w.find('.explain-sheet').exists()).toBe(false)
  })

  test('closed, the sheet comes back from the call’s Answer, and a too long answer keeps it open', async () => {
    const w = await mountPage(
      state({ turn: 'N', acting_user_id: 1, auction: noted('N 1NT, E P, S 2C, W P', { 2: { question: { asked_by: 'W' } } }) }),
    )
    expect(w.find('.explain-sheet').exists()).toBe(true)
    w.findComponent(ExplainCallSheet).vm.$emit('close')
    await flushPromises()
    expect(w.find('.explain-sheet').exists()).toBe(false)

    await callButton(w, '2♣').trigger('click')
    await w.get('.popup-action.answer').trigger('click')
    expect(w.find('.explain-sheet').exists()).toBe(true)

    vi.mocked(gameService.explainCall).mockRejectedValueOnce(failure(422, 'The explanation may not be greater than 200 characters.'))
    await w.get('.explain-input').setValue('Long')
    await w.get('.send-explanation').trigger('click')
    await flushPromises()
    expect(showToast).toHaveBeenCalledWith('The explanation may not be greater than 200 characters.', 'danger')
    expect(w.find('.explain-sheet').exists()).toBe(true)

    vi.mocked(gameService.explainCall).mockRejectedValueOnce(failure(409, 'The board is over: every alert is public now.'))
    await w.get('.send-explanation').trigger('click')
    await flushPromises()
    expect(w.find('.explain-sheet').exists()).toBe(false)
  })

  test('during the play the auction below the hand still asks and answers', async () => {
    const w = await mountPage(
      state({
        phase: 'play',
        turn: 'W',
        acting_user_id: 4,
        auction: noted('N 1NT, E P, S 3NT, W P, N P, E P', { 2: { question: { asked_by: 'E' } } }),
        contract: { bid: bid('3NT'), doubled: 0, declarer: 'S', dummy: 'N' },
        tricks: [],
        current_trick: [],
        tricks_won: { ns: 0, ew: 0 },
      }),
    )
    w.findComponent(ExplainCallSheet).vm.$emit('close')
    await flushPromises()
    vi.mocked(gameService.askAboutCall).mockResolvedValue(state())

    await callButton(w, 'Pass').trigger('click')
    await w.get('.popup-action.ask').trigger('click')
    await flushPromises()
    expect(gameService.askAboutCall).toHaveBeenCalledWith(5, 1)
  })

  test("partner's alert held during the auction shows only once the play starts", async () => {
    const auction = 'N 2C, E P, S 2D, W P, N 2H, E P, S P'
    const w = await mountPage(state({ turn: 'W', acting_user_id: 4, auction: noted(auction) }))
    const game = useGameStore()

    // Held early (a late event), it stays hidden while the auction lasts.
    game.applyCallAlerted({ table_id: 5, playing_id: 42, index: 0, explanation: 'Strong' })
    await flushPromises()
    expect(callButton(w, '2♣')).toBeUndefined()

    game.applyPlayingUpdate(
      5,
      publicState({
        phase: 'play',
        turn: 'E',
        acting_user_id: 2,
        auction: calls(auction + ', W P'),
        contract: { bid: bid('2H'), doubled: 0, declarer: 'N', dummy: 'S' },
        tricks: [],
        current_trick: [],
        tricks_won: { ns: 0, ew: 0 },
      }),
    )
    await flushPromises()

    expect(callButton(w, '2♣').classes()).toContain('alerted')
    await callButton(w, '2♣').trigger('click')
    expect(w.get('.alert-text').text()).toBe('Partner alerted: Strong')
  })
})
