import { beforeEach, describe, expect, test, vi } from 'vitest'
import http from '@/services/http'
import * as auth from '@/services/auth'
import * as tables from '@/services/tables'
import * as game from '@/services/game'
import * as chat from '@/services/chat'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

// The stores' tests mock these modules away, so this is where each wrapper is
// checked against the endpoint it calls (bridge_backend docs/API.md) and the
// part of the answer it returns.
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

const payload = { id: 7 }

beforeEach(() => {
  vi.resetAllMocks()
  // The game endpoints' envelope; auth's status answers ride along unused.
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as Method[]) {
    vi.mocked(http[method]).mockResolvedValue({ data: { status: 'Sent.', message: 'OK', data: payload } })
  }
})

// The request that isn't the CSRF cookie: the one the wrapper exists for.
function mainCall(method: Method) {
  const calls = vi.mocked(http[method]).mock.calls
  return calls.find(([url]) => url !== '/sanctum/csrf-cookie')
}

function fetchedCsrf() {
  return vi.mocked(http.get).mock.calls.some(([url]) => url === '/sanctum/csrf-cookie')
}

describe('auth service', () => {
  test('register fetches the CSRF cookie, then posts the form', async () => {
    const data = { name: 'Ana', username: 'ana', email: 'a@x.ro', password: 'pw', password_confirmation: 'pw' }
    await auth.register(data)

    expect(fetchedCsrf()).toBe(true)
    expect(http.post).toHaveBeenCalledWith('/register', data)
  })

  test('logout refreshes the CSRF cookie before posting', async () => {
    await auth.logout()

    expect(fetchedCsrf()).toBe(true)
    expect(http.post).toHaveBeenCalledWith('/logout')
  })

  test('fetchUser returns /api/user as is, no envelope', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: { id: 1, name: 'Ana' } })

    await expect(auth.fetchUser()).resolves.toEqual({ id: 1, name: 'Ana' })
    expect(http.get).toHaveBeenCalledWith('/api/user')
  })

  test('requestPasswordReset returns the backend status line', async () => {
    await expect(auth.requestPasswordReset({ email: 'a@x.ro' })).resolves.toBe('Sent.')
    expect(fetchedCsrf()).toBe(true)
    expect(http.post).toHaveBeenCalledWith('/forgot-password', { email: 'a@x.ro' })
  })

  test('resetPassword returns the backend status line', async () => {
    const data = { token: 't', email: 'a@x.ro', password: 'pw', password_confirmation: 'pw' }

    await expect(auth.resetPassword(data)).resolves.toBe('Sent.')
    expect(http.post).toHaveBeenCalledWith('/reset-password', data)
  })

  test('updateProfile patches /api/user and unwraps the envelope', async () => {
    await expect(auth.updateProfile({ name: 'Ana', description: null })).resolves.toEqual(payload)
    expect(fetchedCsrf()).toBe(true)
    expect(http.patch).toHaveBeenCalledWith('/api/user', { name: 'Ana', description: null })
  })
})

