import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
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
import {
  CLAIM_LOCKED_TEXT,
  canClaim,
  claimAction,
  claimLocked,
  claimOutcome,
  claimClockText,
  claimExpired,
  claimOffText,
  claimSecondsLeft,
  claimSeatOf,
  claimText,
  claimWaitingFor,
  tricksLeft,
} from '@/utils/claim'
import { STALE_GRACE_MS, useStaleDeadline } from '@/composables/useStaleDeadline'
import { handToPlay } from '@/utils/play'
import { resultSummary } from '@/utils/result'
import { showToast } from '@/utils/toast'

// The board chat has its own specs: its read never answers here.
vi.mock('@/services/chat', () => ({ getMessages: () => new Promise(() => {}), sendMessage: () => new Promise(() => {}) }))
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
    claim_locked: false,
    result: null,
    deal: null,
    ready: null,
    my_seat: 'S',
    hand: SOUTH,
    ...overrides,
  }
}

// Fixtures without a deadline (`expires_at: ''`) read as before bb#96: no
// countdown. The deadline tests below pass one from `inSeconds`.
function pending(overrides: Partial<Claim> = {}): Claim {
  return { seat: 'S', tricks: 4, hand: SOUTH, accepted: [], expires_at: '', ...overrides }
}

// The time the deadline tests run at, and a deadline `s` seconds after it.
const NOW = Date.parse('2026-10-04T12:00:00Z')
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString()

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

