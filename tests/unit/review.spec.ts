import { AxiosError, AxiosHeaders } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import http from '@/services/http'
import { getPlayingReview } from '@/services/history'
import type { PlayingReview } from '@/services/history'
import type { Bid, Card, PlayedCard, Suit } from '@/services/game'
import type { Seat } from '@/services/tables'
import type { PublicUser } from '@/services/users'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import {
  isRecorded,
  nextTrickStep,
  playedCards,
  previousTrickStep,
  reviewAt,
  stepCaption,
} from '@/utils/review'
import PlayingReviewPage from '@/views/PlayingReviewPage.vue'
import BoardResultsPage from '@/views/BoardResultsPage.vue'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn() },
}))

const route = { params: { id: '42' } as Record<string, string> }
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

const RANKS = [15, 14, 13, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2]
const card = (suit: Suit, rank: number): Card => ({
  id: 'SHDC'.indexOf(suit) * 20 + rank,
  suit,
  rank,
  rank_name: String(rank),
})
// One suit a hand, which is all the stepper cares about: N spades, E hearts,
// S diamonds, W clubs.
const hand = (suit: Suit) => RANKS.map((rank) => card(suit, rank))
const DEAL: Record<Seat, Card[]> = { N: hand('S'), E: hand('H'), S: hand('D'), W: hand('C') }

const played = (seat: Seat, suit: Suit, rank: number): PlayedCard => ({ seat, card: card(suit, rank) })
const bid = (id: number, call: string, level: number | null = null): Bid => ({
  id,
  call,
  level,
  strain: level ? (call.slice(1) as Bid['strain']) : null,
  special: level === null,
})
const pass = bid(1, 'P')
const fourSpades = bid(22, '4S', 4)

// 4♠ by North, East on lead: two tricks to North's trumps, then two cards of
// the third before North's claim is accepted.
function claimed(overrides: Partial<PlayingReview> = {}): PlayingReview {
  return {
    phase: 'finished',
    playing_id: 42,
    board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
    players: { N: ann, E: bo, S: cy, W: di },
    turn: null,
    acting_user_id: null,
    auction: [
      { seat: 'N', bid: fourSpades },
      { seat: 'E', bid: pass },
      { seat: 'S', bid: pass },
      { seat: 'W', bid: pass },
    ],
    contract: { bid: fourSpades, doubled: 0, declarer: 'N', dummy: 'S' },
    tricks: [
      {
        round: 1,
        leader: 'E',
        cards: [played('E', 'H', 15), played('S', 'D', 15), played('W', 'C', 15), played('N', 'S', 15)],
        winner: 'N',
      },
      {
        round: 2,
        leader: 'N',
        cards: [played('N', 'S', 14), played('E', 'H', 14), played('S', 'D', 14), played('W', 'C', 14)],
        winner: 'N',
      },
    ],
    current_trick: [played('N', 'S', 13), played('E', 'H', 13)],
    tricks_won: { ns: 2, ew: 0 },
    dummy_hand: DEAL.S.slice(2),
    claim: null,
    result: {
      contract: fourSpades,
      doubled: 0,
      declarer: 'N',
      tricks_won: 13,
      score_ns: 510,
      made_by: 3,
      claimed: true,
    },
    deal: DEAL,
    ...overrides,
  }
}

// Finished before the backend kept the calls and cards.
const unrecorded = () => claimed({ auction: [], tricks: [], current_trick: [] })

function answer(data: unknown) {
  vi.mocked(http.get).mockResolvedValueOnce({ data: { status: 200, message: 'OK', data } })
}

function loginAs(u: PublicUser) {
  useAuthStore().user = { ...u, email: `${u.username}@example.com` } as never
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  route.params = { id: '42' }
})

