import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { useAuthStore } from '@/stores/auth'
import { useTablesStore } from '@/stores/tables'
import * as gameService from '@/services/game'
import * as historyService from '@/services/history'
import * as tablesService from '@/services/tables'
import * as echo from '@/services/echo'
import type { AuctionCall, Bid, Card, Playing, PublicPlaying } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
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

    const [id, onTable, onPlaying] = vi.mocked(echo.listenToTable).mock.calls[0]
    expect(id).toBe(5)
    onPlaying(publicState({ turn: 'W' }))
    expect(game.playing?.turn).toBe('W')

    onTable(makeTable(['N', 'S', 'W'], null))
    expect(game.playing?.phase).toBe('waiting')
  })

  test('follows the user channel once and leaves it on unwatch', () => {
    const game = useGameStore()

    game.watchUser(3)
    game.watchUser(3)
    expect(echo.listenToUser).toHaveBeenCalledTimes(1)
    expect(echo.listenToUser).toHaveBeenCalledWith(3, expect.any(Function))

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

  describe('between boards', () => {
    const RESULT = { contract: ONE_HEART, doubled: 0 as const, declarer: 'S' as Seat, tricks_won: 7, score_ns: 80, made_by: 0 }

    function finished(ready: Seat[]): Playing {
      return fullState({ phase: 'finished', turn: null, acting_user_id: null, result: RESULT, ready, hand: [] })
    }

    function historyPage(rows: { table_id: number | null; score_ns: number }[], next: boolean) {
      return {
        current_page: 1,
        data: rows.map((row, i) => ({
          playing_id: i + 1,
          board: { id: 1, number: 1, dealer: 'N' as Seat, vulnerable: '' as const },
          seat: 'S' as Seat,
          partner: PLAYERS.N,
          contract: null,
          doubled: null,
          declarer: null,
          tricks_won: null,
          made_by: null,
          score: row.score_ns,
          finished_at: '',
          ...row,
        })),
        last_page: next ? 2 : 1,
        next_page_url: next ? 'next' : null,
        per_page: 20,
        total: rows.length,
      }
    }

    test('asking for the next board takes the finished board with our seat ready', async () => {
      const game = await loaded(finished(['N']))
      vi.mocked(gameService.nextBoard).mockResolvedValue(finished(['N', 'S']))

      await game.next()

      expect(gameService.nextBoard).toHaveBeenCalledWith(5, false)
      expect(game.playing?.ready).toEqual(['N', 'S'])
    })

    test('a manager asks for everyone; the answer is the new board', async () => {
      const game = await loaded(finished([]))
      const next = fullState({ playing_id: 43, board: { id: 8, number: 8, dealer: 'E', vulnerable: '' } })
      vi.mocked(gameService.nextBoard).mockResolvedValue(next)

      await game.next(true)

      expect(gameService.nextBoard).toHaveBeenCalledWith(5, true)
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

    test('the session score sums the latest boards at this table, across pages', async () => {
      const game = useGameStore()
      vi.mocked(historyService.getMyPlayings)
        .mockResolvedValueOnce(historyPage([{ table_id: 5, score_ns: 450 }, { table_id: 5, score_ns: -100 }], true))
        .mockResolvedValueOnce(historyPage([{ table_id: 5, score_ns: 50 }, { table_id: 2, score_ns: 620 }], true))

      await game.loadSessionScore(5)

      expect(historyService.getMyPlayings).toHaveBeenCalledTimes(2)
      expect(game.session).toEqual({ tableId: 5, boards: 3, ns: 400, mine: 400 })
    })

    test('the session score stops at the last page', async () => {
      const game = useGameStore()
      vi.mocked(historyService.getMyPlayings).mockResolvedValueOnce(historyPage([{ table_id: 5, score_ns: 420 }], false))

      await game.loadSessionScore(5)

      expect(historyService.getMyPlayings).toHaveBeenCalledTimes(1)
      expect(game.session).toEqual({ tableId: 5, boards: 1, ns: 420, mine: 420 })
    })
  })
})
