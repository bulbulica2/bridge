import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useGameStore } from '@/stores/game'
import { useAuthStore } from '@/stores/auth'
import { useTablesStore } from '@/stores/tables'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import * as echo from '@/services/echo'
import type { Card, Playing, PublicPlaying } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import { showToast } from '@/utils/toast'

vi.mock('@/services/game', () => ({ getPlaying: vi.fn() }))

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
})
