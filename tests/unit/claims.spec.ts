import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import TablePlayPage from '@/views/TablePlayPage.vue'
import BoardResultPanel from '@/components/BoardResultPanel.vue'
import ClaimPanel from '@/components/ClaimPanel.vue'
import ClaimSheet from '@/components/ClaimSheet.vue'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Bid, BoardResult, Card, Claim, Playing, Suit, Trick } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { canClaim, claimAction, claimSeatOf, claimText, claimWaitingFor, tricksLeft } from '@/utils/claim'
import { handToPlay } from '@/utils/play'
import { resultSummary } from '@/utils/result'
import { showToast } from '@/utils/toast'

vi.mock('@/services/game', () => ({
  getPlaying: vi.fn(),
  getBids: vi.fn(),
  makeCall: vi.fn(),
  playCard: vi.fn(),
  nextBoard: vi.fn(),
  makeClaim: vi.fn(),
  respondToClaim: vi.fn(),
  withdrawClaim: vi.fn(),
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
// Ionic's view hooks never fire outside a router outlet: run the page's
// "will enter" on mount, as the outlet would.
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate: vi.fn() }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})

// Players 1–4 sit N, E, S, W; South (3) declares 4♠ and North is dummy.
const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null },
  E: { id: 2, name: 'Bob', username: 'bob', description: null },
  S: { id: 3, name: 'Cy', username: 'cy', description: null },
  W: { id: 4, name: 'Di', username: 'di', description: null },
}
const FOUR_SPADES: Bid = { id: 20, call: '4S', level: 4, strain: 'S', special: false }

// "SA" is the ace of spades, "H10" the ten of hearts; ids are unique per card.
const RANKS: Record<string, number> = { J: 12, Q: 13, K: 14, A: 15 }
function c(name: string): Card {
  const suit = name[0] as Suit
  const rank = RANKS[name.slice(1)] ?? Number(name.slice(1))
  return { id: 'SHDC'.indexOf(suit) * 20 + rank, suit, rank, rank_name: name.slice(1) }
}
const cards = (...names: string[]) => names.map(c)

// `count` complete tricks, all won by South, of cards no hand below holds.
function tricks(count: number): Trick[] {
  return Array.from({ length: count }, (_, round) => ({
    round: round + 1,
    leader: 'S' as Seat,
    cards: (['S', 'W', 'N', 'E'] as Seat[]).map((seat, i) => ({
      seat,
      card: { id: 1000 + round * 4 + i, suit: 'C' as Suit, rank: 2, rank_name: '2' },
    })),
    winner: 'S' as Seat,
  }))
}

const SOUTH = cards('SA', 'SK', 'S7', 'HK', 'D2')
const NORTH = cards('SQ', 'H3', 'C9', 'C8', 'C7')

// 8 tricks gone, 5 left, South on lead.
function state(overrides: Partial<Playing> = {}): Playing {
  return {
    phase: 'play',
    playing_id: 42,
    board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
    players: PLAYERS,
    turn: 'S',
    acting_user_id: 3,
    auction: [],
    contract: { bid: FOUR_SPADES, doubled: 0, declarer: 'S', dummy: 'N' },
    tricks: tricks(8),
    current_trick: [],
    tricks_won: { ns: 8, ew: 0 },
    dummy_hand: NORTH,
    claim: null,
    result: null,
    deal: null,
    ready: null,
    my_seat: 'S',
    hand: SOUTH,
    ...overrides,
  }
}

function pending(overrides: Partial<Claim> = {}): Claim {
  return { seat: 'S', tricks: 4, hand: SOUTH, accepted: [], ...overrides }
}

// South (3) is dummy to a robot North, who declares 4♠: South plays both
// hands and claims for North.
const ROBOT_NORTH = { ...PLAYERS, N: { ...PLAYERS.N, username: 'robot-1', is_robot: true } }
function forRobot(overrides: Partial<Playing> = {}): Playing {
  return state({
    players: ROBOT_NORTH,
    contract: { bid: FOUR_SPADES, doubled: 0, declarer: 'N', dummy: 'S' },
    dummy_hand: SOUTH,
    declarer_hand: NORTH,
    ...overrides,
  })
}