// [name, call, method, url, body (undefined = none), needs the CSRF cookie]
const wrappers: [string, () => Promise<unknown>, Method, string, unknown, boolean][] = [
  ['listTables', () => tables.listTables(), 'get', '/tables', undefined, false],
  ['createTable', () => tables.createTable({ robots: true }), 'post', '/tables', { seat: 'S', robots: true }, true],
  ['createTable at a given seat', () => tables.createTable({ seat: 'E' }), 'post', '/tables', { seat: 'E' }, true],
  [
    'createTable with a time for the set',
    () => tables.createTable({ set_minutes: 8 }),
    'post',
    '/tables',
    { seat: 'S', set_minutes: 8 },
    true,
  ],
  ['updateTable', () => tables.updateTable(3, { set_minutes: 20 }), 'patch', '/tables/3', { set_minutes: 20 }, true],
  ['joinSeat', () => tables.joinSeat(3, 'E'), 'post', '/tables/3/seats', { seat: 'E' }, true],
  ['getTable', () => tables.getTable(3), 'get', '/tables/3', undefined, false],
  ['leaveSeat', () => tables.leaveSeat(3), 'delete', '/tables/3/seats', undefined, true],
  ['removePlayer', () => tables.removePlayer(3, 9), 'delete', '/tables/3/seats/9', undefined, true],
  ['seatUser', () => tables.seatUser(3, 9, 'W'), 'post', '/tables/3/seats/users', { user_id: 9, seat: 'W' }, true],
  ['seatRobot', () => tables.seatRobot(3, 'N'), 'post', '/tables/3/seats/robots', { seat: 'N' }, true],
  ['startTable', () => tables.startTable(3), 'post', '/tables/3/start', undefined, true],
  ['cancelStart', () => tables.cancelStart(3), 'delete', '/tables/3/start', undefined, true],
  ['getPlaying', () => game.getPlaying(3), 'get', '/tables/3/playing', undefined, false],
  ['getBids', () => game.getBids(), 'get', '/bids', undefined, false],
  ['getCards', () => game.getCards(), 'get', '/cards', undefined, false],
  ['makeCall', () => game.makeCall(3, 12), 'post', '/tables/3/calls', { bid_id: 12 }, false],
  [
    'makeCall alerted',
    () => game.makeCall(3, 12, { alert: true, explanation: 'Stayman' }),
    'post',
    '/tables/3/calls',
    { bid_id: 12, alert: true, explanation: 'Stayman' },
    false,
  ],
  [
    'makeCall not alerted',
    () => game.makeCall(3, 12, { alert: false, explanation: null }),
    'post',
    '/tables/3/calls',
    { bid_id: 12 },
    false,
  ],
  ['askAboutCall', () => game.askAboutCall(3, 4), 'post', '/tables/3/calls/4/question', undefined, false],
  [
    'explainCall',
    () => game.explainCall(3, 4, 'Natural'),
    'put',
    '/tables/3/calls/4/explanation',
    { explanation: 'Natural' },
    false,
  ],
  ['playCard', () => game.playCard(3, 40), 'post', '/tables/3/cards', { card_id: 40 }, false],
  ['nextBoard', () => game.nextBoard(3), 'post', '/tables/3/playing/next', undefined, false],
  ['makeClaim', () => game.makeClaim(3, 0), 'post', '/tables/3/claim', { tricks: 0 }, false],
  ['respondToClaim', () => game.respondToClaim(3, false), 'post', '/tables/3/claim/response', { accept: false }, false],
  ['withdrawClaim', () => game.withdrawClaim(3), 'delete', '/tables/3/claim', undefined, false],
]

describe('table and game services', () => {
  test.each(wrappers)('%s calls its endpoint and unwraps the envelope', async (_, call, method, url, body, csrf) => {
    await expect(call()).resolves.toEqual(payload)

    const [calledUrl, calledBody] = mainCall(method)!
    expect(calledUrl).toBe(url)
    expect(calledBody).toEqual(body)
    expect(fetchedCsrf()).toBe(csrf)
  })

  test('sendHeartbeat posts and returns nothing', async () => {
    await expect(tables.sendHeartbeat(3)).resolves.toBeUndefined()
    expect(http.post).toHaveBeenCalledWith('/tables/3/heartbeat')
  })

  test('isTableDeleted tells a deleted table from a table', () => {
    expect(tables.isTableDeleted({ table_deleted: true })).toBe(true)
    expect(tables.isTableDeleted({ id: 3 } as tables.Table)).toBe(false)
  })
})

describe('chat service', () => {
  test('getMessages reads the current board chat', async () => {
    await expect(chat.getMessages(3)).resolves.toEqual(payload)
    expect(http.get).toHaveBeenCalledWith('/tables/3/messages')
  })

  test('sendMessage posts the body and recipients, with the call only when there is one', async () => {
    await expect(chat.sendMessage(3, { body: 'Hi', to: 'table' })).resolves.toEqual(payload)
    expect(http.post).toHaveBeenLastCalledWith('/tables/3/messages', { body: 'Hi', to: 'table' })

    await chat.sendMessage(3, { body: 'What is it?', to: 'opponents', call_index: 0 })
    expect(http.post).toHaveBeenLastCalledWith('/tables/3/messages', {
      body: 'What is it?',
      to: 'opponents',
      call_index: 0,
    })

    await chat.sendMessage(3, { body: 'Hi', to: 'opponents', call_index: null })
    expect(http.post).toHaveBeenLastCalledWith('/tables/3/messages', { body: 'Hi', to: 'opponents' })
  })
})
