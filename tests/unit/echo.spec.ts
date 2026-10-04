import { beforeEach, describe, expect, test, vi } from 'vitest'
import Echo from 'laravel-echo'
import http from '@/services/http'
import {
  disconnectEcho,
  getEcho,
  leaveTable,
  leaveUser,
  listenToTable,
  listenToUser,
  onReconnect,
} from '@/services/echo'
import { isLive, liveStatus } from '@/services/liveStatus'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

// A stand-in for Laravel Echo: records its options, the channels asked for
// and the connection listener, so the tests can play the socket's part.
const channel = { listen: vi.fn(), subscribed: vi.fn(), error: vi.fn() }
let connectionListener: (status: string) => void = () => {}
const stopWatching = vi.fn()
vi.mock('laravel-echo', () => ({
  default: vi.fn().mockImplementation(() => ({
    private: vi.fn(() => channel),
    leave: vi.fn(),
    disconnect: vi.fn(),
    connector: {
      onConnectionChange: vi.fn((listener: (status: string) => void) => {
        connectionListener = listener
        return stopWatching
      }),
    },
  })),
}))
vi.mock('pusher-js', () => ({ default: vi.fn() }))

type EchoOptions = {
  broadcaster: string
  authorizer: (channel: { name: string }) => {
    authorize: (socketId: string, callback: (error: unknown, data: unknown) => void) => void
  }
}

function lastOptions(): EchoOptions {
  return vi.mocked(Echo).mock.calls.at(-1)![0] as unknown as EchoOptions
}

beforeEach(() => {
  disconnectEcho()
  vi.clearAllMocks()
  channel.listen.mockReturnValue(channel)
  channel.subscribed.mockReturnValue(channel)
  channel.error.mockReturnValue(channel)
})

// Pusher's answers to the table subscription, as listenToTable registered them.
function confirmSubscription() {
  channel.subscribed.mock.calls.at(-1)![0]()
}
function refuseSubscription() {
  channel.error.mock.calls.at(-1)![0]({ status: 403 })
}

describe('echo service', () => {
  test('creates one Reverb connection on first use and reuses it', () => {
    const first = getEcho()

    expect(getEcho()).toBe(first)
    expect(Echo).toHaveBeenCalledTimes(1)
    expect(lastOptions().broadcaster).toBe('reverb')
  })

  test('signs private channels through the shared axios instance', async () => {
    getEcho()
    vi.mocked(http.get).mockResolvedValue({})
    vi.mocked(http.post).mockResolvedValue({ data: { auth: 'signed' } })
    const callback = vi.fn()

    lastOptions().authorizer({ name: 'private-table.3' }).authorize('1.2', callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalled())

    expect(http.get).toHaveBeenCalledWith('/sanctum/csrf-cookie')
    expect(http.post).toHaveBeenCalledWith('/broadcasting/auth', {
      socket_id: '1.2',
      channel_name: 'private-table.3',
    })
    expect(callback).toHaveBeenCalledWith(null, { auth: 'signed' })
  })

  test('hands a failed signature to Pusher as an error', async () => {
    getEcho()
    const failure = new Error('403')
    vi.mocked(http.get).mockResolvedValue({})
    vi.mocked(http.post).mockRejectedValue(failure)
    const callback = vi.fn()

    lastOptions().authorizer({ name: 'private-table.3' }).authorize('1.2', callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalled())

    expect(callback).toHaveBeenCalledWith(failure, null)
  })

  test('tells reconnect listeners only after a drop, not on the first connection', () => {
    getEcho()
    const listener = vi.fn()
    const stop = onReconnect(listener)

    connectionListener('connecting')
    connectionListener('connected')
    expect(listener).not.toHaveBeenCalled()

    connectionListener('connected')
    expect(listener).not.toHaveBeenCalled()

    connectionListener('unavailable')
    connectionListener('connected')
    expect(listener).toHaveBeenCalledTimes(1)

    stop()
    connectionListener('unavailable')
    connectionListener('connected')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('listenToTable passes on the table and the public game state', () => {
    const onUpdate = vi.fn()
    const onPlaying = vi.fn()
    listenToTable(3, onUpdate, onPlaying)

    expect(getEcho().private).toHaveBeenCalledWith('table.3')
    const handlers = Object.fromEntries(channel.listen.mock.calls)
    handlers.TableUpdated({ table: { id: 3 } })
    handlers.PlayingUpdated({ playing: { playing_id: 5 } })

    expect(onUpdate).toHaveBeenCalledWith({ id: 3 })
    expect(onPlaying).toHaveBeenCalledWith({ playing_id: 5 })
  })

  test('a table is live once the socket is connected and its channel subscribed', () => {
    listenToTable(3, vi.fn(), vi.fn())
    connectionListener('connecting')
    expect(liveStatus.connection).toBe('connecting')
    expect(isLive(3)).toBe(false)

    connectionListener('connected')
    expect(isLive(3)).toBe(false)

    confirmSubscription()
    expect(isLive(3)).toBe(true)
    expect(isLive(4)).toBe(false)
  })

  test('a dropped socket is not live until Pusher confirms the channel again', () => {
    listenToTable(3, vi.fn(), vi.fn())
    connectionListener('connected')
    confirmSubscription()

    connectionListener('failed')
    expect(isLive(3)).toBe(false)

    connectionListener('connected')
    expect(isLive(3)).toBe(false)

    confirmSubscription()
    expect(isLive(3)).toBe(true)
  })

  test('a refused subscription is not live', () => {
    listenToTable(3, vi.fn(), vi.fn())
    connectionListener('connected')

    refuseSubscription()

    expect(isLive(3)).toBe(false)
  })

  test("leaving the channel or the socket ends live updates, another table's error doesn't", () => {
    listenToTable(3, vi.fn(), vi.fn())
    connectionListener('connected')
    confirmSubscription()

    listenToTable(4, vi.fn(), vi.fn())
    refuseSubscription()
    expect(isLive(3)).toBe(true)

    leaveTable(3)
    expect(isLive(3)).toBe(false)

    confirmSubscription()
    disconnectEcho()
    expect(liveStatus.connection).toBe('initialized')
    expect(liveStatus.subscribedTable).toBeNull()
  })

  test('listenToUser follows HandDealt, DeclarerHandShown and UserBanned on the user channel', () => {
    const onHandDealt = vi.fn()
    const onBanned = vi.fn()
    const onDeclarerHand = vi.fn()
    listenToUser(1, onHandDealt, onBanned, onDeclarerHand)

    expect(getEcho().private).toHaveBeenCalledWith('App.Models.User.1')
    expect(channel.listen).toHaveBeenCalledWith('HandDealt', onHandDealt)
    expect(channel.listen).toHaveBeenCalledWith('DeclarerHandShown', onDeclarerHand)
    expect(channel.listen).toHaveBeenCalledWith('UserBanned', onBanned)
  })

  test('leaves channels, and leaving before any connection is a no-op', () => {
    expect(() => leaveTable(3)).not.toThrow()

    const echo = getEcho()
    leaveTable(3)
    leaveUser(1)

    expect(echo.leave).toHaveBeenCalledWith('table.3')
    expect(echo.leave).toHaveBeenCalledWith('App.Models.User.1')
  })

  test('disconnectEcho closes the socket and the next use opens a new one', () => {
    const echo = getEcho()
    disconnectEcho()

    expect(stopWatching).toHaveBeenCalled()
    expect(echo.disconnect).toHaveBeenCalled()
    expect(getEcho()).not.toBe(echo)
  })
})
