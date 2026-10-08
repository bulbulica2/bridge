import { readFileSync } from 'fs'
import { resolve } from 'path'
import { AxiosError, AxiosHeaders } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { IonActionSheet, IonSegment } from '@ionic/vue'
import { pickSegment } from './ionEvents'
import http from '@/services/http'
import type { PlayingHistoryEntry, PlayingReview, SetBoardRow, SetResults } from '@/services/history'
import type { Bid, Card, PlayedCard, Playing, Suit } from '@/services/game'
import type { BroadcastTable, Seat } from '@/services/tables'
import type { PublicUser } from '@/services/users'
import BoardReview from '@/components/BoardReview.vue'
import BoardReviewModal from '@/components/BoardReviewModal.vue'
import { useBoardExport } from '@/composables/useBoardExport'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import { reviewChoices } from '@/utils/review'
import { turnNotice } from '@/utils/turn'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn() },
}))
const toast = vi.fn()
vi.mock('@/utils/toast', () => ({ showToast: (...args: unknown[]) => toast(...args) }))

function axiosError(status: number, message: string): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message }, statusText: '', headers: {}, config }
  return error
}

function user(id: number, username: string, robot = false): PublicUser {
  return { id, name: username.toUpperCase(), username, description: null, is_robot: robot }
}

const ann = user(1, 'ann')
const bo = user(2, 'bo')
const cy = user(3, 'cy')
const di = user(4, 'di')
const PLAYERS = { N: ann, E: bo, S: cy, W: di }

const RANKS = [15, 14, 13, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2]
const card = (suit: Suit, rank: number): Card => ({
  id: 'SHDC'.indexOf(suit) * 20 + rank,
  suit,
  rank,
  rank_name: String(rank),
})
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

// 4♠ by North: one trick played, then North's claim of the rest.
// `position` is its place in set 2 (null: outside any set).
function review(playingId = 42, number = 7, position: number | null = 2): PlayingReview {
  return {
    phase: 'finished',
    playing_id: playingId,
    set: position === null ? null : { id: 5, number: 2, board: position, of: 4 },
    board: { id: number, number, dealer: 'N', vulnerable: '' },
    players: PLAYERS,
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
    ],
    current_trick: [],
    tricks_won: { ns: 1, ew: 0 },
    dummy_hand: DEAL.S.slice(1),
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
  }
}

// The board's number in the database is far from its place in the set.
function boardRow(playingId: number, position: number): SetBoardRow {
  return {
    position,
    playing_id: playingId,
    board: { id: 130 + position, number: 130 + position, dealer: 'N', vulnerable: '' },
    contract: fourSpades,
    doubled: 0,
    declarer: 'N',
    tricks_won: 13,
    score_ns: 510,
    made_by: 3,
    claimed: true,
    top: 4,
    matchpoints: { ns: 3, ew: 1 },
  }
}

function setResults(boards: SetBoardRow[], id = 5): SetResults {
  return {
    id,
    number: 2,
    table_id: 9,
    of: 4,
    boards_dealt: boards.length,
    started_at: '2026-10-01T12:00:00Z',
    finished_at: null,
    finished: false,
    ended: null,
    replaced: [],
    players: PLAYERS,
    boards,
    totals: { score: { ns: 0, ew: 0 }, matchpoints: { ns: 0, ew: 0 }, top: 0 },
    winner: null,
  }
}

function historyEntry(
  playingId: number,
  tableId: number | null,
  number: number,
  position: number | null = null,
): PlayingHistoryEntry {
  return {
    playing_id: playingId,
    table_id: tableId,
    set: position === null ? null : { id: 5, number: 1, board: position, of: 4 },
    board: { id: number, number, dealer: 'N', vulnerable: '' },
    seat: 'E',
    partner: di,
    contract: fourSpades,
    doubled: 0,
    declarer: 'N',
    tricks_won: 10,
    score_ns: 420,
    made_by: 0,
    score: -420,
    finished_at: '2026-10-01T12:00:00Z',
  }
}

function answer(data: unknown) {
  vi.mocked(http.get).mockResolvedValueOnce({ data: { status: 200, message: 'OK', data } })
}

type Button = { text: string; handler?: () => unknown }
const press = (buttons: Button[], text: string) => buttons.find((b) => b.text === text)!.handler!()

const modalStub = { template: '<div class="modal-stub"><slot /></div>' }