// The same board as East or West sees it.
function asSeat(seat: Seat, overrides: Partial<Playing> = {}): Playing {
  return state({ my_seat: seat, hand: cards('HA', 'HQ', 'D9', 'D8', 'D7'), ...overrides })
}

const RESULT: BoardResult = {
  contract: FOUR_SPADES,
  doubled: 0,
  declarer: 'S',
  tricks_won: 12,
  score_ns: 480,
  made_by: 2,
  claimed: true,
}

function logIn(id: number) {
  const user = Object.values(PLAYERS).find((p) => p.id === id)!
  useAuthStore().user = { id, name: user.name, username: user.username, email: `${id}@example.com` }
}

function refused(message: string) {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status: 409, data: { status: 409, message, data: [] }, statusText: '', headers: {}, config }
  return error
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  logIn(3)
})

describe('claim hints', () => {
  test('tricks left count a trick in progress as still to play', () => {
    expect(tricksLeft(state())).toBe(5)
    expect(tricksLeft(state({ tricks: [] }))).toBe(13)
  })

  test('declarer and defenders may claim, dummy may not, nor during a pending claim', () => {
    expect(canClaim(state(), 'S')).toBe(true)
    expect(canClaim(state(), 'E')).toBe(true)
    expect(canClaim(state(), 'N')).toBe(false)
    expect(canClaim(state(), null)).toBe(false)
    expect(canClaim(state({ claim: pending() }), 'E')).toBe(false)
    expect(canClaim(state({ phase: 'auction' }), 'S')).toBe(false)
  })

  test('the claimer withdraws, those still to answer answer, dummy and the agreed wait', () => {
    const s = state({ claim: pending({ accepted: ['W'] }) })

    expect(claimAction(s, 'S')).toBe('withdraw')
    expect(claimAction(s, 'E')).toBe('answer')
    expect(claimAction(s, 'W')).toBeNull()
    expect(claimAction(s, 'N')).toBeNull()
    expect(claimWaitingFor(s)).toEqual(['E'])
  })

  test('without a claim, or a viewer not seated, nobody has anything to do', () => {
    expect(claimWaitingFor(state())).toEqual([])
    expect(claimAction(state(), 'S')).toBeNull()
    expect(claimAction(state({ claim: pending() }), null)).toBeNull()
  })

  test("a defender's claim is answered by declarer and the other defender", () => {
    const s = state({ claim: pending({ seat: 'E', tricks: 0 }) })

    expect(claimWaitingFor(s)).toEqual(['S', 'W'])
    expect(claimAction(s, 'S')).toBe('answer')
    expect(claimAction(s, 'N')).toBeNull()
  })

  test('the banner words a claim, all of them, a concession and the last trick', () => {
    expect(claimText(pending(), 5)).toBe('South claims 4 of the remaining 5 tricks')
    expect(claimText(pending({ tricks: 5 }), 5)).toBe('South claims all 5 remaining tricks')
    expect(claimText(pending({ seat: 'E', tricks: 0 }), 5)).toBe('East concedes the remaining 5 tricks')
    expect(claimText(pending({ tricks: 1 }), 1)).toBe('South claims the last trick')
    expect(claimText(pending(), 5, 'S')).toBe('You claim 4 of the remaining 5 tricks')
  })

  test("a robot declarer's dummy claims and answers for declarer's seat", () => {
    expect(claimSeatOf(forRobot())).toBe('N')
    expect(canClaim(forRobot(), claimSeatOf(forRobot()))).toBe(true)
    // Anyone else claims for their own seat, dummy of a human for none.
    expect(claimSeatOf(state())).toBe('S')
    expect(claimSeatOf(state({ my_seat: 'N' }))).toBe('N')
    expect(canClaim(state({ my_seat: 'N' }), claimSeatOf(state({ my_seat: 'N' })))).toBe(false)
    expect(claimSeatOf(forRobot({ my_seat: 'E' }))).toBe('E')

    const theirs = forRobot({ claim: pending({ seat: 'E', tricks: 0 }) })
    expect(claimAction(theirs, claimSeatOf(theirs))).toBe('answer')
    const ours = forRobot({ claim: pending({ seat: 'N' }) })
    expect(claimAction(ours, claimSeatOf(ours))).toBe('withdraw')
  })

  test("the banner words a claim made for declarer's seat", () => {
    expect(claimText(pending({ seat: 'N', tricks: 3 }), 5, 'S', 'N')).toBe(
      'You claim 3 of the remaining 5 tricks for North',
    )
    expect(claimText(pending({ seat: 'N', tricks: 5 }), 5, 'S', 'N')).toBe(
      'You claim all 5 remaining tricks for North',
    )
    expect(claimText(pending({ seat: 'N', tricks: 0 }), 5, 'S', 'N')).toBe(
      'You concede the remaining 5 tricks for North',
    )
    expect(claimText(pending({ seat: 'N', tricks: 1 }), 1, 'S', 'N')).toBe(
      'You claim the last trick for North',
    )
    // A defender's claim reads as before.
    expect(claimText(pending({ seat: 'E', tricks: 0 }), 5, 'S', 'N')).toBe(
      'East concedes the remaining 5 tricks',
    )
  })

  test('no hand is on play while a claim is pending', () => {
    expect(handToPlay(state(), 3)).toBe('own')
    expect(handToPlay(state({ claim: pending() }), 3)).toBeNull()
  })

  test('a claimed result says so', () => {
    expect(resultSummary(RESULT)).toBe('4♠ by S, +2 by claim: N-S +480')
    expect(resultSummary({ ...RESULT, claimed: false })).toBe('4♠ by S, +2: N-S +480')
  })

  test('the result panel says "by claim"', () => {
    const wrapper = mount(BoardResultPanel, { props: { result: RESULT, mySeat: 'S' } })

    expect(wrapper.get('.result-detail').text()).toBe('Made with 2 overtricks · 12 tricks, by claim')
  })
})