describe('review service', () => {
  test('getPlayingReview unwraps the envelope', async () => {
    answer(claimed())

    await expect(getPlayingReview(42)).resolves.toEqual(claimed())
    expect(http.get).toHaveBeenCalledWith('/playings/42')
  })

  test("rejects with the 403 for a board you haven't finished", async () => {
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403, { message: 'This action is unauthorized.' }))

    await expect(getPlayingReview(42)).rejects.toMatchObject({ response: { status: 403 } })
  })
})

describe('review store', () => {
  test('loadReview caches a playing by id and serves it from there', async () => {
    answer(claimed())
    const store = useHistoryStore()

    await store.loadReview(42)
    await expect(store.loadReview(42)).resolves.toEqual(claimed())

    expect(http.get).toHaveBeenCalledTimes(1)
    expect(store.reviews[42]).toEqual(claimed())
  })

  test('a failed load caches nothing', async () => {
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(404, { message: 'Not Found' }))
    const store = useHistoryStore()

    await expect(store.loadReview(42)).rejects.toMatchObject({ response: { status: 404 } })
    expect(store.reviews[42]).toBeUndefined()
  })

  test('clear forgets the reviews too (on logout)', async () => {
    answer(claimed())
    const store = useHistoryStore()
    await store.loadReview(42)

    store.clear()

    expect(store.reviews).toEqual({})
  })
})

describe('review stepper', () => {
  test('playedCards is every trick in order, then the one a claim stopped', () => {
    const cards = playedCards(claimed())
    expect(cards).toHaveLength(10)
    expect(cards[0]).toEqual(played('E', 'H', 15))
    expect(cards[9]).toEqual(played('E', 'H', 13))
    expect(playedCards(claimed({ contract: null, tricks: null, current_trick: null }))).toEqual([])
  })

  test('isRecorded is false only for an empty auction', () => {
    expect(isRecorded(claimed())).toBe(true)
    expect(isRecorded(unrecorded())).toBe(false)
  })

  test('before the opening lead: full hands, an empty trick, the leader next', () => {
    const at = reviewAt(claimed(), 0)

    expect(Object.values(at.hands).map((h) => h.length)).toEqual([13, 13, 13, 13])
    expect(at).toMatchObject({ trick: [], winner: null, trickNumber: null, next: 'E' })
    expect(at.tricksWon).toEqual({ ns: 0, ew: 0 })
    expect(stepCaption(at)).toBe('E to lead')
  })

  test('mid-trick: the cards so far, gone from their hands, no winner yet', () => {
    const at = reviewAt(claimed(), 2)

    expect(at.trick).toEqual([played('E', 'H', 15), played('S', 'D', 15)])
    expect(at.hands.E).toHaveLength(12)
    expect(at.hands.E.some((c) => c.id === card('H', 15).id)).toBe(false)
    expect(at.hands.S).toHaveLength(12)
    expect(at.hands.W).toHaveLength(13)
    expect(at).toMatchObject({ winner: null, trickNumber: 1, next: 'W' })
    expect(at.tricksWon).toEqual({ ns: 0, ew: 0 })
    expect(stepCaption(at)).toBe('W to play')
  })

  test("a trick's fourth card: its winner, and the side's trick counted", () => {
    const at = reviewAt(claimed(), 4)

    expect(at.trick).toHaveLength(4)
    expect(at).toMatchObject({ winner: 'N', trickNumber: 1, next: 'N' })
    expect(at.tricksWon).toEqual({ ns: 1, ew: 0 })
    expect(stepCaption(at)).toBe('N wins')
  })

  test('the last step: the trick the claim stopped, nothing next', () => {
    const at = reviewAt(claimed(), 10)

    expect(at.trick).toEqual([played('N', 'S', 13), played('E', 'H', 13)])
    expect(at).toMatchObject({ winner: null, trickNumber: 3, next: null })
    expect(at.tricksWon).toEqual({ ns: 2, ew: 0 })
    expect(at.hands.N).toHaveLength(10)
    expect(at.hands.E).toHaveLength(10)
    expect(at.hands.S).toHaveLength(11)
    expect(stepCaption(at)).toBe('Claimed')
  })

  test('a step past either end is clamped', () => {
    expect(reviewAt(claimed(), 99).step).toBe(10)
    expect(reviewAt(claimed(), -3).step).toBe(0)
  })

  test('nextTrickStep ends the trick in progress, or the next one, never past the last card', () => {
    expect(nextTrickStep(0, 10)).toBe(4)
    expect(nextTrickStep(2, 10)).toBe(4)
    expect(nextTrickStep(4, 10)).toBe(8)
    expect(nextTrickStep(8, 10)).toBe(10)
    expect(nextTrickStep(10, 10)).toBe(10)
  })

  test('previousTrickStep goes back to the previous complete trick, then the start', () => {
    expect(previousTrickStep(10)).toBe(8)
    expect(previousTrickStep(8)).toBe(4)
    expect(previousTrickStep(6)).toBe(4)
    expect(previousTrickStep(4)).toBe(0)
    expect(previousTrickStep(1)).toBe(0)
    expect(previousTrickStep(0)).toBe(0)
  })
})