// ion-segment scrolls its checked button into view; jsdom has no scrolling.
Element.prototype.scrollTo ??= () => {}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  useAuthStore().user = { ...bo, email: 'bo@example.com' } as never
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.classList.remove('printing-board')
})

describe('reviewChoices', () => {
  const seen = (playingId: number, position: number | null, setId: number | null) => ({ playingId, position, setId })

  test("the running set's finished boards, oldest first, by their place in the set", () => {
    const set = setResults([boardRow(41, 1), boardRow(42, 2)])
    expect(reviewChoices(set, null, null)).toEqual([
      { playingId: 41, position: 1 },
      { playingId: 42, position: 2 },
    ])
  })

  test('the board just seen to finish joins its set before the set is read again', () => {
    const set = setResults([boardRow(41, 1)])
    expect(reviewChoices(set, seen(42, 2, 5), null)).toEqual([
      { playingId: 41, position: 1 },
      { playingId: 42, position: 2 },
    ])
    // Already there: not twice.
    expect(reviewChoices(set, seen(41, 1, 5), null).map((c) => c.playingId)).toEqual([41])
  })

  test("a board seen in another set stays out of the running set's", () => {
    const set = setResults([boardRow(41, 1)])
    expect(reviewChoices(set, seen(38, 4, 4), null).map((c) => c.playingId)).toEqual([41])
  })

  test("on the next set's first board, the previous set's last board", () => {
    expect(reviewChoices(setResults([], 6), seen(44, 4, 5), null)).toEqual([{ playingId: 44, position: 4 }])
    expect(reviewChoices(null, seen(44, null, null), null)).toEqual([{ playingId: 44, position: null }])
  })

  test('after a reload, the latest history entry at the table: its place in its set, if any', () => {
    expect(reviewChoices(setResults([], 6), null, historyEntry(44, 9, 138, 3))).toEqual([
      { playingId: 44, position: 3 },
    ])
    expect(reviewChoices(null, null, historyEntry(44, 9, 138))).toEqual([{ playingId: 44, position: null }])
    expect(reviewChoices(null, null, null)).toEqual([])
  })
})

describe('turnNotice', () => {
  const base = {
    phase: 'auction',
    playing_id: 42,
    players: PLAYERS,
    turn: 'E',
    acting_user_id: 2,
    contract: null,
    claim: null,
    my_seat: 'E',
    ready: null,
  } as unknown as Playing
  const state = (overrides: Partial<Playing>) => ({ ...base, ...overrides }) as Playing
  const contract = { bid: fourSpades, doubled: 0 as const, declarer: 'N' as Seat, dummy: 'S' as Seat }

  function table(ready: boolean): BroadcastTable {
    return {
      id: 9,
      seats: [{ id: 1, table_id: 9, user_id: 2, seat: 'E', ready, user: bo }],
    } as unknown as BroadcastTable
  }

  test('a call to make', () => {
    expect(turnNotice(base, 2, null, false)).toBe('Your turn to bid')
    expect(turnNotice(state({ acting_user_id: 1 }), 2, null, false)).toBeNull()
  })

  test('a card to play, from any hand we play', () => {
    expect(turnNotice(state({ phase: 'play', contract }), 2, null, false)).toBe('Your turn to play')
    expect(turnNotice(state({ phase: 'play', contract, acting_user_id: 1, turn: 'N' }), 2, null, false)).toBeNull()
  })

  test('a claim to answer, not our own', () => {
    const claim = { seat: 'N' as Seat, tricks: 3, hand: [], accepted: [] }
    expect(turnNotice(state({ phase: 'play', contract, claim }), 2, null, false)).toBe(
      'A claim waits for your answer',
    )
    expect(
      turnNotice(state({ phase: 'play', contract, claim: { ...claim, accepted: ['E'] } }), 2, null, false),
    ).toBeNull()
  })

  test('nothing after a board: the next one is dealt by itself', () => {
    expect(turnNotice(state({ phase: 'finished', ready: [] }), 2, null, false)).toBeNull()
    expect(turnNotice(state({ phase: 'finished', ready: ['E'] }), 2, null, false)).toBeNull()
  })

  test('Start, until pressed', () => {
    expect(turnNotice(null, 2, table(false), true)).toBe('Your Start: the next board waits for you')
    expect(turnNotice(null, 2, table(true), true)).toBeNull()
    expect(turnNotice(null, 7, table(false), true)).toBeNull()
  })

  test('nothing while waiting, or for nobody', () => {
    expect(turnNotice(null, 2, null, false)).toBeNull()
    expect(turnNotice(base, null, null, false)).toBeNull()
    expect(turnNotice(state({ phase: 'waiting' }), 2, null, false)).toBeNull()
  })
})