describe('game store claims', () => {
  async function loaded(playing: Playing = state()) {
    vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
    const game = useGameStore()
    await game.load(5)
    return game
  }

  test('a claim sends its tricks and takes the state it answers with', async () => {
    const game = await loaded()
    const after = state({ claim: pending() })
    vi.mocked(gameService.makeClaim).mockResolvedValue(after)

    await game.claim(4)

    expect(gameService.makeClaim).toHaveBeenCalledWith(5, 4)
    expect(game.playing).toEqual(after)
  })

  test('an answer and a withdrawal go out and take their state', async () => {
    const game = await loaded(asSeat('E', { claim: pending() }))
    vi.mocked(gameService.respondToClaim).mockResolvedValue(asSeat('E', { claim: pending({ accepted: ['E'] }) }))

    await game.respondToClaim(true)

    expect(gameService.respondToClaim).toHaveBeenCalledWith(5, true)
    expect(game.playing?.claim?.accepted).toEqual(['E'])

    vi.mocked(gameService.withdrawClaim).mockResolvedValue(asSeat('E'))
    await game.withdrawClaim()
    expect(gameService.withdrawClaim).toHaveBeenCalledWith(5)
    expect(game.playing?.claim).toBeNull()
  })

  test('a claim appearing over the channel is newer, cards unchanged', async () => {
    const game = await loaded()

    game.applyPlayingUpdate(5, { ...state({ claim: pending() }) })

    expect(game.playing?.claim).toEqual(pending())
    expect(game.playing?.hand).toEqual(SOUTH)
  })

  test('a claim going away is newer too: play resumes where it stopped', async () => {
    const game = await loaded(state({ claim: pending({ accepted: ['W'] }) }))

    game.applyPlayingUpdate(5, { ...state() })

    expect(game.playing?.claim).toBeNull()
    expect(handToPlay(game.playing!, 3)).toBe('own')
  })

  test("an answer's reply does not undo a later accept the channel already brought", async () => {
    const game = await loaded(asSeat('E', { claim: pending() }))
    let answer!: (s: Playing) => void
    vi.mocked(gameService.respondToClaim).mockReturnValue(new Promise((resolve) => (answer = resolve)))

    const sending = game.respondToClaim(true)
    game.applyPlayingUpdate(5, { ...asSeat('E', { claim: pending({ accepted: ['E', 'W'] }) }) })
    answer(asSeat('E', { claim: pending({ accepted: ['E'] }) }))
    await sending

    expect(game.playing?.claim?.accepted).toEqual(['E', 'W'])
  })

  test('a late claim state does not undo the board the last accept finished', async () => {
    const game = await loaded(asSeat('E', { claim: pending({ accepted: ['W'] }) }))
    const finished = asSeat('E', { phase: 'finished', claim: null, result: RESULT })
    vi.mocked(gameService.respondToClaim).mockResolvedValue(finished)

    await game.respondToClaim(true)
    game.applyPlayingUpdate(5, { ...asSeat('E', { claim: pending({ accepted: ['W'] }) }) })

    expect(game.playing?.phase).toBe('finished')
    expect(game.playing?.result?.claimed).toBe(true)
  })
})

