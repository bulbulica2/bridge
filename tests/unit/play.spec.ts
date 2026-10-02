import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import HandView from '@/components/HandView.vue'
import TrickArea from '@/components/TrickArea.vue'
import TablePlayPage from '@/views/TablePlayPage.vue'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Bid, Card, PlayedCard, Playing, Suit, Trick } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { autoPlaysForced, forcedCard, handToPlay, legalCards, trickBySide } from '@/utils/play'
import { FORCED_PLAY_SECONDS, useForcedPlay } from '@/composables/useForcedPlay'
import { showToast } from '@/utils/toast'

vi.mock('@/services/game', () => ({
  getPlaying: vi.fn(),
  getBids: vi.fn(),
  makeCall: vi.fn(),
  playCard: vi.fn(),
}))
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

// "SA" is the ace of spades, "H10" the ten of hearts; ids are unique per card.
const RANKS: Record<string, number> = { J: 12, Q: 13, K: 14, A: 15 }
function c(name: string): Card {
  const suit = name[0] as Suit
  const rank = RANKS[name.slice(1)] ?? Number(name.slice(1))
  return { id: 'SHDC'.indexOf(suit) * 20 + rank, suit, rank, rank_name: name.slice(1) }
}
const cards = (...names: string[]) => names.map(c)

function played(written: string): PlayedCard[] {
  return written
    ? written.split(', ').map((made) => {
        const [seat, card] = made.split(' ')
        return { seat: seat as Seat, card: c(card) }
      })
    : []
}

describe('follow-suit hint', () => {
  const hand = cards('SA', 'S7', 'HK', 'D2')

  test('any card may lead', () => {
    expect(legalCards(hand, [])).toEqual(hand)
    expect(legalCards(hand, null)).toEqual(hand)
  })

  test('a hand holding the suit led must follow it', () => {
    expect(legalCards(hand, played('W S3')).map((x) => x.id)).toEqual([c('SA').id, c('S7').id])
    expect(legalCards(hand, played('E D9, S C2')).map((x) => x.id)).toEqual([c('D2').id])
  })

  test('a hand out of the suit led may play anything', () => {
    expect(legalCards(hand, played('N C5'))).toEqual(hand)
  })
})

describe('forced card', () => {
  test('the only card that may follow is forced', () => {
    expect(forcedCard(cards('SQ', 'H3', 'C9'), played('W S3'))).toEqual(c('SQ'))
    // The last card of the hand, following or not.
    expect(forcedCard(cards('D2'), played('W S3, N SQ'))).toEqual(c('D2'))
  })

  test('two or more legal cards leave the choice to the player', () => {
    expect(forcedCard(cards('SQ', 'S4', 'H3'), played('W S3'))).toBeNull()
    // Out of the suit led: anything goes.
    expect(forcedCard(cards('H3', 'C9'), played('W S3'))).toBeNull()
  })

  test('never on the lead, even with a single card left', () => {
    expect(forcedCard(cards('D2'), [])).toBeNull()
    expect(forcedCard(cards('D2'), null)).toBeNull()
  })

  test('an empty hand has nothing to play', () => {
    expect(forcedCard([], played('W S3'))).toBeNull()
  })
})