describe('claim outcomes (the claim sheet)', () => {
  test("declarer's side: the contract's result and N-S's score per number claimed", () => {
    expect(claimOutcome(state(), 'S', 5)).toEqual({ result: '4♠ +3', down: false, score: '+510' })
    expect(claimOutcome(state(), 'N', 2)).toEqual({ result: '4♠ =', down: false, score: '+420' })
    expect(claimOutcome(state(), 'S', 0)).toEqual({ result: '4♠ −2', down: true, score: '−100' })
  })

  test("a defender's claim: what declarer then takes, from the defenders' side", () => {
    const won = state({ tricks_won: { ns: 6, ew: 2 } })
    expect(claimOutcome(won, 'W', 5)).toEqual({ result: '4♠ −4', down: true, score: '+200' })
    expect(claimOutcome(won, 'E', 0)).toEqual({ result: '4♠ +1', down: false, score: '−450' })
  })

  test('redoubled and vulnerable, and no tricks counted yet', () => {
    const xx = state({
      board: { id: 7, number: 7, dealer: 'N', vulnerable: 'N-S E-W' },
      contract: { bid: FOUR_SPADES, doubled: 2, declarer: 'S', dummy: 'N' },
      tricks_won: null,
    })
    expect(claimOutcome(xx, 'S', 5)).toEqual({ result: '4♠XX −5', down: true, score: '−2800' })
  })

  test('without a contract there is nothing to work out', () => {
    expect(claimOutcome(state({ contract: null }), 'S', 3)).toBeNull()
  })
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

  test('after a refused claim nobody claims until the next card', () => {
    const s = state({ claim_locked: true })

    expect(canClaim(s, 'S')).toBe(false)
    expect(canClaim(s, 'E')).toBe(false)
    expect(canClaim(forRobot({ claim_locked: true }), 'N')).toBe(false)
    // Locked, for those who would claim otherwise: the note goes to them.
    expect(claimLocked(s, 'S')).toBe(true)
    expect(claimLocked(s, 'W')).toBe(true)
    expect(claimLocked(s, 'N')).toBe(false)
    expect(claimLocked(s, null)).toBe(false)
    expect(claimLocked(state({ claim_locked: true, phase: 'finished' }), 'S')).toBe(false)
    expect(claimLocked(state(), 'S')).toBe(false)
    expect(CLAIM_LOCKED_TEXT).toBe('The claim was refused: play a card before claiming again.')
  })

  test('both answerers answer at once: nobody waits for the other', () => {
    const s = state({ claim: pending() })

    expect(claimAction(s, 'E')).toBe('answer')
    expect(claimAction(s, 'W')).toBe('answer')
    expect(claimWaitingFor(s)).toEqual(['E', 'W'])
    // East accepting first leaves West's answer open, and the other way round.
    expect(claimAction(state({ claim: pending({ accepted: ['E'] }) }), 'W')).toBe('answer')
    expect(claimAction(state({ claim: pending({ accepted: ['W'] }) }), 'E')).toBe('answer')
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
    // The summary is the table notation; the panel's tricks line says "by claim".
    expect(resultSummary(RESULT, 'S')).toBe('4♠ S +2 · +480')
    expect(resultSummary({ ...RESULT, claimed: false }, 'S')).toBe('4♠ S +2 · +480')
  })

  test('the result panel says "by claim"', () => {
    const wrapper = mount(BoardResultPanel, { props: { result: RESULT, mySeat: 'S' } })

    expect(wrapper.get('.result-detail').text()).toBe('12 tricks · by claim')
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
  // The modal's own props land on the stub's root as attributes, so a
  // breakpoint would show there.
  const modalStub = { name: 'IonModal', emits: ['didDismiss'], template: '<div class="modal-stub"><slot /></div>' }

  type SheetProps = {
    open?: boolean
    remaining: number
    busy?: boolean
    forSeat?: Seat | null
    state?: Playing | null
    seat?: Seat | null
  }
  const mountSheet = (props: SheetProps) =>
    mount(ClaimSheet, {
      props: { open: true, ...props },
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })

  const picks = (wrapper: ReturnType<typeof mountSheet>) =>
    wrapper.findAll('.trick-pick .pick-count').map((b) => b.text())
  const picked = (wrapper: ReturnType<typeof mountSheet>) =>
    wrapper.findAll('.trick-pick.picked .pick-count').map((b) => b.text())
  const isDisabled = (el: { element: Element }) => (el.element as HTMLButtonElement).disabled

  test('one tile per number, from all the tricks left down to 0, all of them picked to start with', async () => {
    const wrapper = mountSheet({ remaining: 6 })

    expect(picks(wrapper)).toEqual(['6', '5', '4', '3', '2', '1', '0'])
    expect(picked(wrapper)).toEqual(['6'])
    expect(wrapper.get('[data-tricks="6"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-tricks="5"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('.send-claim').text()).toBe('Claim 6')

    // One tap claims them all.
    await wrapper.get('.send-claim').trigger('click')
    expect(wrapper.emitted('claim')).toEqual([[6]])
  })

  test('with 1 trick left the send button reads "Claim 1"', () => {
    const wrapper = mountSheet({ remaining: 1 })
    expect(wrapper.get('.send-claim').text()).toBe('Claim 1')
  })

  test('with no trick left there is nothing to claim', () => {
    const wrapper = mountSheet({ remaining: 0 })

    expect(picks(wrapper)).toEqual([])
    expect(isDisabled(wrapper.get('.send-claim'))).toBe(true)
  })

  test('with 13 tricks left there are 14 tiles, with 1 left two', () => {
    expect(picks(mountSheet({ remaining: 13 }))).toHaveLength(14)
    expect(picks(mountSheet({ remaining: 1 }))).toEqual(['1', '0'])
  })

  test('a pick only selects; the send button then claims that number', async () => {
    const wrapper = mountSheet({ remaining: 6 })

    await wrapper.get('[data-tricks="4"]').trigger('click')
    expect(wrapper.emitted('claim')).toBeUndefined()
    expect(picked(wrapper)).toEqual(['4'])
    expect(wrapper.get('.send-claim').text()).toBe('Claim 4')

    // Changing the pick is one more tap.
    await wrapper.get('[data-tricks="1"]').trigger('click')
    expect(picked(wrapper)).toEqual(['1'])
    expect(wrapper.get('.send-claim').text()).toBe('Claim 1')

    await wrapper.get('[data-tricks="4"]').trigger('click')
    await wrapper.get('.send-claim').trigger('click')
    expect(wrapper.emitted('claim')).toEqual([[4]])
  })

  test('the 0 tile turns the send button into Concede', async () => {
    const wrapper = mountSheet({ remaining: 6 })

    await wrapper.get('[data-tricks="0"]').trigger('click')
    expect(wrapper.get('.send-claim').text()).toBe('Concede')
    await wrapper.get('.send-claim').trigger('click')
    expect(wrapper.emitted('claim')).toEqual([[0]])
  })

  test('one button only: no separate Concede, the 0 tile is the concede', () => {
    const wrapper = mountSheet({ remaining: 6 })

    expect(wrapper.find('.concede').exists()).toBe(false)
    expect(wrapper.findAll('ion-button').map((b) => b.classes())).toEqual([
      expect.arrayContaining(['claim-close']),
      expect.arrayContaining(['send-claim']),
    ])
  })

  test('a centred dialog: no sheet breakpoints, so no drag handle', () => {
    const modal = mountSheet({ remaining: 5 }).get('.modal-stub')

    expect(modal.classes()).toContain('claim-dialog')
    expect(modal.attributes('breakpoints')).toBeUndefined()
    expect(modal.attributes('initial-breakpoint')).toBeUndefined()
    expect(modal.attributes('aria-labelledby')).toBe('claim-dialog-title')
  })

  test('the X in the corner closes it, as does a dismiss (the backdrop, Escape)', async () => {
    const wrapper = mountSheet({ remaining: 5 })
    const close = wrapper.get('.claim-head .claim-close')

    expect(close.attributes('aria-label')).toBe('Close')
    await close.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('claim')).toBeUndefined()

    wrapper.findComponent({ name: 'IonModal' }).vm.$emit('didDismiss')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  test("the title says Claim, and names a robot declarer's seat claimed for", () => {
    expect(mountSheet({ remaining: 5 }).get('.claim-title').text()).toBe('Claim')
    expect(mountSheet({ remaining: 5, forSeat: 'N' }).get('.claim-title').text()).toBe('Claim for North')
  })

  test('no explanatory text: no summary, no hand shown line, no answer rule', () => {
    const wrapper = mountSheet({ remaining: 5, state: state(), seat: 'S' })
    const text = wrapper.text()

    expect(wrapper.find('.claim-summary').exists()).toBe(false)
    expect(wrapper.find('.claim-help').exists()).toBe(false)
    expect(wrapper.find('.claim-deadline').exists()).toBe(false)
    expect(text).not.toContain('tricks left')
    expect(text).not.toContain('is shown to everyone')
    expect(text).not.toContain('seconds')
  })

  test('busy disables the tiles and the send button, never the X', () => {
    const wrapper = mountSheet({ remaining: 3, busy: true })

    for (const b of [wrapper.get('.send-claim'), ...wrapper.findAll('.trick-pick')]) {
      expect(isDisabled(b)).toBe(true)
    }
    expect(isDisabled(wrapper.get('.claim-close'))).toBe(false)
    expect(wrapper.find('.send-claim ion-spinner').exists()).toBe(true)
  })

  test('reopening the sheet picks every remaining trick again', async () => {
    const wrapper = mountSheet({ remaining: 6 })
    await wrapper.get('[data-tricks="3"]').trigger('click')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(picked(wrapper)).toEqual(['6'])
    expect(wrapper.get('.send-claim').text()).toBe('Claim 6')
  })

  test('reopening after tricks were played picks the new maximum', async () => {
    const wrapper = mountSheet({ remaining: 6, open: false })

    await wrapper.setProps({ remaining: 4 })
    await wrapper.setProps({ open: true })

    expect(wrapper.get('.send-claim').text()).toBe('Claim 4')
  })

  test('a trick finishing with the default picked moves it to the new maximum', async () => {
    const wrapper = mountSheet({ remaining: 5 })

    await wrapper.setProps({ remaining: 4 })

    expect(picks(wrapper)).toEqual(['4', '3', '2', '1', '0'])
    expect(picked(wrapper)).toEqual(['4'])
    await wrapper.get('.send-claim').trigger('click')
    expect(wrapper.emitted('claim')).toEqual([[4]])
  })

  test('a trick finishing keeps a number picked by hand while it is still possible', async () => {
    const wrapper = mountSheet({ remaining: 5 })
    await wrapper.get('[data-tricks="3"]').trigger('click')

    await wrapper.setProps({ remaining: 4 })
    expect(wrapper.get('.send-claim').text()).toBe('Claim 3')

    await wrapper.setProps({ remaining: 3 })
    expect(wrapper.get('.send-claim').text()).toBe('Claim 3')

    // No longer possible: capped to the new maximum.
    await wrapper.setProps({ remaining: 2 })
    expect(picked(wrapper)).toEqual(['2'])
    await wrapper.get('.send-claim').trigger('click')
    expect(wrapper.emitted('claim')).toEqual([[2]])
  })

  test('the top number picked by hand is capped when a trick finishes', async () => {
    const wrapper = mountSheet({ remaining: 5 })
    await wrapper.get('[data-tricks="5"]').trigger('click')

    await wrapper.setProps({ remaining: 4 })

    expect(wrapper.get('.send-claim').text()).toBe('Claim 4')
  })

  describe('with the board: each number\'s result and score', () => {
    // 4♠ by South, nobody vulnerable: 8 tricks taken, 5 left.
    const tiles = (wrapper: ReturnType<typeof mountSheet>) =>
      wrapper.findAll('.trick-pick').map((t) => [
        t.get('.pick-count').text(),
        t.get('.pick-result').text(),
        t.get('.pick-score').text(),
        t.classes('down'),
      ])

    test("declarer's tiles: the contract's result, undertricks in red, and N-S's score", () => {
      const wrapper = mountSheet({ remaining: 5, state: state(), seat: 'S' })

      expect(tiles(wrapper)).toEqual([
        ['5', '4♠ +3', '+510', false],
        ['4', '4♠ +2', '+480', false],
        ['3', '4♠ +1', '+450', false],
        ['2', '4♠ =', '+420', false],
        ['1', '4♠ −1', '−50', true],
        ['0', '4♠ −2', '−100', true],
      ])
      expect(wrapper.get('.send-claim').text()).toBe('Claim 5 · 4♠ +3 · +510')
    })

    test('the send button follows the pick', async () => {
      const wrapper = mountSheet({ remaining: 5, state: state(), seat: 'S' })

      await wrapper.get('[data-tricks="1"]').trigger('click')
      expect(wrapper.get('.send-claim').text()).toBe('Claim 1 · 4♠ −1 · −50')
      await wrapper.get('[data-tricks="0"]').trigger('click')
      // The 0 tile carries the result and score; the button just concedes.
      expect(wrapper.get('.send-claim').text()).toBe('Concede')
      await wrapper.get('.send-claim').trigger('click')
      expect(wrapper.emitted('claim')).toEqual([[0]])
    })

    test("a defender's tiles: what declarer then makes, and E-W's score", () => {
      const vulnerable = state({ board: { id: 7, number: 7, dealer: 'N', vulnerable: 'N-S' }, contract: { bid: FOUR_SPADES, doubled: 1, declarer: 'S', dummy: 'N' } })
      const wrapper = mountSheet({ remaining: 5, state: vulnerable, seat: 'E' })

      expect(tiles(wrapper)[0]).toEqual(['5', '4♠X −2', '+500', true])
      expect(tiles(wrapper).at(-1)).toEqual(['0', '4♠X +3', '−1390', false])
      expect(wrapper.get('.send-claim').text()).toBe('Claim 5 · 4♠X −2 · +500')
    })
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

describe('claim deadline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('the seconds left count down to expires_at, and stop at 0', () => {
    const claim = pending({ expires_at: inSeconds(7) })

    expect(claimSecondsLeft(claim, NOW)).toBe(7)
    expect(claimSecondsLeft(claim, NOW + 6500)).toBe(1)
    expect(claimSecondsLeft(claim, NOW + 7000)).toBe(0)
    expect(claimSecondsLeft(claim, NOW + 9000)).toBe(0)
    expect(claimExpired(claim, NOW + 6999)).toBe(false)
    expect(claimExpired(claim, NOW + 7000)).toBe(true)
    // No deadline: no countdown, and never expired.
    expect(claimSecondsLeft(pending(), NOW)).toBeNull()
    expect(claimExpired(pending(), NOW)).toBe(false)
  })

  test("those to answer see their time, everyone else whom they're waiting for", () => {
    const s = state({ claim: pending({ expires_at: inSeconds(7) }) })

    expect(claimClockText(s, 'E', NOW)).toBe('Answer within 0:07')
    expect(claimClockText(s, 'W', NOW + 2000)).toBe('Answer within 0:05')
    expect(claimClockText(s, 'S', NOW)).toBe('Waiting for East and West · 0:07')
    expect(claimClockText(s, 'N', NOW)).toBe('Waiting for East and West · 0:07')
    expect(claimClockText(s, null, NOW)).toBe('Waiting for East and West · 0:07')

    // West has accepted: West waits for East like the rest.
    const half = state({ claim: pending({ accepted: ['W'], expires_at: inSeconds(7) }) })
    expect(claimClockText(half, 'W', NOW)).toBe('Waiting for East · 0:07')
    expect(claimClockText(half, 'E', NOW)).toBe('Answer within 0:07')
  })

  test('at 0 the time is up for everyone', () => {
    const s = state({ claim: pending({ expires_at: inSeconds(7) }) })

    expect(claimClockText(s, 'E', NOW + 7000)).toBe('Time is up: no answer counts as no.')
    expect(claimClockText(s, 'S', NOW + 8000)).toBe('Time is up: no answer counts as no.')
  })

  test('no clock without a claim, a deadline, or anybody left to answer', () => {
    expect(claimClockText(state(), 'S', NOW)).toBeNull()
    expect(claimClockText(state({ claim: pending() }), 'E', NOW)).toBeNull()
    expect(
      claimClockText(state({ claim: pending({ accepted: ['E', 'W'], expires_at: inSeconds(7) }) }), 'S', NOW),
    ).toBeNull()
  })

  test("a robot declarer's dummy answers on declarer's clock", () => {
    const s = forRobot({ claim: pending({ seat: 'E', tricks: 0, expires_at: inSeconds(9) }) })

    expect(claimClockText(s, claimSeatOf(s), NOW)).toBe('Answer within 0:09')
  })

  test('a claim gone after its deadline was silence; before it, a reject or a withdrawal', () => {
    const claim = pending({ expires_at: inSeconds(7) })

    expect(claimOffText(claim, NOW + 3000)).toBe("South's claim is off. Play on: no claim until the next card.")
    expect(claimOffText(claim, NOW + 7000)).toBe('Nobody answered: the claim is off. Play on: no claim until the next card.')
    expect(claimOffText(pending({ seat: 'E' }), NOW)).toBe("East's claim is off. Play on: no claim until the next card.")
  })

  test('the stale-claim timer fires the grace after the deadline, once per deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const deadline = ref<string | null>(inSeconds(10))
    const reload = vi.fn()
    const scope = effectScope()
    scope.run(() => useStaleDeadline(() => deadline.value, reload))

    vi.advanceTimersByTime(10_000 + STALE_GRACE_MS - 1)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(reload).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(reload).toHaveBeenCalledTimes(1)

    // A deadline already behind us (a reload long after it) fires at once.
    deadline.value = inSeconds(-30)
    await nextTick()
    vi.advanceTimersByTime(0)
    expect(reload).toHaveBeenCalledTimes(2)

    // The claim going away, an unreadable deadline or the scope ending drops it.
    deadline.value = inSeconds(100)
    await nextTick()
    deadline.value = null
    await nextTick()
    deadline.value = 'not a date'
    await nextTick()
    deadline.value = inSeconds(200)
    await nextTick()
    scope.stop()
    vi.advanceTimersByTime(1_000_000)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  describe('ClaimPanel', () => {
    const isDisabled = (el: { element: Element }) => (el.element as HTMLButtonElement).disabled
    const panel = (s: Playing, mySeat: Seat) =>
      mount(ClaimPanel, { props: { state: s as Playing & { claim: Claim }, mySeat, players: PLAYERS } })

    test('the countdown ticks for those to answer, and their buttons go at 0', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const wrapper = panel(asSeat('E', { claim: pending({ expires_at: inSeconds(7) }) }), 'E')

      expect(wrapper.get('.claim-clock').text()).toBe('Answer within 0:07')
      // The countdown on the right of the banner.
      expect(wrapper.get('.claim-head .claim-seconds').text()).toBe('0:07')
      expect(isDisabled(wrapper.get('.accept'))).toBe(false)
      expect(isDisabled(wrapper.get('.reject'))).toBe(false)

      vi.advanceTimersByTime(2000)
      await nextTick()
      expect(wrapper.get('.claim-clock').text()).toBe('Answer within 0:05')
      expect(wrapper.get('.claim-seconds').text()).toBe('0:05')

      vi.advanceTimersByTime(5000)
      await nextTick()
      expect(wrapper.get('.claim-clock').text()).toBe('Time is up: no answer counts as no.')
      expect(isDisabled(wrapper.get('.accept'))).toBe(true)
      expect(isDisabled(wrapper.get('.reject'))).toBe(true)
    })

    test('the claimer sees whom they wait for, and Withdraw goes at 0', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const wrapper = panel(state({ claim: pending({ expires_at: inSeconds(7) }) }), 'S')

      expect(wrapper.get('.claim-clock').text()).toBe('Waiting for East and West · 0:07')
      expect(isDisabled(wrapper.get('.withdraw'))).toBe(false)

      vi.advanceTimersByTime(7000)
      await nextTick()
      expect(isDisabled(wrapper.get('.withdraw'))).toBe(true)
    })

    test('both answerers get Accept and Reject at once, the claimer waits for both', () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const claim = pending({ expires_at: inSeconds(7) })
      const east = panel(asSeat('E', { claim }), 'E')
      const west = panel(asSeat('W', { claim }), 'W')
      const south = panel(state({ claim }), 'S')

      for (const wrapper of [east, west]) {
        expect(wrapper.findAll('.claim-buttons ion-button').map((b) => b.text())).toEqual(['Accept', 'Reject'])
        expect(isDisabled(wrapper.get('.accept'))).toBe(false)
        expect(wrapper.get('.claim-clock').text()).toBe('Answer within 0:07')
      }
      expect(south.get('.claim-clock').text()).toBe('Waiting for East and West · 0:07')
    })

    test('one answer in, the other still answers', async () => {
      const wrapper = panel(asSeat('W', { claim: pending({ accepted: ['E'] }) }), 'W')

      expect(wrapper.get('[data-seat="E"]').classes()).toContain('is-accepted')
      await wrapper.get('.reject').trigger('click')
      expect(wrapper.emitted('reject')).toHaveLength(1)
    })

    test('without a deadline it reads as before, and the buttons stay', () => {
      const wrapper = panel(asSeat('E', { claim: pending() }), 'E')

      expect(wrapper.find('.claim-clock').exists()).toBe(false)
      expect(wrapper.find('.claim-seconds').exists()).toBe(false)
      expect(wrapper.get('.claim-detail').text()).toBe('Play stops until you and W answer.')
      expect(isDisabled(wrapper.get('.accept'))).toBe(false)
    })
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

    // Claim: small, in the table's bottom-right corner; nothing under the hand.
    expect(wrapper.get('.bridge-table .corner-bottom-right .claim-button').text()).toBe('Claim')
    expect(wrapper.find('.claim-row').exists()).toBe(false)
    await wrapper.get('.claim-button').trigger('click')
    expect(wrapper.findAll('.trick-pick .pick-count').map((b) => b.text())).toEqual(['5', '4', '3', '2', '1', '0'])
    expect(wrapper.get('.send-claim').text()).toBe('Claim 5 · 4♠ +3 · +510')
    await wrapper.get('[data-tricks="4"]').trigger('click')
    expect(wrapper.get('.send-claim').text()).toBe('Claim 4 · 4♠ +2 · +480')
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

  test('a defender concedes with the 0 tile', async () => {
    logIn(2)
    const wrapper = await mountPage(asSeat('E', { turn: 'S', acting_user_id: 3 }))
    vi.mocked(gameService.makeClaim).mockResolvedValue(asSeat('E', { claim: pending({ seat: 'E', tricks: 0 }) }))

    await wrapper.get('.claim-button').trigger('click')
    await wrapper.get('[data-tricks="0"]').trigger('click')
    expect(wrapper.get('.send-claim').text()).toBe('Concede')
    await wrapper.get('.send-claim').trigger('click')
    await flushPromises()

    expect(gameService.makeClaim).toHaveBeenCalledWith(5, 0)
    expect(wrapper.get('.claim-text').text()).toBe('You concede the remaining 5 tricks')
  })

  test('the turn line stays, empty, while a claim is pending', async () => {
    const wrapper = await mountPage(state())
    expect(wrapper.get('.turn-line-text').text()).toBe('Your lead')
    expect(wrapper.get('.turn-line').classes()).toContain('turn-line-mine')

    useGameStore().applyPlayingUpdate(5, { ...state({ claim: pending() }) })
    await flushPromises()

    expect(wrapper.get('.claim-text').text()).toBe('You claim 4 of the remaining 5 tricks')
    expect(wrapper.get('.turn-line-text').text()).toBe('')
    expect(wrapper.get('.turn-line').classes()).not.toContain('turn-line-mine')
    expect(wrapper.find('.turn-line-time').exists()).toBe(false)
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
    expect(showToast).toHaveBeenCalledWith("South's claim is off. Play on: no claim until the next card.", 'warning')
    expect(wrapper.find('.claim').exists()).toBe(false)
    expect(wrapper.findAll('.my-hand button[data-card]').length).toBeGreaterThan(0)
  })

  test('the last accept, seen live, shows the result by claim to everyone', async () => {
    const wrapper = await mountPage(state({ claim: pending({ accepted: ['W'] }) }))

    useGameStore().applyPlayingUpdate(5, { ...state({ phase: 'finished', turn: null, acting_user_id: null, result: RESULT, ready: [] }) })
    await flushPromises()

    expect(wrapper.get('.result-detail').text()).toContain('by claim')
    expect(showToast).toHaveBeenCalledWith('Board over: 4♠ S +2 · +480.', 'success')
  })

  test("a robot declarer's dummy claims for declarer from the sheet", async () => {
    const wrapper = await mountPage(forRobot())
    vi.mocked(gameService.makeClaim).mockResolvedValue(forRobot({ claim: pending({ seat: 'N', hand: NORTH }) }))

    await wrapper.get('.claim-button').trigger('click')
    expect(wrapper.get('.claim-title').text()).toBe('Claim for North')
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

  test('after a refused claim, Claim stays locked, saying why when tapped, until the next card', async () => {
    logIn(4)
    const wrapper = await mountPage(asSeat('W', { turn: 'W', acting_user_id: 4, claim: pending() }))
    vi.mocked(gameService.respondToClaim).mockResolvedValue(
      asSeat('W', { turn: 'W', acting_user_id: 4, claim_locked: true }),
    )

    await wrapper.get('.reject').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith(
      "South's claim is off. Play on: no claim until the next card.",
      'warning',
    )
    const claimButton = wrapper.get('.claim-button')
    expect(claimButton.attributes('aria-disabled')).toBe('true')
    expect(claimButton.classes()).toContain('is-locked')
    expect(claimButton.text()).toBe('Claim · locked')
    // The note is the button's description, shown in a pop-up on a tap.
    const note = wrapper.get('.claim-locked-note')
    expect(note.text()).toBe('The claim was refused: play a card before claiming again.')
    expect(claimButton.attributes('aria-describedby')).toBe(note.attributes('id'))
    const shown = () => !(wrapper.get('.claim-locked-note').element as HTMLElement).style.display
    expect(shown()).toBe(false)
    await claimButton.trigger('click')
    expect(wrapper.findComponent(ClaimSheet).props('open')).toBe(false)
    expect(shown()).toBe(true)
    expect(claimButton.attributes('aria-expanded')).toBe('true')

    // West's card clears the lock: Claim is back.
    const played = { seat: 'W' as Seat, card: c('HA') }
    useGameStore().applyPlayingUpdate(5, {
      ...asSeat('W', { turn: 'N', acting_user_id: 3, current_trick: [played], claim_locked: false }),
    })
    await flushPromises()
    expect(wrapper.find('.claim-locked-note').exists()).toBe(false)
    expect((wrapper.get('.claim-button').element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.get('.claim-button').attributes('aria-disabled')).toBeUndefined()
    expect(wrapper.get('.claim-button').text()).toBe('Claim')
  })

  test('a claim lock arriving while the sheet is open closes it', async () => {
    const wrapper = await mountPage(state())

    await wrapper.get('.claim-button').trigger('click')
    expect(wrapper.findComponent(ClaimSheet).props('open')).toBe(true)

    useGameStore().applyPlayingUpdate(5, { ...state({ claim_locked: true }) })
    await flushPromises()

    expect(wrapper.findComponent(ClaimSheet).props('open')).toBe(false)
    expect(wrapper.find('.claim-locked-note').exists()).toBe(true)
  })

  test('dummy gets no note while claims are locked', async () => {
    logIn(1)
    const wrapper = await mountPage(state({ my_seat: 'N', hand: NORTH, claim_locked: true }))

    expect(wrapper.find('.claim-button').exists()).toBe(false)
    expect(wrapper.find('.claim-locked-note').exists()).toBe(false)
  })

  test('a 409 for a locked claim toasts its reason and rereads the board', async () => {
    const wrapper = await mountPage(state())
    vi.mocked(gameService.makeClaim).mockRejectedValue(refused('A claim was just refused: play a card first.'))
    vi.mocked(gameService.getPlaying).mockResolvedValue(state({ claim_locked: true }))

    await wrapper.get('.claim-button').trigger('click')
    await wrapper.get('[data-tricks="0"]').trigger('click')
    await wrapper.get('.send-claim').trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('A claim was just refused: play a card first.', 'danger')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.claim-locked-note').exists()).toBe(true)
  })

  describe('the deadline', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    test('runs on the page, and a claim cleared after it is told as nobody answering', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      logIn(2)
      const wrapper = await mountPage(asSeat('E', { claim: pending({ expires_at: inSeconds(10) }) }))

      expect(wrapper.get('.claim-clock').text()).toBe('Answer within 0:10')
      vi.advanceTimersByTime(10_000)
      await flushPromises()
      expect(wrapper.get('.claim-clock').text()).toBe('Time is up: no answer counts as no.')
      expect((wrapper.get('.accept').element as HTMLButtonElement).disabled).toBe(true)

      // The backend's update arrives in time: no reread.
      useGameStore().applyPlayingUpdate(5, { ...asSeat('E') })
      await flushPromises()
      expect(showToast).toHaveBeenCalledWith('Nobody answered: the claim is off. Play on: no claim until the next card.', 'warning')
      expect(wrapper.find('.claim').exists()).toBe(false)
      vi.advanceTimersByTime(STALE_GRACE_MS)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(1)
    })

    test('with no update 2 s after the deadline, the page rereads the game', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      logIn(2)
      const wrapper = await mountPage(asSeat('E', { claim: pending({ expires_at: inSeconds(10) }) }))
      vi.mocked(gameService.getPlaying).mockResolvedValue(asSeat('E'))

      vi.advanceTimersByTime(10_000 + STALE_GRACE_MS - 1)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
      expect(gameService.getPlaying).toHaveBeenLastCalledWith(5)
      expect(wrapper.find('.claim').exists()).toBe(false)
      expect(showToast).toHaveBeenCalledWith('Nobody answered: the claim is off. Play on: no claim until the next card.', 'warning')
    })

    test('a reread that fails leaves the claim for the next update', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      const wrapper = await mountPage(state({ claim: pending({ expires_at: inSeconds(10) }) }))
      vi.mocked(gameService.getPlaying).mockRejectedValue(new Error('offline'))

      vi.advanceTimersByTime(10_000 + STALE_GRACE_MS)
      await flushPromises()

      expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
      expect(wrapper.get('.claim-clock').text()).toBe('Time is up: no answer counts as no.')
    })

    test('a claim rejected in time keeps the reject wording and drops the reread', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
      logIn(4)
      const wrapper = await mountPage(
        asSeat('W', { turn: 'W', acting_user_id: 4, claim: pending({ expires_at: inSeconds(10) }) }),
      )
      vi.mocked(gameService.respondToClaim).mockResolvedValue(asSeat('W', { turn: 'W', acting_user_id: 4 }))

      vi.advanceTimersByTime(3000)
      await wrapper.get('.reject').trigger('click')
      await flushPromises()
      expect(showToast).toHaveBeenCalledWith("South's claim is off. Play on: no claim until the next card.", 'warning')

      vi.advanceTimersByTime(15_000)
      await flushPromises()
      expect(gameService.getPlaying).toHaveBeenCalledTimes(1)
    })
  })
})