describe('BoardReview', () => {
  const control = (wrapper: ReturnType<typeof mount>, label: string) =>
    wrapper.get(`ion-button[aria-label="${label}"]`)

  test('a new playing starts again before the opening lead', async () => {
    const wrapper = mount(BoardReview, { props: { review: review() } })

    await control(wrapper, 'End of the play').trigger('click')
    expect(wrapper.find('.position').text()).toContain('the rest by claim')

    await wrapper.setProps({ review: review(43, 8) })
    expect(wrapper.find('.position').text()).toBe('Before the opening lead')
  })

  test('the result at the end carries the matchpoints when known', async () => {
    const wrapper = mount(BoardReview, {
      props: { review: review(), extras: { matchpoints: { ns: 3, ew: 1 }, top: 4 } },
    })

    await control(wrapper, 'End of the play').trigger('click')
    // For the viewer's side: bo sat E-W.
    expect(wrapper.get('.result-mp-line b').text()).toBe('25 %')
  })

  test('no matchpoints line without them', async () => {
    const wrapper = mount(BoardReview, { props: { review: review() } })

    await control(wrapper, 'End of the play').trigger('click')
    expect(wrapper.find('.result').exists()).toBe(true)
    expect(wrapper.find('.result-mp').exists()).toBe(false)
  })

  test('the contract top right, with the tricks won at the step shown; nothing above the table', async () => {
    const wrapper = mount(BoardReview, { props: { review: review() } })

    const contract = wrapper.get('.corner-top-right .corner-contract')
    expect(contract.get('.contract-line').text()).toBe('4♠ by North')
    expect(contract.get('.tricks-won').text()).toBe('NS 0·EW 0')
    expect(wrapper.find('.board-bar').exists()).toBe(false)
    expect(wrapper.find('.outcome').exists()).toBe(false)
    expect(wrapper.find('.unrecorded').exists()).toBe(false)
    const first = wrapper.get('.board-review').element.firstElementChild
    expect(first?.classList.contains('review-table')).toBe(true)
    expect(first?.firstElementChild?.classList.contains('bridge-table')).toBe(true)

    await control(wrapper, 'Next trick').trigger('click')
    expect(wrapper.get('.corner-contract .tricks-won').text()).toBe('NS 1·EW 0')
  })

  test('a doubled contract reads X, a redoubled one XX', () => {
    const doubled = (n: 1 | 2) =>
      mount(BoardReview, { props: { review: { ...review(), contract: { ...review().contract!, doubled: n } } } })
        .get('.contract-line')
        .text()

    expect(doubled(1)).toBe('4♠X by North')
    expect(doubled(2)).toBe('4♠XX by North')
  })

  test('the auction in the centre before the lead, the trick from the first card, the auction again at the start', async () => {
    const wrapper = mount(BoardReview, { props: { review: review() } })
    const auction = () => wrapper.get('.centre .review-auction')
    const trick = () => wrapper.get('.centre .review-trick')

    // Both share the centre's one cell; only one is seen.
    expect(wrapper.findAllComponents({ name: 'AuctionHistory' })).toHaveLength(1)
    expect(auction().findComponent({ name: 'AuctionHistory' }).exists()).toBe(true)
    expect(auction().classes()).not.toContain('layer-off')
    expect(auction().attributes('aria-hidden')).toBeUndefined()
    expect(trick().classes()).toContain('layer-off')
    expect(trick().attributes('aria-hidden')).toBe('true')

    await control(wrapper, 'Next card').trigger('click')
    expect(auction().classes()).toContain('layer-off')
    expect(auction().attributes('aria-hidden')).toBe('true')
    expect(trick().classes()).not.toContain('layer-off')
    expect(trick().attributes('aria-hidden')).toBeUndefined()
    expect(wrapper.get('.trick-caption').text()).toBe('S to play')

    await control(wrapper, 'Next trick').trigger('click')
    await control(wrapper, 'Previous trick').trigger('click')
    expect(auction().classes()).not.toContain('layer-off')
    expect(trick().classes()).toContain('layer-off')

    await control(wrapper, 'End of the play').trigger('click')
    await control(wrapper, 'Before the opening lead').trigger('click')
    expect(auction().classes()).not.toContain('layer-off')
  })

  test("says who is vulnerable top left, from the viewer's side", () => {
    const vul = (vulnerable: string) => {
      const board = { id: 7, number: 7, dealer: 'N', vulnerable }
      return mount(BoardReview, { props: { review: { ...review(), board } as never } }).get(
        '.corner-top-left .vul-label',
      )
    }

    // bo sat East.
    expect(vul('').text()).toBe('Nobody vulnerable')
    expect(vul('').classes()).toContain('vul-label-green')
    expect(vul('').classes()).toContain('vul-label-compact')
    expect(vul('E-W').text()).toBe('Vulnerable: E-W (you)')
    expect(vul('N-S').text()).toBe('Vul: N-S')
    expect(vul('N-S').classes()).toContain('vul-label-red')

    // A board the viewer didn't play: no "(you)".
    useAuthStore().user = { id: 99, name: 'Zed', username: 'zed', email: 'zed@example.com' } as never
    expect(vul('N-S E-W').text()).toBe('Vul: Both')
  })

  test("a player's name is handed up", async () => {
    const wrapper = mount(BoardReview, { props: { review: review() } })

    wrapper.findComponent({ name: 'BridgeTable' }).vm.$emit('select', ann)
    expect(wrapper.emitted('select')).toEqual([[ann]])
  })

  test('a passed-out board: "Passed out" top right and its auction in the centre for good', () => {
    const passed = {
      ...review(),
      contract: null,
      tricks: [],
      current_trick: [],
      auction: [1, 2, 3, 4].map(() => ({ seat: 'N' as Seat, bid: pass })),
    }
    const wrapper = mount(BoardReview, { props: { review: passed } })

    expect(wrapper.get('.corner-contract').text()).toBe('Passed out')
    expect(wrapper.find('.tricks-won').exists()).toBe(false)
    expect(wrapper.find('.stepper').exists()).toBe(false)
    expect(wrapper.get('.review-auction').classes()).not.toContain('layer-off')
    expect(wrapper.get('.review-auction').findAll('.call')).toHaveLength(4)
    expect(wrapper.find('.review-trick').exists()).toBe(false)
  })

  test("an unrecorded board: its notice, no auction, the board's details in the centre", () => {
    const unrecorded = { ...review(), auction: [], tricks: [], current_trick: [] }
    const wrapper = mount(BoardReview, { props: { review: unrecorded } })

    expect(wrapper.get('.unrecorded').text()).toBe("The auction and play of this board weren't recorded.")
    expect(wrapper.findComponent({ name: 'AuctionHistory' }).exists()).toBe(false)
    expect(wrapper.find('.review-centre').exists()).toBe(false)
    expect(wrapper.get('.centre').text()).toContain('Dealer N')
    // The contract stays, without tricks to count.
    expect(wrapper.get('.contract-line').text()).toBe('4♠ by North')
    expect(wrapper.find('.tricks-won').exists()).toBe(false)
  })

  test('no board: no vulnerability corner', () => {
    const wrapper = mount(BoardReview, { props: { review: { ...review(), board: null } as never } })

    expect(wrapper.find('.corner-top-left').exists()).toBe(false)
    expect(wrapper.find('.corner-contract').exists()).toBe(true)
  })
})