describe('ClaimSheet', () => {
  const modalStub = { template: '<div><slot /></div>' }

  const mountSheet = (props: { open?: boolean; remaining: number; busy?: boolean }) =>
    mount(ClaimSheet, {
      props: { open: true, ...props },
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })

  const picks = (wrapper: ReturnType<typeof mountSheet>) => wrapper.findAll('.trick-pick').map((b) => b.text())
  const isDisabled = (el: { element: Element }) => (el.element as HTMLButtonElement).disabled

  test('one button per trick left, nothing picked and Claim disabled to start with', () => {
    const wrapper = mountSheet({ remaining: 6 })

    expect(picks(wrapper)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(wrapper.findAll('.trick-pick.picked')).toHaveLength(0)
    expect(wrapper.get('.send-claim').text()).toBe('Pick a number')
    expect(isDisabled(wrapper.get('.send-claim'))).toBe(true)
  })

  test('with 13 tricks left there are 13 buttons, with 1 left a single one', () => {
    expect(picks(mountSheet({ remaining: 13 }))).toHaveLength(13)
    expect(picks(mountSheet({ remaining: 1 }))).toEqual(['1'])
  })

  test('a pick only selects; the send button then claims that number', async () => {
    const wrapper = mountSheet({ remaining: 6 })

    await wrapper.get('[data-tricks="4"]').trigger('click')
    expect(wrapper.emitted('claim')).toBeUndefined()
    expect(isDisabled(wrapper.get('.send-claim'))).toBe(false)
    expect(wrapper.get('.picked').text()).toBe('4')
    expect(wrapper.get('.send-claim').text()).toBe('Claim 4 tricks')

    // Changing the pick is one more tap.
    await wrapper.get('[data-tricks="1"]').trigger('click')
    expect(wrapper.findAll('.picked').map((b) => b.text())).toEqual(['1'])
    expect(wrapper.get('.send-claim').text()).toBe('Claim 1 trick')

    await wrapper.get('[data-tricks="4"]').trigger('click')
    await wrapper.get('.send-claim').trigger('click')
    expect(wrapper.emitted('claim')).toEqual([[4]])
  })

  test('Concede the rest claims 0 without a pick', async () => {
    const wrapper = mountSheet({ remaining: 6 })

    await wrapper.get('.concede').trigger('click')
    expect(wrapper.emitted('claim')).toEqual([[0]])
  })

  test("claiming for a robot declarer names its seat, whose hand goes face up", () => {
    const wrapper = mount(ClaimSheet, {
      props: { open: true, remaining: 5, forSeat: 'N' },
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })

    expect(wrapper.get('.claim-title').text()).toBe('Claim tricks for North')
    expect(wrapper.get('.claim-help').text()).toContain("North's hand is shown to everyone")
    expect(mountSheet({ remaining: 5 }).get('.claim-help').text()).toContain('Your hand is shown to everyone')
  })

  test('busy disables every button', () => {
    const wrapper = mountSheet({ remaining: 3, busy: true })

    for (const b of wrapper.findAll('ion-button')) {
      expect(isDisabled(b)).toBe(true)
    }
  })

  test('reopening the sheet clears the pick', async () => {
    const wrapper = mountSheet({ remaining: 6 })
    await wrapper.get('[data-tricks="3"]').trigger('click')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.findAll('.picked')).toHaveLength(0)
    expect(wrapper.get('.send-claim').text()).toBe('Pick a number')
  })
})