describe('forced card timer', () => {
  type Forced = { key: string; card: Card } | null
  const SQ = c('SQ')

  function start(initial: Forced) {
    const forced = ref<Forced>(initial)
    const play = vi.fn()
    const scope = effectScope()
    const timer = scope.run(() => useForcedPlay(() => forced.value, play))!
    return { forced, play, timer, scope }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('counts down, then plays the card once', () => {
    const { play, timer } = start({ key: 'a', card: SQ })

    expect(timer.card.value).toEqual(SQ)
    expect(timer.secondsLeft.value).toBe(FORCED_PLAY_SECONDS)
    vi.advanceTimersByTime(1000)
    expect(timer.secondsLeft.value).toBe(FORCED_PLAY_SECONDS - 1)
    vi.advanceTimersByTime(FORCED_PLAY_SECONDS * 1000 - 1001)
    expect(play).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith(SQ)
    expect(timer.card.value).toBeNull()

    vi.advanceTimersByTime(10_000)
    expect(play).toHaveBeenCalledTimes(1)
  })

  test('a new state restarts the countdown; nothing forced cancels it', async () => {
    const { forced, play, timer } = start({ key: 'a', card: SQ })
    vi.advanceTimersByTime(2000)

    forced.value = { key: 'b', card: c('H3') }
    await nextTick()
    expect(timer.secondsLeft.value).toBe(FORCED_PLAY_SECONDS)
    vi.advanceTimersByTime(2000)
    expect(play).not.toHaveBeenCalled()

    // A claim, a card in flight, the page left: no card goes.
    forced.value = null
    await nextTick()
    expect(timer.card.value).toBeNull()
    vi.advanceTimersByTime(10_000)
    expect(play).not.toHaveBeenCalled()
  })

  test('the same state back after a pause counts down again, but not once it fired', async () => {
    const { forced, play } = start({ key: 'a', card: SQ })
    forced.value = null
    await nextTick()
    forced.value = { key: 'a', card: SQ }
    await nextTick()
    vi.advanceTimersByTime(FORCED_PLAY_SECONDS * 1000)
    expect(play).toHaveBeenCalledTimes(1)

    // The card was refused and the reload shows the same state: wait for a tap.
    forced.value = null
    await nextTick()
    forced.value = { key: 'a', card: SQ }
    await nextTick()
    vi.advanceTimersByTime(10_000)
    expect(play).toHaveBeenCalledTimes(1)
  })

  test('stops with its scope (the page going away)', () => {
    const { play, scope } = start({ key: 'a', card: SQ })
    scope.stop()
    vi.advanceTimersByTime(10_000)
    expect(play).not.toHaveBeenCalled()
  })
})

describe('whose hand is on play', () => {
  function state(overrides: Partial<Playing>): Playing {
    return {
      phase: 'play',
      playing_id: 1,
      board: null,
      players: null,
      turn: 'S',
      acting_user_id: 3,
      auction: [],
      contract: { bid: {} as Bid, doubled: 0, declarer: 'S', dummy: 'N' },
      tricks: [],
      current_trick: [],
      tricks_won: { ns: 0, ew: 0 },
      dummy_hand: null,
      result: null,
      deal: null,
      ready: null,
      my_seat: 'S',
      hand: [],
      ...overrides,
    }
  }

  test('our own turn plays our hand', () => {
    expect(handToPlay(state({}), 3)).toBe('own')
  })

  test("declarer plays dummy's hand on dummy's turn", () => {
    expect(handToPlay(state({ turn: 'N', acting_user_id: 3 }), 3)).toBe('dummy')
  })

  test('dummy never plays, even on their own seat', () => {
    expect(handToPlay(state({ turn: 'N', acting_user_id: 3, my_seat: 'N' }), 1)).toBeNull()
  })

  test("nothing while it is someone else's move, or outside the play", () => {
    expect(handToPlay(state({ turn: 'W', acting_user_id: 4 }), 3)).toBeNull()
    expect(handToPlay(state({ phase: 'auction' }), 3)).toBeNull()
  })

  // 4♠ by South: a forced card plays itself for declarer alone.
  test("declarer's forced cards play themselves, from either hand", () => {
    expect(autoPlaysForced(state({}))).toBe(true)
    expect(autoPlaysForced(state({ turn: 'N' }))).toBe(true)
  })

  test("a defender's never do", () => {
    expect(autoPlaysForced(state({ my_seat: 'E', turn: 'E', acting_user_id: 2 }))).toBe(false)
    expect(autoPlaysForced(state({ my_seat: 'W', turn: 'W', acting_user_id: 4 }))).toBe(false)
    expect(autoPlaysForced(state({ contract: null }))).toBe(false)
  })
})

describe('trick layout by seat', () => {
  test('each card lies on the side its hand is drawn on', () => {
    const trick = played('W SK, N S2, E SA, S S9')

    expect(trickBySide(trick, 'S')).toEqual({
      left: c('SK'),
      top: c('S2'),
      right: c('SA'),
      bottom: c('S9'),
    })
    // East sees South on the left and West opposite.
    expect(trickBySide(trick, 'E')).toEqual({
      left: c('S9'),
      top: c('SK'),
      right: c('S2'),
      bottom: c('SA'),
    })
  })

  test('seats yet to play are empty', () => {
    expect(trickBySide(played('N HQ'), 'S')).toEqual({
      left: null,
      top: c('HQ'),
      right: null,
      bottom: null,
    })
  })

  test('TrickArea draws the trick rotated for the viewer and rings the winner', () => {
    const wrapper = mount(TrickArea, {
      props: { cards: played('W SK, N S2, E SA, S S9'), mySeat: 'N', winner: 'E' },
    })

    const rank = (side: string) => wrapper.get(`[data-side="${side}"] .rank`).text()
    // North at the bottom: East on the left, South opposite, West on the right.
    expect([rank('bottom'), rank('left'), rank('top'), rank('right')]).toEqual(['2', 'A', '9', 'K'])
    expect(wrapper.get('.won').attributes('data-seat')).toBe('E')
    expect(wrapper.get('.trick').attributes('aria-label')).toContain('Trick won by E')
  })

  test('TrickArea is compact by default: no spread class, no seat tags', () => {
    const wrapper = mount(TrickArea, {
      props: { cards: played('W SK, N S2, E SA, S S9'), mySeat: 'N', winner: 'E' },
    })

    expect(wrapper.get('.trick').classes()).not.toContain('spread')
    expect(wrapper.findAll('.seat-tag')).toHaveLength(0)
  })

  test('TrickArea spread parts the cards, tags each seat and still marks the winner', () => {
    const wrapper = mount(TrickArea, {
      props: { cards: played('W SK, N S2, E SA, S S9'), mySeat: 'N', winner: 'E', spread: true },
    })

    expect(wrapper.get('.trick').classes()).toContain('spread')
    const tag = (side: string) => wrapper.get(`[data-side="${side}"] .seat-tag`).text()
    // The viewer's own seat reads "You".
    expect([tag('bottom'), tag('left'), tag('top'), tag('right')]).toEqual(['You', 'E', 'S', 'W'])
    expect(wrapper.findAll('.won')).toHaveLength(1)
    expect(wrapper.get('.won').attributes('data-seat')).toBe('E')
    expect(wrapper.get('.won .seat-tag').text()).toBe('E')
  })
})

describe('HandView on play', () => {
  const hand = cards('SA', 'S7', 'HK')

  test('only the legal cards can be tapped; the rest are dimmed', async () => {
    const wrapper = mount(HandView, { props: { cards: hand, playable: [c('HK').id] } })

    const buttons = wrapper.findAll('button')
    expect(buttons.map((b) => (b.element as HTMLButtonElement).disabled)).toEqual([true, true, false])
    expect(wrapper.findAll('.illegal')).toHaveLength(2)
    await buttons[2].trigger('click')
    expect(wrapper.emitted('play')).toEqual([[c('HK')]])
  })

  test('a hand on show only has no buttons', () => {
    const wrapper = mount(HandView, { props: { cards: hand } })

    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.findAll('.playing-card')).toHaveLength(3)
  })

  test('while a card is on its way, nothing can be tapped', () => {
    const wrapper = mount(HandView, {
      props: { cards: hand, playable: hand.map((x) => x.id), busy: true, sendingId: c('SA').id },
    })

    expect(wrapper.findAll('button').every((b) => (b.element as HTMLButtonElement).disabled)).toBe(true)
    expect(wrapper.get('.sending').attributes('data-card')).toBe(String(c('SA').id))
  })
})