function control(wrapper: VueWrapper, label: string) {
  return wrapper.get(`[aria-label="${label}"]`)
}

describe('PlayingReviewPage', () => {
  test("the title is the board's place in its set, never its number", async () => {
    loginAs(bo)
    answer(claimed({ set: { id: 5, number: 3, board: 2, of: 4 }, board: { id: 137, number: 137, dealer: 'N', vulnerable: '' } }))

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    expect(wrapper.find('ion-title').text()).toBe('Board 2 of 4 review')
    expect(wrapper.text()).not.toContain('137')
  })

  test('without a set (or from a backend before bb#146) the title is plain Board review', async () => {
    loginAs(bo)
    answer(claimed({ set: null }))
    let wrapper = mount(PlayingReviewPage)
    await flushPromises()
    expect(wrapper.find('ion-title').text()).toBe('Board review')
    wrapper.unmount()

    answer(claimed())
    wrapper = mount(PlayingReviewPage)
    await flushPromises()
    expect(wrapper.find('ion-title').text()).toBe('Board review')
  })

  test('steps through the play, with the result at the end', async () => {
    loginAs(bo)
    answer(claimed())

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/playings/42')
    // bo sat East, so East is at the bottom.
    expect(wrapper.find('.side-bottom').attributes('data-seat')).toBe('E')
    expect(wrapper.find('.position').text()).toBe('Before the opening lead')
    expect(wrapper.find('.tricks-won').text()).toContain('NS 0')
    expect(wrapper.findComponent({ name: 'BoardResultPanel' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'AuctionHistory' }).exists()).toBe(true)

    await control(wrapper, 'Next trick').trigger('click')
    expect(wrapper.find('.position').text()).toBe('Trick 1 of 3 · card 4 of 4')
    expect(wrapper.find('.tricks-won').text()).toContain('NS 1')
    expect(wrapper.find('.trick-caption').text()).toBe('N wins')

    await control(wrapper, 'Next card').trigger('click')
    expect(wrapper.find('.position').text()).toBe('Trick 2 of 3 · card 1 of 4')

    await control(wrapper, 'End of the play').trigger('click')
    expect(wrapper.find('.position').text()).toBe('Trick 3 of 3 · card 2 of 4 · the rest by claim')
    expect(wrapper.findComponent({ name: 'BoardResultPanel' }).exists()).toBe(true)

    await control(wrapper, 'Before the opening lead').trigger('click')
    expect(wrapper.find('.position').text()).toBe('Before the opening lead')
  })

  test('the hands keep their dealt height at every step', async () => {
    loginAs(bo)
    answer(claimed())

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    // Each hand is one 13-card suit, so every column keeps 13 lines (ranks,
    // a void's dash or hidden blanks) from the deal to the claim.
    const lines = () =>
      wrapper
        .findAll('.dealt-hand .column')
        .map((column) => column.findAll('.rank, .void').length)
    expect(lines()).toEqual(Array(16).fill(13))

    await control(wrapper, 'Next trick').trigger('click')
    // North's spades are one card down after the first trick.
    const north = wrapper.get('.dealt-hand[aria-label^="North"] .column')
    expect(north.findAll('.filler')).toHaveLength(1)
    expect(lines()).toEqual(Array(16).fill(13))

    await control(wrapper, 'End of the play').trigger('click')
    expect(lines()).toEqual(Array(16).fill(13))
  })

  test('someone who sat elsewhere sees South at the bottom', async () => {
    loginAs(user(9, 'ed'))
    answer(claimed())

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    expect(wrapper.find('.side-bottom').attributes('data-seat')).toBe('S')
    expect(wrapper.find('.seat-you').exists()).toBe(false)
  })

  test('an unrecorded playing shows only the deal and the result', async () => {
    loginAs(bo)
    answer(unrecorded())

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    expect(wrapper.find('.unrecorded').text()).toBe(
      "The auction and play of this board weren't recorded.",
    )
    expect(wrapper.find('.stepper').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'AuctionHistory' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'BoardResultPanel' }).exists()).toBe(true)
    expect(wrapper.findAll('.dealt-hand')).toHaveLength(4)
    // Nothing to step through, so nothing to keep room for.
    expect(wrapper.find('.dealt-hand .filler').exists()).toBe(false)
    // No set: the centre has no board line, and never the board's number.
    expect(wrapper.find('.board-number').exists()).toBe(false)
  })

  test("an unrecorded playing's centre names the board by its place in the set", async () => {
    loginAs(bo)
    answer({ ...unrecorded(), set: { id: 5, number: 3, board: 2, of: 4 } })

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    expect(wrapper.get('.board-number').text()).toBe('Board 2 of 4')
  })

  test('links back to the board results', async () => {
    loginAs(bo)
    answer(claimed())

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    const link = wrapper
      .findAllComponents({ name: 'IonButton' })
      .find((b) => b.classes('results-link'))
    expect(link?.props('routerLink')).toBe('/boards/7/results')
  })

  test("explains the 403 for a board you haven't finished", async () => {
    loginAs(bo)
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(403, { message: 'This action is unauthorized.' }))

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    expect(wrapper.find('.gone').text()).toContain('once you have finished it yourself')
  })

  test('a 404 says the board is unknown or unfinished', async () => {
    loginAs(bo)
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(404, { message: 'Not Found' }))

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    expect(wrapper.find('.gone').text()).toContain("doesn't exist or isn't finished yet")
  })

  test('a bad id asks for nothing', async () => {
    loginAs(bo)
    route.params = { id: 'abc' }

    const wrapper = mount(PlayingReviewPage)
    await flushPromises()

    expect(http.get).not.toHaveBeenCalled()
    expect(wrapper.find('.gone').text()).toContain("doesn't exist")
  })
})

describe('BoardResultsPage rows', () => {
  test("each row opens that table's replay", async () => {
    loginAs(bo)
    route.params = { id: '7' }
    answer({
      board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
      top: 0,
      results: [
        {
          playing_id: 42,
          table_id: null,
          players: { N: ann, E: bo, S: cy, W: di },
          contract: fourSpades,
          doubled: 0,
          declarer: 'N',
          tricks_won: 13,
          score_ns: 510,
          made_by: 3,
          matchpoints: { ns: 0, ew: 0 },
          finished_at: '2026-09-29T12:00:00.000000Z',
        },
      ],
    })

    const wrapper = mount(BoardResultsPage)
    await flushPromises()

    const row = wrapper.findAllComponents({ name: 'IonItem' }).find((i) => i.classes('result-item'))
    expect(row?.props('routerLink')).toBe('/playings/42')
  })
})