describe('ClaimPanel for a robot declarer', () => {
  test("the claim made for declarer's seat is ours to withdraw", () => {
    const wrapper = mount(ClaimPanel, {
      props: { state: forRobot({ claim: pending({ seat: 'N', hand: NORTH }) }) as Playing & { claim: Claim }, mySeat: 'S', actsFor: 'N', players: ROBOT_NORTH },
    })

    expect(wrapper.get('.claim-text').text()).toBe('You claim 4 of the remaining 5 tricks for North')
    expect(wrapper.find('.withdraw').exists()).toBe(true)
  })

  test("a defender's claim is ours to answer, on declarer's behalf", () => {
    const wrapper = mount(ClaimPanel, {
      props: { state: forRobot({ claim: pending({ seat: 'E', tricks: 0 }) }) as Playing & { claim: Claim }, mySeat: 'S', actsFor: 'N', players: ROBOT_NORTH },
    })

    expect(wrapper.find('.accept').exists()).toBe(true)
    expect(wrapper.get('[data-seat="N"]').text()).toContain('you')
    expect(wrapper.get('.claim-detail').text()).toBe('Play stops until you and W answer.')
  })
})

describe('TablePlayPage claims', () => {
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

  async function mountPage(playing: Playing) {
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    vi.mocked(gameService.getBids).mockResolvedValue([])
    vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
    const wrapper = mount(TablePlayPage, {
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
    await flushPromises()
    return wrapper
  }

  const buttonTexts = (wrapper: ReturnType<typeof mount>, selector: string) =>
    wrapper.findAll(`${selector} ion-button`).map((b) => b.text())

  test('declarer claims from the sheet: a number picked, then sent', async () => {
    const wrapper = await mountPage(state())
    vi.mocked(gameService.makeClaim).mockResolvedValue(state({ claim: pending() }))

    await wrapper.get('.claim-button').trigger('click')
    expect(wrapper.findAll('.trick-pick').map((b) => b.text())).toEqual(['1', '2', '3', '4', '5'])
    await wrapper.get('[data-tricks="4"]').trigger('click')
    expect(wrapper.get('.send-claim').text()).toBe('Claim 4 tricks')
    await wrapper.get('.send-claim').trigger('click')
    await flushPromises()

    expect(gameService.makeClaim).toHaveBeenCalledWith(5, 4)
    expect(wrapper.get('.claim-text').text()).toBe('You claim 4 of the remaining 5 tricks')
    expect(buttonTexts(wrapper, '.claim-buttons')).toEqual(['Withdraw'])
    expect(wrapper.find('.claim-button').exists()).toBe(false)
  })

  test('the claimer takes the claim back with Withdraw', async () => {
    const wrapper = await mountPage(state({ claim: pending() }))
    vi.mocked(gameService.withdrawClaim).mockResolvedValue(state())

    await wrapper.get('.withdraw').trigger('click')
    await flushPromises()

    expect(gameService.withdrawClaim).toHaveBeenCalledWith(5)
    expect(wrapper.find('.claim-text').exists()).toBe(false)
  })

  test('a defender concedes in one tap', async () => {
    logIn(2)
    const wrapper = await mountPage(asSeat('E', { turn: 'S', acting_user_id: 3 }))
    vi.mocked(gameService.makeClaim).mockResolvedValue(asSeat('E', { claim: pending({ seat: 'E', tricks: 0 }) }))

    await wrapper.get('.concede').trigger('click')
    await flushPromises()

    expect(gameService.makeClaim).toHaveBeenCalledWith(5, 0)
    expect(wrapper.get('.claim-text').text()).toBe('You concede the remaining 5 tricks')
  })

  test('dummy has no Claim button, and waits on a pending claim', async () => {
    logIn(1)
    const wrapper = await mountPage(state({ my_seat: 'N', hand: NORTH }))
    expect(wrapper.find('.claim-button').exists()).toBe(false)

    useGameStore().applyPlayingUpdate(5, { ...state({ claim: pending() }) })
    await flushPromises()

    expect(wrapper.find('.claim-buttons').exists()).toBe(false)
    expect(wrapper.get('.claim-detail').text()).toBe('Play stops until E and W answer.')
    // Declarer sits opposite dummy: their cards lie face up at the top.
    expect(wrapper.find('.side-top .claim-hand').exists()).toBe(true)
  })

  test("a defender sees the claimer's hand, answers, and can't play a card", async () => {
    logIn(4)
    const wrapper = await mountPage(asSeat('W', { turn: 'W', acting_user_id: 4, claim: pending() }))
    vi.mocked(gameService.respondToClaim).mockResolvedValue(asSeat('W', { claim: pending({ accepted: ['W'] }) }))

    expect(wrapper.get('.claim-text').text()).toBe('South claims 4 of the remaining 5 tricks')
    // West sees South on the right.
    expect(wrapper.find('.side-right .claim-hand').exists()).toBe(true)
    expect(wrapper.findAll('button[data-card]')).toHaveLength(0)
    expect(buttonTexts(wrapper, '.claim-buttons')).toEqual(['Accept', 'Reject'])

    await wrapper.get('.accept').trigger('click')
    await flushPromises()

    expect(gameService.respondToClaim).toHaveBeenCalledWith(5, true)
    expect(wrapper.find('.claim-buttons').exists()).toBe(false)
    expect(wrapper.get('.claim-detail').text()).toBe('Play stops until E answers.')
  })

  test('a reject resumes play where it stopped, with a toast', async () => {
    logIn(4)
    const wrapper = await mountPage(asSeat('W', { turn: 'W', acting_user_id: 4, claim: pending() }))
    vi.mocked(gameService.respondToClaim).mockResolvedValue(asSeat('W', { turn: 'W', acting_user_id: 4 }))

    await wrapper.get('.reject').trigger('click')
    await flushPromises()

    expect(gameService.respondToClaim).toHaveBeenCalledWith(5, false)
    expect(showToast).toHaveBeenCalledWith("South's claim is off: play goes on.", 'warning')
    expect(wrapper.find('.claim').exists()).toBe(false)
    expect(wrapper.findAll('.my-hand button[data-card]').length).toBeGreaterThan(0)
  })

  test('the last accept, seen live, shows the result by claim to everyone', async () => {
    const wrapper = await mountPage(state({ claim: pending({ accepted: ['W'] }) }))

    useGameStore().applyPlayingUpdate(5, { ...state({ phase: 'finished', turn: null, acting_user_id: null, result: RESULT, ready: [] }) })
    await flushPromises()

    expect(wrapper.get('.result-detail').text()).toContain('by claim')
    expect(showToast).toHaveBeenCalledWith('Board over: 4♠ by S, +2 by claim: N-S +480.', 'success')
  })

  test("a robot declarer's dummy claims for declarer from the sheet", async () => {
    const wrapper = await mountPage(forRobot())
    vi.mocked(gameService.makeClaim).mockResolvedValue(forRobot({ claim: pending({ seat: 'N', hand: NORTH }) }))

    await wrapper.get('.claim-button').trigger('click')
    expect(wrapper.get('.claim-title').text()).toBe('Claim tricks for North')
    await wrapper.get('[data-tricks="4"]').trigger('click')
    await wrapper.get('.send-claim').trigger('click')
    await flushPromises()

    expect(gameService.makeClaim).toHaveBeenCalledWith(5, 4)
    expect(wrapper.get('.claim-text').text()).toBe('You claim 4 of the remaining 5 tricks for North')
    expect(buttonTexts(wrapper, '.claim-buttons')).toEqual(['Withdraw'])
    // North's cards stay across the top, where we play them from.
    expect(wrapper.find('.side-top .declarer-hand').exists()).toBe(true)
  })

  test("a refused claim shows the backend's reason and rereads the board", async () => {
    const wrapper = await mountPage(state())
    vi.mocked(gameService.makeClaim).mockRejectedValue(refused('A claim is already pending: E claims 0.'))

    await wrapper.get('.claim-button').trigger('click')
    await wrapper.get('[data-tricks="5"]').trigger('click')
    await wrapper.get('.send-claim').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('A claim is already pending: E claims 0.', 'danger')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
  })
})