describe('TablePlayPage card play', () => {
  // A forced card's countdown must not outlive its test.
  enableAutoUnmount(afterEach)

  const PLAYERS = {
    N: { id: 1, name: 'Ann', username: 'ann', description: null },
    E: { id: 2, name: 'Bob', username: 'bob', description: null },
    S: { id: 3, name: 'Cy', username: 'cy', description: null },
    W: { id: 4, name: 'Di', username: 'di', description: null },
  }
  const FOUR_SPADES: Bid = { id: 20, call: '4S', level: 4, strain: 'S', special: false }

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

  const SOUTH = cards('SA', 'S7', 'HK', 'D2')
  const NORTH = cards('SQ', 'H3', 'C9')

  // 4♠ by South, North dummy; West has led the ♠3 and it is North's turn,
  // which South (the user) plays.
  function state(overrides: Partial<Playing> = {}): Playing {
    return {
      phase: 'play',
      playing_id: 42,
      board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
      players: PLAYERS,
      turn: 'N',
      acting_user_id: 3,
      auction: [],
      contract: { bid: FOUR_SPADES, doubled: 0, declarer: 'S', dummy: 'N' },
      tricks: [],
      current_trick: played('W S3'),
      tricks_won: { ns: 0, ew: 0 },
      dummy_hand: NORTH,
      result: null,
      deal: null,
      ready: null,
      my_seat: 'S',
      hand: SOUTH,
      ...overrides,
    }
  }

  function logIn(id: number, name: string) {
    useAuthStore().user = { id, name, username: name.toLowerCase(), email: `${id}@example.com` }
  }

  function refused(message: string) {
    const config = { headers: new AxiosHeaders() }
    const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
    error.response = { status: 409, data: { status: 409, message, data: [] }, statusText: '', headers: {}, config }
    return error
  }

  const modalStub = { template: '<div><slot /></div>' }

  async function mountPage(playing: Playing) {
    vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
    const wrapper = mount(TablePlayPage, {
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
    await flushPromises()
    return wrapper
  }

  const enabledCards = (wrapper: ReturnType<typeof mount>, selector: string) =>
    wrapper
      .findAll(`${selector} button[data-card]`)
      .filter((b) => !(b.element as HTMLButtonElement).disabled)
      .map((b) => Number(b.attributes('data-card')))

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    logIn(3, 'Cy')
    vi.mocked(tablesService.getTable).mockResolvedValue(table)
    vi.mocked(gameService.getBids).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("declarer plays dummy's cards from the top of the table, following suit", async () => {
    const wrapper = await mountPage(state({ dummy_hand: cards('SQ', 'S4', 'H3', 'C9') }))

    const top = wrapper.get('.side-top')
    expect(top.classes()).toContain('seat-wide')
    expect(top.text()).toContain('dummy')
    expect(enabledCards(wrapper, '.side-top')).toEqual([c('SQ').id, c('S4').id])
    // Two cards may follow: nothing plays itself.
    expect(wrapper.find('.forced').exists()).toBe(false)
    // Our own hand waits: it isn't South's turn.
    expect(wrapper.findAll('.my-hand button')).toHaveLength(0)
    expect(wrapper.text()).toContain('Play: your turn from dummy (N). Follow suit: spades.')
  })

  test('a tapped card goes out once, and the answer moves the trick on', async () => {
    const wrapper = await mountPage(state({ turn: 'S', current_trick: played('W S3, N SQ, E S5'), dummy_hand: cards('H3', 'C9') }))
    let answer!: (state: Playing) => void
    vi.mocked(gameService.playCard).mockReturnValue(new Promise((resolve) => (answer = resolve)))

    expect(enabledCards(wrapper, '.my-hand')).toEqual([c('SA').id, c('S7').id])
    await wrapper.get(`.my-hand button[data-card="${c('SA').id}"]`).trigger('click')
    await wrapper.get(`.my-hand button[data-card="${c('S7').id}"]`).trigger('click')
    expect(gameService.playCard).toHaveBeenCalledTimes(1)
    expect(gameService.playCard).toHaveBeenCalledWith(5, c('SA').id)
    expect(wrapper.text()).toContain('Playing your card…')
    expect(enabledCards(wrapper, '.my-hand')).toEqual([])

    const trick: Trick = { round: 1, leader: 'W', cards: played('W S3, N SQ, E S5, S SA'), winner: 'S' }
    answer(
      state({
        turn: 'S',
        tricks: [trick],
        current_trick: [],
        tricks_won: { ns: 1, ew: 0 },
        dummy_hand: cards('H3', 'C9'),
        hand: cards('S7', 'HK', 'D2'),
      }),
    )
    await flushPromises()

    expect(wrapper.get('.tricks-won').text()).toContain('NS 1')
    expect(wrapper.get('.trick .won').attributes('data-seat')).toBe('S')
    expect(wrapper.get('.trick-caption').text()).toBe('You win')
    expect(wrapper.text()).toContain('Play: your lead.')
  })

  test('the finished trick stays up for a moment, then the table clears', async () => {
    const wrapper = await mountPage(state({ turn: 'E', acting_user_id: 2, current_trick: played('W S3, N SQ') }))
    vi.useFakeTimers()

    useGameStore().applyPlayingUpdate(
      5,
      state({
        turn: 'N',
        acting_user_id: 3,
        tricks: [{ round: 1, leader: 'W', cards: played('W S3, N SQ, E SK, S S7'), winner: 'E' }],
        current_trick: [],
        tricks_won: { ns: 0, ew: 1 },
      }),
    )
    await flushPromises()
    expect(wrapper.findAll('.centre > .trick .playing-card')).toHaveLength(4)
    expect(wrapper.get('.trick-caption').text()).toBe('E wins')
    // That trick is on show already: no last-trick button meanwhile.
    expect(wrapper.find('.last-trick-button').exists()).toBe(false)

    vi.advanceTimersByTime(2000)
    await flushPromises()
    expect(wrapper.findAll('.centre > .trick .playing-card')).toHaveLength(0)
    expect(wrapper.get('.trick-caption').text()).toBe('Trick 2')

    // The last trick can still be looked at, in a pop-up: the trick in
    // progress stays in the middle.
    await wrapper.get('.last-trick-button').trigger('click')
    expect(wrapper.findAll('.last-trick-popup .playing-card')).toHaveLength(4)
    expect(wrapper.get('.last-trick-title').text()).toBe('Trick 1 · E wins')
    expect(wrapper.findAll('.centre > .trick .playing-card')).toHaveLength(0)
    expect(wrapper.get('.trick-caption').text()).toBe('Trick 2')
    // Nor is it in the contract bar any more.
    expect(wrapper.get('.outcome').text()).not.toContain('Last trick')
  })

  test('no last trick before the first one is won', async () => {
    const wrapper = await mountPage(state())

    expect(wrapper.get('.trick-caption').text()).toBe('Trick 1')
    expect(wrapper.find('.last-trick-button').exists()).toBe(false)
  })

  test('dummy sees their hand played for them and taps nothing', async () => {
    logIn(1, 'Ann')
    const wrapper = await mountPage(state({ my_seat: 'N', hand: NORTH }))

    expect(wrapper.text()).toContain('Declarer is playing your cards.')
    expect(wrapper.findAll('button[data-card]')).toHaveLength(0)
    // Dummy's cards are their own hand below, not a second copy at the table.
    expect(wrapper.find('.side-top .dummy-hand').exists()).toBe(false)
  })

  test("dummy stays hidden until the opening lead; a defender then sees it on dummy's side", async () => {
    logIn(2, 'Bob')
    const beforeLead = state({ turn: 'W', acting_user_id: 4, current_trick: [], dummy_hand: null, my_seat: 'E', hand: cards('SK', 'S5') })
    const wrapper = await mountPage(beforeLead)
    expect(wrapper.find('.dummy-columns').exists()).toBe(false)

    useGameStore().applyPlayingUpdate(5, { ...state({ turn: 'N', acting_user_id: 3 }) })
    await flushPromises()

    // East sees North on the right.
    const columns = wrapper.get('.side-right .dummy-columns')
    expect(columns.findAll('.column').map((col) => col.findAll('.rank').map((r) => r.text()))).toEqual([
      ['Q'],
      ['3'],
      [],
      ['9'],
    ])
    expect(wrapper.text()).toContain('Play: waiting for cy, from dummy.')
  })

  test("a refused card shows the backend's reason and rereads the board", async () => {
    const wrapper = await mountPage(state())
    vi.mocked(gameService.playCard).mockRejectedValue(refused('You must follow suit: Spades were led.'))

    await wrapper.get(`.side-top button[data-card="${c('SQ').id}"]`).trigger('click')
    await flushPromises()

    expect(showToast).toHaveBeenCalledWith('You must follow suit: Spades were led.', 'danger')
    expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
  })

  describe('a forced card', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    test("dummy's only spade plays itself after 3 s", async () => {
      vi.mocked(gameService.playCard).mockReturnValue(new Promise(() => {}))
      const wrapper = await mountPage(state())

      expect(wrapper.get('.side-top .forced').attributes('data-card')).toBe(String(c('SQ').id))
      expect(wrapper.get('.status').text()).toBe('Play: your turn from dummy (N). Playing ♠Q in 3 s…')
      vi.advanceTimersByTime(1000)
      await nextTick()
      expect(wrapper.get('.status').text()).toContain('Playing ♠Q in 2 s…')
      expect(gameService.playCard).not.toHaveBeenCalled()

      vi.advanceTimersByTime(2000)
      await flushPromises()
      expect(gameService.playCard).toHaveBeenCalledTimes(1)
      expect(gameService.playCard).toHaveBeenCalledWith(5, c('SQ').id)
      expect(wrapper.text()).toContain('Playing your card…')
    })

    test('tapped during the countdown, it goes at once, and only once', async () => {
      vi.mocked(gameService.playCard).mockReturnValue(new Promise(() => {}))
      const wrapper = await mountPage(state())

      await wrapper.get(`.side-top button[data-card="${c('SQ').id}"]`).trigger('click')
      expect(gameService.playCard).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(10_000)
      await flushPromises()
      expect(gameService.playCard).toHaveBeenCalledTimes(1)
    })

    test('our own hand counts too', async () => {
      vi.mocked(gameService.playCard).mockReturnValue(new Promise(() => {}))
      const wrapper = await mountPage(
        state({ turn: 'S', current_trick: played('W D9, N C9, E D5'), dummy_hand: cards('SQ', 'H3') }),
      )

      expect(wrapper.get('.my-hand .forced').attributes('data-card')).toBe(String(c('D2').id))
      vi.advanceTimersByTime(3000)
      await flushPromises()
      expect(gameService.playCard).toHaveBeenCalledWith(5, c('D2').id)
    })

    test('a defender taps their only card themselves', async () => {
      // East, a defender, holds a single spade after West's lead and dummy's queen.
      logIn(2, 'Bob')
      vi.mocked(gameService.playCard).mockReturnValue(new Promise(() => {}))
      const wrapper = await mountPage(
        state({
          turn: 'E',
          acting_user_id: 2,
          my_seat: 'E',
          hand: cards('S5', 'HK', 'D2'),
          current_trick: played('W S3, N SQ'),
          dummy_hand: cards('H3', 'C9'),
        }),
      )

      // The hint stays: only the spade can be tapped.
      expect(enabledCards(wrapper, '.my-hand')).toEqual([c('S5').id])
      expect(wrapper.find('.forced').exists()).toBe(false)
      expect(wrapper.get('.status').text()).not.toContain('Playing')
      vi.advanceTimersByTime(10_000)
      await flushPromises()
      expect(gameService.playCard).not.toHaveBeenCalled()

      await wrapper.get(`.my-hand button[data-card="${c('S5').id}"]`).trigger('click')
      expect(gameService.playCard).toHaveBeenCalledWith(5, c('S5').id)
    })

    test('nothing plays itself on the lead', async () => {
      const wrapper = await mountPage(state({ turn: 'S', current_trick: [], hand: cards('D2') }))

      expect(wrapper.find('.forced').exists()).toBe(false)
      vi.advanceTimersByTime(10_000)
      await flushPromises()
      expect(gameService.playCard).not.toHaveBeenCalled()
    })

    test('a new card on the table restarts it; a claim stops it', async () => {
      // South holds a single spade.
      const hand = cards('S7', 'HK', 'D2')
      const wrapper = await mountPage(
        state({ turn: 'E', acting_user_id: 2, current_trick: played('W S3, N SQ'), hand, dummy_hand: cards('H3', 'C9') }),
      )
      const game = useGameStore()
      expect(wrapper.find('.forced').exists()).toBe(false)

      // East plays: South's seven is forced.
      const afterEast = state({ turn: 'S', current_trick: played('W S3, N SQ, E S5'), hand, dummy_hand: cards('H3', 'C9') })
      game.applyPlayingUpdate(5, afterEast)
      await flushPromises()
      expect(wrapper.get('.my-hand .forced').attributes('data-card')).toBe(String(c('S7').id))
      vi.advanceTimersByTime(2000)

      // West claims the rest before the card goes.
      game.applyPlayingUpdate(5, { ...afterEast, claim: { seat: 'W', tricks: 13, hand: cards('CA'), accepted: [] } })
      await flushPromises()
      expect(wrapper.find('.forced').exists()).toBe(false)
      vi.advanceTimersByTime(10_000)
      await flushPromises()
      expect(gameService.playCard).not.toHaveBeenCalled()
    })

    test('opening the claim sheet stops it', async () => {
      const wrapper = await mountPage(state({ claim: null }))
      expect(wrapper.find('.forced').exists()).toBe(true)

      await wrapper.get('.claim-button').trigger('click')
      expect(wrapper.find('.forced').exists()).toBe(false)
      vi.advanceTimersByTime(10_000)
      await flushPromises()
      expect(gameService.playCard).not.toHaveBeenCalled()
    })
  })

  describe('robots', () => {
    // East is a robot.
    const WITH_ROBOT = { ...PLAYERS, E: { ...PLAYERS.E, username: 'robot-1', is_robot: true } }

    test("a robot's turn reads as thinking, at its seat and in the status line", async () => {
      const wrapper = await mountPage(
        state({ players: WITH_ROBOT, turn: 'E', acting_user_id: 2, current_trick: played('W S3, N SQ') }),
      )

      // South at the bottom, so East is on the right.
      const east = wrapper.get('.side-right')
      expect(east.find('.robot-badge').exists()).toBe(true)
      expect(east.get('.turn').text()).toBe('Thinking…')
      expect(wrapper.get('.status').text()).toBe('Play: robot-1 is thinking…')
      expect(wrapper.get('.status').classes()).toContain('status-robot')
    })

    test("a person's turn still reads as waiting, and people carry no robot badge", async () => {
      const wrapper = await mountPage(
        state({ turn: 'E', acting_user_id: 2, current_trick: played('W S3, N SQ') }),
      )

      expect(wrapper.get('.side-right .turn').text()).toBe('To act')
      expect(wrapper.get('.status').text()).toBe('Play: waiting for bob.')
      expect(wrapper.find('.robot-badge').exists()).toBe(false)
    })
  })
})
