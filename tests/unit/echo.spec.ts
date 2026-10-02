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

vi.mock('@/services/http', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

// A stand-in for Laravel Echo: records its options, the channels asked for
// and the connection listener, so the tests can play the socket's part.
const channel = { listen: vi.fn() }
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
})

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

  test('listenToUser follows HandDealt on the user channel', () => {
    const onHandDealt = vi.fn()
    listenToUser(1, onHandDealt)

    expect(getEcho().private).toHaveBeenCalledWith('App.Models.User.1')
    expect(channel.listen).toHaveBeenCalledWith('HandDealt', onHandDealt)
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