describe('useBoardExport', () => {
  // The composable alone, in a component of its own.
  function harness(board: PlayingReview | null) {
    const shown = ref<PlayingReview | null>(board)
    let api!: ReturnType<typeof useBoardExport>
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useBoardExport(() => shown.value)
          return () => h('div')
        },
      }),
    )
    return { wrapper, api: () => api, shown }
  }

  test("the matchpoints from the board's results, else its set's, else none", () => {
    const { api } = harness(review())
    const history = useHistoryStore()
    expect(api().extras.value).toEqual({})

    history.sets[5] = setResults([boardRow(41, 6), boardRow(42, 7)])
    expect(api().extras.value).toEqual({ matchpoints: { ns: 3, ew: 1 }, top: 4 })

    history.results[7] = {
      board: review().board!,
      top: 2,
      results: [{ ...boardRow(42, 7), table_id: 9, players: PLAYERS, finished_at: '' }],
    } as never
    history.results[7].results[0].matchpoints = { ns: 2, ew: 0 }
    expect(api().extras.value).toEqual({ matchpoints: { ns: 2, ew: 0 }, top: 2 })
  })

  test('nothing to export without a board', async () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { api } = harness(null)

    expect(api().extras.value).toEqual({})
    await press(api().buttons.value as Button[], 'Copy as text')
    await press(api().buttons.value as Button[], 'Download .json')
    expect(writeText).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })

  test('Download .txt and .json hand over their files', async () => {
    const createObjectURL = vi.fn(() => 'blob:board')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { api } = harness(review())

    await press(api().buttons.value as Button[], 'Download .txt')
    await press(api().buttons.value as Button[], 'Download .json')

    const names = click.mock.instances.map((a) => (a as unknown as HTMLAnchorElement).download)
    expect(names).toEqual(['board-7-playing-42.txt', 'board-7-playing-42.json'])
  })

  test('a native shell only copies', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    const { api } = harness(review())

    expect((api().buttons.value as Button[]).map((b) => b.text)).toEqual(['Copy as text', 'Cancel'])
  })

  test('reset closes the sheet and drops a printout; unmounting does too', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})
    const { api, wrapper } = harness(review())

    api().open.value = true
    await press(api().buttons.value as Button[], 'Print / Save as PDF')
    expect(api().printing.value).toBe(true)
    expect(document.body.classList.contains('printing-board')).toBe(true)

    api().reset()
    expect(api().open.value).toBe(false)
    expect(api().printing.value).toBe(false)
    expect(document.body.classList.contains('printing-board')).toBe(false)

    await press(api().buttons.value as Button[], 'Print / Save as PDF')
    wrapper.unmount()
    expect(document.body.classList.contains('printing-board')).toBe(false)
  })
})

