import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { useAuthStore } from '@/stores/auth'
import { useTablesStore } from '@/stores/tables'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import * as echo from '@/services/echo'
import type { AuctionCall, Bid, Card, Playing, PublicPlaying } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import { showToast } from '@/utils/toast'
import { compactOf } from './compactPlaying'

vi.mock('@/services/game', () => ({
  getPlaying: vi.fn(),
  getBids: vi.fn(),
  getCards: vi.fn(),
  makeCall: vi.fn(),
  playCard: vi.fn(),
  nextBoard: vi.fn(),
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

// Players 1–4 sit N, E, S, W; the user is 3 (South) unless a test says otherwise.
const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null },
  E: { id: 2, name: 'Bob', username: 'bob', description: null },
  S: { id: 3, name: 'Cy', username: 'cy', description: null },
  W: { id: 4, name: 'Di', username: 'di', description: null },
}

function card(id: number, suit: Card['suit'], rank: number): Card {
  return { id, suit, rank, rank_name: String(rank) }
}

const HAND = [card(52, 'S', 15), card(38, 'H', 13), card(3, 'C', 4)]

const ONE_HEART: Bid = { id: 6, call: '1H', level: 1, strain: 'H', special: false }
const PASS: Bid = { id: 1, call: 'P', level: null, strain: null, special: true }
const BIDS: Bid[] = [PASS, ONE_HEART]

function auction(...bids: Bid[]): AuctionCall[] {
  const seats: Seat[] = ['S', 'W', 'N', 'E']
  return bids.map((bid, i) => ({ seat: seats[i % 4], bid }))
}

function publicState(overrides: Partial<PublicPlaying> = {}): PublicPlaying {
  return {
    phase: 'auction',
    playing_id: 42,
    board: { id: 7, number: 7, dealer: 'S', vulnerable: 'N-S' },
    players: PLAYERS,
    turn: 'S',
    acting_user_id: 3,
    auction: [],
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    result: null,
    deal: null,
    ready: null,
    ...overrides,
  }
}

function fullState(overrides: Partial<Playing> = {}): Playing {
  return { ...publicState(), my_seat: 'S', hand: HAND, ...overrides }
}

function makeTable(seated: Seat[], boardId: number | null): Table {
  return {
    id: 5,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: boardId,
    created_at: '',
    updated_at: '',
    seats: seated.map((seat, i) => ({
      id: i + 1,
      table_id: 5,
      user_id: PLAYERS[seat].id,
      seat,
      user: PLAYERS[seat],
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !seated.includes(s)),
    can_manage: false,
  }
}

function logIn(id = 3) {
  useAuthStore().user = { id, name: 'Cy', username: 'cy', email: 'cy@example.com' }
}

async function loaded(state: Playing = fullState()) {
  vi.mocked(gameService.getPlaying).mockResolvedValue(state)
  const game = useGameStore()
  await game.load(5)
  return game
}

describe('game store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    logIn()
  })

  test('load keeps the whole snapshot, hand included', async () => {
    const game = await loaded()

    expect(gameService.getPlaying).toHaveBeenCalledWith(5)
    expect(game.tableId).toBe(5)
    expect(game.playing).toEqual(fullState())
  })

  test('PlayingUpdated replaces the public part and keeps our hand', async () => {
    const game = await loaded()

    game.applyPlayingUpdate(5, publicState({ turn: 'W', acting_user_id: 4, auction: [
      { seat: 'S', bid: { id: 6, call: '1H', level: 1, strain: 'H', special: false } },
    ] }))

    expect(game.playing?.turn).toBe('W')
    expect(game.playing?.auction).toHaveLength(1)
    expect(game.playing?.hand).toEqual(HAND)
    expect(game.playing?.my_seat).toBe('S')
  })

  test('a card played from our hand leaves it', async () => {
    const game = await loaded()

    game.applyPlayingUpdate(5, publicState({ phase: 'play', current_trick: [
      { seat: 'S', card: HAND[0] },
    ] }))

    expect(game.playing?.hand?.map((c) => c.id)).toEqual([38, 3])
  })

  test('ignores updates for another table', async () => {
    const game = await loaded()

    game.applyPlayingUpdate(9, publicState({ turn: 'W' }))

    expect(game.playing?.turn).toBe('S')
  })

  test('a new board shows no hand until its HandDealt arrives', async () => {
    const game = await loaded(fullState({ phase: 'finished', turn: null }))
    const newHand = [card(1, 'D', 2)]

    game.applyPlayingUpdate(5, publicState({ playing_id: 43 }))
    expect(game.playing?.hand).toBeNull()
    expect(game.playing?.my_seat).toBe('S')

    game.applyHandDealt({ table_id: 5, playing_id: 43, my_seat: 'S', hand: newHand })
    expect(game.playing?.hand).toEqual(newHand)
  })

  test('a HandDealt that beats its PlayingUpdated is kept for it', async () => {
    const game = await loaded({ ...fullState(), ...publicState({ phase: 'waiting' }), my_seat: null, hand: null })
    const newHand = [card(1, 'D', 2)]

    game.applyHandDealt({ table_id: 5, playing_id: 43, my_seat: 'S', hand: newHand })
    expect(game.playing?.hand).toBeNull()

    game.applyPlayingUpdate(5, publicState({ playing_id: 43 }))
    expect(game.playing?.hand).toEqual(newHand)
  })

  test('a player leaving mid-board abandons it: toast and back to waiting', async () => {
    const game = await loaded()

    game.applyTableUpdate(makeTable(['N', 'S', 'W'], null))

    expect(showToast).toHaveBeenCalledWith('bob left, the board was abandoned.', 'warning')
    expect(game.playing?.phase).toBe('waiting')
    expect(game.playing?.hand).toBeNull()
  })

  test('a side forfeiting the set mid-board: told once, and back to waiting', async () => {
    const set = { id: 8, number: 2, board: 3, of: 4, finished: false, ended: null, forfeited_by: null }
    const game = await loaded({ ...fullState(), set })
    const table = makeTable(['N', 'S', 'W'], null)
    table.set = { ...set, finished: true, ended: 'forfeit', forfeited_by: 'EW' }

    game.applyTableUpdate(table)
    game.applyTableUpdate(table)

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('bob is gone: E-W lose set 2 by forfeit.', 'warning')
    expect(game.playing?.phase).toBe('waiting')
  })

  test('a forfeit between boards is told too, and the finished board stays', async () => {
    const set = { id: 8, number: 2, board: 3, of: 4, finished: false, ended: null, forfeited_by: null }
    const game = await loaded({ ...fullState({ phase: 'finished', turn: null }), set })
    const table = makeTable(['N', 'E', 'S'], 7)
    table.set = { ...set, finished: true, ended: 'forfeit', forfeited_by: 'EW' }

    game.applyTableUpdate(table)

    expect(showToast).toHaveBeenCalledWith('di is gone: E-W lose set 2 by forfeit.', 'warning')
    expect(game.playing?.phase).toBe('finished')
  })

  test('a seat change that keeps the board says nothing', async () => {
    const game = await loaded()

    game.applyTableUpdate(makeTable(['N', 'E', 'S', 'W'], 7))

    expect(showToast).not.toHaveBeenCalled()
    expect(game.playing?.phase).toBe('auction')
  })

  test('forgets the board once we no longer sit at the table', async () => {
    const game = await loaded()

    game.applyTableUpdate(makeTable(['N', 'E', 'W'], null))

    expect(showToast).not.toHaveBeenCalled()
    expect(game.playing).toBeNull()
    expect(game.tableId).toBeNull()
  })

  test('the tables store routes PlayingUpdated and TableUpdated here', async () => {
    const game = await loaded()
    vi.mocked(tablesService.getTable).mockResolvedValue(makeTable(['N', 'E', 'S', 'W'], 7))
    await useTablesStore().loadTable(5)

    game.cards = HAND
    game.bids = BIDS

    const [id, onTable, onPlaying] = vi.mocked(echo.listenToTable).mock.calls[0]
    expect(id).toBe(5)
    onPlaying(compactOf(publicState({ turn: 'W' })))
    expect(game.playing?.turn).toBe('W')

    onTable(makeTable(['N', 'S', 'W'], null))
    expect(game.playing?.phase).toBe('waiting')
  })

  test('follows the user channel once and leaves it on unwatch', () => {
    const game = useGameStore()

    game.watchUser(3)
    game.watchUser(3)
    expect(echo.listenToUser).toHaveBeenCalledTimes(1)
    expect(echo.listenToUser).toHaveBeenCalledWith(
      3,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    )

    game.unwatchUser()
    expect(echo.leaveUser).toHaveBeenCalledWith(3)
    expect(game.watchedUserId).toBeNull()
  })

  test('refetches the board after a reconnect', async () => {
    const game = await loaded()
    vi.mocked(gameService.getPlaying).mockResolvedValue(fullState({ turn: 'N' }))

    const [reconnected] = vi.mocked(echo.onReconnect).mock.calls[0]
    reconnected()
    await vi.waitFor(() => expect(game.playing?.turn).toBe('N'))
  })

  test('reads the bid list once and shares a request in flight', async () => {
    vi.mocked(gameService.getBids).mockResolvedValue(BIDS)
    const game = useGameStore()

    const [first, second] = await Promise.all([game.loadBids(), game.loadBids()])
    await game.loadBids()

    expect(gameService.getBids).toHaveBeenCalledTimes(1)
    expect(first).toEqual(BIDS)
    expect(second).toEqual(BIDS)
    expect(game.bids).toEqual(BIDS)
  })

  test('rereads the bid list when forced, and after a failure', async () => {
    const game = useGameStore()
    vi.mocked(gameService.getBids).mockRejectedValueOnce(new Error('down'))
    await expect(game.loadBids()).rejects.toThrow('down')
    expect(game.bids).toEqual([])

    vi.mocked(gameService.getBids).mockResolvedValue(BIDS)
    await game.loadBids()
    await game.loadBids(true)

    expect(gameService.getBids).toHaveBeenCalledTimes(3)
    expect(game.bids).toEqual(BIDS)
  })

  describe('PlayingUpdated over the channel, compact', () => {
    const LEAD = { seat: 'W' as Seat, card: HAND[1] }
    const opened = publicState({ auction: auction(ONE_HEART, PASS), turn: 'N' })

    test('is expanded and applied at once while both lists are held', async () => {
      const game = await loaded()
      game.cards = HAND
      game.bids = BIDS

      game.receivePlayingUpdate(5, compactOf(opened))

      expect(game.playing).toEqual({ ...opened, my_seat: 'S', hand: HAND, declarer_hand: null })
      expect(gameService.getCards).not.toHaveBeenCalled()
    })

    test('waits for the lists, and applies what came meanwhile in order', async () => {
      const game = await loaded()
      vi.mocked(gameService.getCards).mockResolvedValue(HAND)
      vi.mocked(gameService.getBids).mockResolvedValue(BIDS)
      const inPlay = publicState({
        phase: 'play',
        auction: auction(ONE_HEART, PASS, PASS, PASS),
        turn: 'N',
        current_trick: [LEAD],
      })

      game.receivePlayingUpdate(5, compactOf(opened))
      game.receivePlayingUpdate(5, compactOf(inPlay))
      expect(game.playing?.auction).toEqual([])

      await vi.waitFor(() => expect(game.playing?.phase).toBe('play'))
      expect(game.playing?.current_trick).toEqual([LEAD])
      expect(game.playing?.hand).toEqual([HAND[0], HAND[2]])
      expect(gameService.getCards).toHaveBeenCalledTimes(1)
      expect(gameService.getBids).toHaveBeenCalledTimes(1)

      // Once held, the next one goes straight in.
      game.receivePlayingUpdate(5, compactOf({ ...inPlay, turn: 'E' }))
      expect(game.playing?.turn).toBe('E')
    })

    test('without the lists, reads the state over HTTP instead', async () => {
      const game = await loaded()
      vi.mocked(gameService.getCards).mockRejectedValue(new Error('down'))
      vi.mocked(gameService.getBids).mockResolvedValue(BIDS)
      vi.mocked(gameService.getPlaying).mockResolvedValue(fullState({ turn: 'W' }))

      game.receivePlayingUpdate(5, compactOf(opened))

      await vi.waitFor(() => expect(game.playing?.turn).toBe('W'))
      expect(gameService.getPlaying).toHaveBeenCalledTimes(2)
    })

    test('an id the lists lack rereads them and the state', async () => {
      const game = await loaded()
      game.cards = HAND
      game.bids = [PASS]
      vi.mocked(gameService.getCards).mockResolvedValue(HAND)
      vi.mocked(gameService.getBids).mockResolvedValue(BIDS)
      vi.mocked(gameService.getPlaying).mockResolvedValue(fullState({ turn: 'W' }))

      game.receivePlayingUpdate(5, compactOf(opened))

      await vi.waitFor(() => expect(game.playing?.turn).toBe('W'))
      expect(gameService.getBids).toHaveBeenCalledTimes(1)
      expect(gameService.getCards).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(game.bids).toEqual(BIDS))
    })

    test('a failed reread is left for the next event', async () => {
      const game = await loaded()
      game.cards = HAND
      game.bids = [PASS]
      vi.mocked(gameService.getCards).mockRejectedValue(new Error('down'))
      vi.mocked(gameService.getBids).mockRejectedValue(new Error('down'))
      vi.mocked(gameService.getPlaying).mockRejectedValue(new Error('down'))

      game.receivePlayingUpdate(5, compactOf(opened))

      await vi.waitFor(() => expect(gameService.getPlaying).toHaveBeenCalledTimes(2))
      expect(game.playing?.auction).toEqual([])
    })

    test('an event for a table we no longer hold is dropped', async () => {
      const game = useGameStore()
      vi.mocked(gameService.getCards).mockRejectedValue(new Error('down'))
      vi.mocked(gameService.getBids).mockResolvedValue(BIDS)

      game.receivePlayingUpdate(5, compactOf(opened))
      await vi.waitFor(() => expect(gameService.getCards).toHaveBeenCalled())
      await Promise.resolve()

      expect(gameService.getPlaying).not.toHaveBeenCalled()
      expect(game.playing).toBeNull()
    })

    test('reads the card list once and shares a request in flight', async () => {
      vi.mocked(gameService.getCards).mockResolvedValue(HAND)
      const game = useGameStore()

      const [first, second] = await Promise.all([game.loadCards(), game.loadCards()])
      await game.loadCards()

      expect(gameService.getCards).toHaveBeenCalledTimes(1)
      expect(first).toEqual(HAND)
      expect(second).toEqual(HAND)
      expect(game.cards).toEqual(HAND)
    })
  })

  test('a call sends the bid id and takes the new state it answers with', async () => {
    const game = await loaded()
    const after = fullState({ turn: 'W', acting_user_id: 4, auction: auction(ONE_HEART) })
    vi.mocked(gameService.makeCall).mockResolvedValue(after)

    await game.call(ONE_HEART.id)

    expect(gameService.makeCall).toHaveBeenCalledWith(5, 6)
    expect(game.playing).toEqual(after)
  })

  test("a call's answer does not undo a later call the channel already brought", async () => {
    const game = await loaded()
    let answer!: (state: Playing) => void
    vi.mocked(gameService.makeCall).mockReturnValue(new Promise((resolve) => (answer = resolve)))

    const calling = game.call(ONE_HEART.id)
    game.applyPlayingUpdate(5, publicState({ turn: 'N', acting_user_id: 1, auction: auction(ONE_HEART, PASS) }))
    answer(fullState({ turn: 'W', acting_user_id: 4, auction: auction(ONE_HEART) }))
    await calling

    expect(game.playing?.auction).toHaveLength(2)
    expect(game.playing?.turn).toBe('N')
    expect(game.playing?.hand).toEqual(HAND)
  })

  test('an older PlayingUpdated of the same board is ignored', async () => {
    const game = await loaded(fullState({ turn: 'N', auction: auction(ONE_HEART, PASS) }))

    game.applyPlayingUpdate(5, publicState({ turn: 'W', auction: auction(ONE_HEART) }))

    expect(game.playing?.turn).toBe('N')
    expect(game.playing?.auction).toHaveLength(2)
  })

  test('a refused call leaves the state alone and reaches the caller', async () => {
    const game = await loaded()
    const refused = Object.assign(new Error('409'), { response: { status: 409 } })
    vi.mocked(gameService.makeCall).mockRejectedValue(refused)

    await expect(game.call(ONE_HEART.id)).rejects.toBe(refused)
    expect(game.playing).toEqual(fullState())
  })

  describe('card play', () => {
    // 1♥ by North, South (the user) dummy; West has led and it is North's turn.
    const LEAD = { seat: 'W' as Seat, card: card(20, 'H', 5) }
    function inPlay(overrides: Partial<PublicPlaying> = {}): Partial<Playing> {
      return {
        phase: 'play',
        auction: auction(PASS, PASS, ONE_HEART, PASS, PASS, PASS),
        contract: { bid: ONE_HEART, doubled: 0, declarer: 'N', dummy: 'S' },
        turn: 'N',
        acting_user_id: 1,
        tricks: [],
        current_trick: [LEAD],
        tricks_won: { ns: 0, ew: 0 },
        dummy_hand: HAND,
        ...overrides,
      }
    }

    test('a card sends its id and takes the new state it answers with', async () => {
      logIn(1)
      const game = await loaded(fullState({ ...inPlay(), my_seat: 'N', hand: [card(40, 'H', 15)] }))
      const after = fullState({
        ...inPlay({ turn: 'E', acting_user_id: 2, current_trick: [LEAD, { seat: 'N', card: card(40, 'H', 15) }] }),
        my_seat: 'N',
        hand: [],
      })
      vi.mocked(gameService.playCard).mockResolvedValue(after)

      await game.play(40)

      expect(gameService.playCard).toHaveBeenCalledWith(5, 40)
      expect(game.playing).toEqual(after)
    })

    test("a card's answer does not undo a later card the channel already brought", async () => {
      logIn(1)
      const mine = { seat: 'S' as Seat, card: HAND[1] }
      const game = await loaded(fullState({ ...inPlay({ turn: 'S' }), my_seat: 'N', hand: [card(40, 'H', 15)] }))
      let answer!: (state: Playing) => void
      vi.mocked(gameService.playCard).mockReturnValue(new Promise((resolve) => (answer = resolve)))

      // Declarer plays dummy's ♥K; East follows before our answer lands.
      const playing = game.play(HAND[1].id)
      game.applyPlayingUpdate(
        5,
        publicState(inPlay({ turn: 'E', current_trick: [LEAD, mine, { seat: 'E', card: card(21, 'H', 6) }] })),
      )
      answer(fullState({ ...inPlay({ turn: 'E', current_trick: [LEAD, mine] }), my_seat: 'N' }))
      await playing

      expect(game.playing?.current_trick).toHaveLength(3)
    })

    test("dummy's own hand loses the cards declarer plays from it", async () => {
      const game = await loaded(fullState({ ...inPlay({ turn: 'S' }) }))

      game.applyPlayingUpdate(
        5,
        publicState(inPlay({ turn: 'E', current_trick: [LEAD, { seat: 'S', card: HAND[1] }], dummy_hand: [HAND[0], HAND[2]] })),
      )

      expect(game.playing?.hand).toEqual([HAND[0], HAND[2]])
      expect(game.playing?.my_seat).toBe('S')
    })
  })

  // 1♥ by North, a robot; South (the user) is dummy and plays both hands.
  describe("a robot declarer's hand", () => {
    const ROBOT_NORTH = { ...PLAYERS, N: { ...PLAYERS.N, username: 'robot-1', is_robot: true } }
    const NORTH = [card(40, 'H', 15), card(41, 'H', 2), card(10, 'D', 9)]
    const LEAD = { seat: 'E' as Seat, card: card(20, 'H', 5) }
    function inPlay(overrides: Partial<PublicPlaying> = {}): PublicPlaying {
      return publicState({
        phase: 'play',
        players: ROBOT_NORTH,
        auction: auction(PASS, PASS, ONE_HEART, PASS, PASS, PASS),
        contract: { bid: ONE_HEART, doubled: 0, declarer: 'N', dummy: 'S' },
        turn: 'E',
        acting_user_id: 2,
        tricks: [],
        current_trick: [],
        tricks_won: { ns: 0, ew: 0 },
        ...overrides,
      })
    }
    const shown = (overrides = {}) => ({
      table_id: 5,
      playing_id: 42,
      my_seat: 'S' as Seat,
      declarer: 'N' as Seat,
      declarer_hand: NORTH,
      ...overrides,
    })

    test('load keeps it with the rest of our state', async () => {
      const game = await loaded({ ...inPlay(), my_seat: 'S', hand: HAND, declarer_hand: NORTH })

      expect(game.playing?.declarer_hand).toEqual(NORTH)
    })

    test('DeclarerHandShown brings it to the board we hold, and only to that one', async () => {
      // Watching the user channel comes first (from login): it starts afresh.
      useGameStore().watchUser(3)
      const onDeclarerHand = vi.mocked(echo.listenToUser).mock.calls[0][3]
      const game = await loaded({ ...inPlay(), my_seat: 'S', hand: HAND, declarer_hand: null })

      onDeclarerHand(shown({ playing_id: 41 }))
      onDeclarerHand(shown({ table_id: 6 }))
      expect(game.playing?.declarer_hand).toBeNull()

      onDeclarerHand(shown())
      expect(game.playing?.declarer_hand).toEqual(NORTH)
    })

    test('a late DeclarerHandShown leaves out the cards already played', async () => {
      const lead = { seat: 'N' as Seat, card: NORTH[0] }
      const game = await loaded({ ...inPlay({ current_trick: [LEAD, lead] }), my_seat: 'S', hand: HAND, declarer_hand: null })

      game.applyDeclarerHand(shown())

      expect(game.playing?.declarer_hand).toEqual([NORTH[1], NORTH[2]])
    })

    test('nothing to bring it to before a board is held', () => {
      const game = useGameStore()

      game.applyDeclarerHand(shown())

      expect(game.playing).toBeNull()
    })

    test('PlayingUpdated carries it over, less the cards played from it', async () => {
      const game = await loaded({ ...inPlay({ turn: 'N', acting_user_id: 3, current_trick: [LEAD] }), my_seat: 'S', hand: HAND, declarer_hand: NORTH })

      game.applyPlayingUpdate(5, inPlay({ turn: 'W', acting_user_id: 4, current_trick: [LEAD, { seat: 'N', card: NORTH[1] }] }))

      expect(game.playing?.declarer_hand).toEqual([NORTH[0], NORTH[2]])
      expect(game.playing?.hand).toEqual(HAND)
    })

    test('it goes once the board is finished, and never comes over to another board', async () => {
      const game = await loaded({ ...inPlay(), my_seat: 'S', hand: HAND, declarer_hand: NORTH })

      game.applyPlayingUpdate(5, inPlay({ phase: 'finished', turn: null, acting_user_id: null }))
      expect(game.playing?.declarer_hand).toBeNull()

      game.applyPlayingUpdate(5, inPlay({ playing_id: 43, phase: 'auction', contract: null, turn: 'S', acting_user_id: 3 }))
      expect(game.playing?.declarer_hand).toBeNull()
    })

    test("the answer to our card from declarer's hand takes the new one", async () => {
      const game = await loaded({ ...inPlay({ turn: 'N', acting_user_id: 3, current_trick: [LEAD] }), my_seat: 'S', hand: HAND, declarer_hand: NORTH })
      const after: Playing = {
        ...inPlay({ turn: 'W', acting_user_id: 4, current_trick: [LEAD, { seat: 'N', card: NORTH[0] }] }),
        my_seat: 'S',
        hand: HAND,
        declarer_hand: [NORTH[1], NORTH[2]],
      }
      vi.mocked(gameService.playCard).mockResolvedValue(after)

      await game.play(NORTH[0].id)

      expect(gameService.playCard).toHaveBeenCalledWith(5, NORTH[0].id)
      expect(game.playing?.declarer_hand).toEqual([NORTH[1], NORTH[2]])
    })
  })

  describe('between boards', () => {
    const RESULT = { contract: ONE_HEART, doubled: 0 as const, declarer: 'S' as Seat, tricks_won: 7, score_ns: 80, made_by: 0 }

    function finished(ready: Seat[]): Playing {
      return fullState({ phase: 'finished', turn: null, acting_user_id: null, result: RESULT, ready, hand: [] })
    }

    test('asking for the next board takes the finished board with our seat ready', async () => {
      const game = await loaded(finished(['N']))
      vi.mocked(gameService.nextBoard).mockResolvedValue(finished(['N', 'S']))

      await game.next()

      expect(gameService.nextBoard).toHaveBeenCalledWith(5)
      expect(game.playing?.ready).toEqual(['N', 'S'])
    })

    test('the last one to ask gets the new board in the answer', async () => {
      const game = await loaded(finished(['N', 'E', 'W']))
      const next = fullState({ playing_id: 43, board: { id: 8, number: 8, dealer: 'E', vulnerable: '' } })
      vi.mocked(gameService.nextBoard).mockResolvedValue(next)

      await game.next()

      expect(game.playing).toEqual(next)
    })

    test('an older ready list from the channel does not undo ours', async () => {
      const game = await loaded(finished(['N']))
      vi.mocked(gameService.nextBoard).mockResolvedValue(finished(['N', 'S']))
      await game.next()

      game.applyPlayingUpdate(5, publicState({ ...finished(['N']) }))

      expect(game.playing?.ready).toEqual(['N', 'S'])
    })

    test('phaseOf answers only for the table held', async () => {
      const game = await loaded(finished([]))

      expect(game.phaseOf(5)).toBe('finished')
      expect(game.phaseOf(6)).toBeNull()
    })
  })
})