describe('BoardReviewModal', () => {
  const choices = [
    { playingId: 41, position: 1 },
    { playingId: 42, position: 2 },
  ]

  function mountModal(props: Partial<InstanceType<typeof BoardReviewModal>['$props']> = {}) {
    return mount(BoardReviewModal, {
      props: { open: true, choices, ...props },
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
      attachTo: document.body,
    })
  }

  test('opens on the latest board and switches to the others', async () => {
    answer(review(42, 7))
    const wrapper = mountModal()
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/playings/42')
    expect(wrapper.find('ion-title').text()).toBe('Board 2 review')
    expect(wrapper.findAll('ion-segment-button').map((b) => b.text())).toEqual(['Board 1', 'Board 2'])

    answer(review(41, 6))
    await pickSegment(wrapper, '41')
    expect(http.get).toHaveBeenLastCalledWith('/playings/41')
    expect(wrapper.find('ion-title').text()).toBe('Board 1 review')

    // Back to one already read: from the store, not asked again.
    await pickSegment(wrapper, '42')
    wrapper.findComponent(IonSegment).vm.$emit('update:modelValue', undefined)
    await flushPromises()
    expect(http.get).toHaveBeenCalledTimes(2)
    expect(wrapper.find('ion-title').text()).toBe('Board 2 review')
    wrapper.unmount()
  })

  test('each opening starts on the latest board', async () => {
    answer(review(42, 7))
    answer(review(41, 6))
    const wrapper = mountModal()
    await flushPromises()
    await pickSegment(wrapper, '41')

    await wrapper.setProps({ open: false })
    expect(wrapper.find('.board-review').exists()).toBe(false)
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(wrapper.find('ion-title').text()).toBe('Board 2 review')
    wrapper.unmount()
  })

  test('one board: no switcher; nothing read while closed', async () => {
    const wrapper = mountModal({ open: false, choices: [choices[1]] })
    await flushPromises()
    expect(http.get).not.toHaveBeenCalled()

    answer(review(42, 7))
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(wrapper.find('ion-segment').exists()).toBe(false)
    expect(wrapper.find('.board-review').exists()).toBe(true)
    wrapper.unmount()
  })

  test("a choice without its place in the set: the review's own set, else plain Board", async () => {
    answer(review(42, 137, 3))
    const wrapper = mountModal({
      choices: [
        { playingId: 41, position: null },
        { playingId: 42, position: null },
      ],
    })
    await flushPromises()
    expect(wrapper.findAll('ion-segment-button').map((b) => b.text())).toEqual(['Board', 'Board'])
    expect(wrapper.find('ion-title').text()).toBe('Board 3 review')

    answer(review(41, 136, null))
    await pickSegment(wrapper, '41')
    expect(wrapper.find('ion-title').text()).toBe('Board review')
    expect(wrapper.text()).not.toContain('136')
    wrapper.unmount()
  })

  test('a failed read says so and tries again', async () => {
    vi.mocked(http.get).mockRejectedValueOnce(axiosError(500, 'Server down.'))
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.find('.load-error').text()).toContain('Server down.')
    // The choice knows its place in the set before the review is read.
    expect(wrapper.find('ion-title').text()).toBe('Board 2 review')

    answer(review(42, 7))
    await wrapper.get('.load-error ion-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.load-error').exists()).toBe(false)
    expect(wrapper.find('.board-review').exists()).toBe(true)
    wrapper.unmount()
  })

  test('no boards, nothing to read', async () => {
    const wrapper = mountModal({ choices: [] })
    await flushPromises()

    expect(http.get).not.toHaveBeenCalled()
    expect(wrapper.find('.export-board').exists()).toBe(false)
    wrapper.unmount()
  })

  test('its header is the title, Export and Close: no turn bar, no To the table (#211)', async () => {
    answer(review(42, 7))
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.findAll('ion-header ion-toolbar')).toHaveLength(1)
    expect(wrapper.findAll('ion-header ion-button').map((b) => b.classes())).toEqual([
      expect.arrayContaining(['export-board']),
      expect.arrayContaining(['close-review']),
    ])
    expect(wrapper.find('.turn-notice').exists()).toBe(false)
    expect(wrapper.find('.turn-text').exists()).toBe(false)
    expect(wrapper.find('.back-to-table').exists()).toBe(false)

    await wrapper.get('.close-review').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  test('is the board review dialog; the backdrop or Escape close it, as Close does', async () => {
    answer(review(42, 7))
    const wrapper = mountModal()
    await flushPromises()
    const modal = wrapper.findComponent(modalStub)
    expect(modal.classes()).toContain('board-review-modal')

    modal.vm.$emit('didDismiss')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.get('.close-review').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })

  test('is sized as a dialog: 90 % of the height, rounded, over a backdrop', () => {
    const source = readFileSync(resolve(__dirname, '../../src/components/BoardReviewModal.vue'), 'utf8')
    const css = source.slice(source.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = (selector: string, from = 0) => {
      const start = css.indexOf(`${selector} {`, from)
      expect(start).toBeGreaterThan(-1)
      return css.slice(start, css.indexOf('}', start))
    }

    const base = rule('ion-modal.board-review-modal')
    expect(base).toContain('--height: 90vh;')
    expect(base).toContain('--width: min(100%, 880px);')
    expect(base).toContain('--border-radius: 16px;')
    expect(base).toContain('--box-shadow: 0 12px 40px var(--bridge-shadow-strong);')
    expect(base).toContain('--backdrop-opacity: var(--ion-backdrop-opacity, 0.4);')
    expect(rule('ion-modal.board-review-modal', css.indexOf('@supports (height: 1dvh)'))).toContain('--height: 90dvh;')
    expect(rule('ion-modal.board-review-modal', css.indexOf('@media (max-width: 767.98px)'))).toContain(
      '--width: calc(100% - 16px);',
    )
  })

  test('exports and prints the board shown; closing drops the printout', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})
    answer(review(42, 7))
    const wrapper = mountModal()
    await flushPromises()

    await wrapper.get('.export-board').trigger('click')
    const sheet = wrapper.findComponent(IonActionSheet)
    expect(sheet.props('isOpen')).toBe(true)

    await press(sheet.props('buttons') as Button[], 'Print / Save as PDF')
    expect(window.print).toHaveBeenCalledTimes(1)
    expect(document.querySelector('body > .board-printout h1')?.textContent).toBe('Board 2 of 4')
    expect(document.querySelector('body > .board-printout .meta')?.textContent).toContain('Nobody vulnerable')

    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.querySelector('.board-printout')).toBeNull()
    expect(document.body.classList.contains('printing-board')).toBe(false)
    wrapper.unmount()
  })
})
