import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import router from '@/router'
import { routeLoading } from '@/router/loading'
import { fetchUser } from '@/services/auth'
import { getBids, getCards } from '@/services/game'
import type { Bid } from '@/services/game'
import * as tablesService from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useTablesStore } from '@/stores/tables'

// The pages themselves don't matter here, only where the guard lets you go
// (and the prefetch a second after the first page loads every one of them).
vi.mock('@/views/AccountPage.vue', () => ({ default: {} }))
vi.mock('@/views/BoardResultsPage.vue', () => ({ default: {} }))
vi.mock('@/views/CreateAccountPage.vue', () => ({ default: {} }))
vi.mock('@/views/HistoryPage.vue', () => ({ default: {} }))
vi.mock('@/views/HomePage.vue', () => ({ default: {} }))
vi.mock('@/views/LoginPage.vue', () => ({ default: {} }))
vi.mock('@/views/PlayingReviewPage.vue', () => ({ default: {} }))
vi.mock('@/views/ResetPasswordPage.vue', () => ({ default: {} }))
vi.mock('@/views/SetResultsPage.vue', () => ({ default: {} }))
vi.mock('@/views/TablePlayPage.vue', () => ({ default: {} }))
vi.mock('@/views/TablesPage.vue', () => ({ default: {} }))
vi.mock('@/views/UserProfilePage.vue', () => ({ default: {} }))
vi.mock('@/services/auth', () => ({ fetchUser: vi.fn() }))
vi.mock('@/services/game', () => ({ getBids: vi.fn(), getCards: vi.fn() }))
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
}))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))

const ana = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
const pass = { id: 1, call: 'P' } as unknown as Bid

function asGuest() {
  vi.mocked(fetchUser).mockRejectedValue(new Error('401'))
}

function asAna() {
  vi.mocked(fetchUser).mockResolvedValue(ana)
}

// A fresh Pinia is a fresh page load as far as the guard knows: the session
// is looked up again and no bids are held.
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  vi.mocked(getBids).mockResolvedValue([pass])
  vi.mocked(getCards).mockResolvedValue([{ id: 1, suit: 'C', rank: 2, rank_name: '2' }])
  vi.mocked(tablesService.listTables).mockResolvedValue([])
})

// One router serves the whole file, so let its background timers run out and
// leave it on a page every test navigates away from.
afterEach(async () => {
  await vi.runAllTimersAsync()
  asGuest()
  await router.push('/reset-password')
  vi.useRealTimers()
})

describe('router guard', () => {
  test('/ goes to /home', async () => {
    asGuest()
    await router.push('/')

    expect(router.currentRoute.value.path).toBe('/home')
  })

  test("a table's old page goes to its game table (#181), with the game table's meta", async () => {
    asAna()
    await router.push('/tables/7?from=bookmark')

    expect(router.currentRoute.value.path).toBe('/tables/7/play')
    expect(router.currentRoute.value.meta).toEqual({ requiresAuth: true, notBanned: true, findsSeat: true })
  })

  test('sends a guest from a requiresAuth page to /login', async () => {
    asGuest()
    await router.push('/tables')

    expect(router.currentRoute.value.path).toBe('/login')
  })

  test('sends a logged-in user from a guestOnly page to /account', async () => {
    asAna()
    await router.push('/login')

    expect(router.currentRoute.value.path).toBe('/account')
  })

  test('lets a restored session straight into a requiresAuth page', async () => {
    asAna()
    await router.push('/tables/3/play')

    expect(router.currentRoute.value.path).toBe('/tables/3/play')
  })

  test('asks the backend for the session only once per page load', async () => {
    asAna()
    await router.push('/tables')
    await router.push('/account')
    await router.push('/home')

    expect(fetchUser).toHaveBeenCalledTimes(1)
  })

  test('the loading flag is down once the navigation is done', async () => {
    asGuest()
    await router.push('/home')
    await vi.advanceTimersByTimeAsync(200)

    expect(routeLoading.value).toBe(false)
  })
})

describe('bid and card prefetch', () => {
  test('reads both lists a second after a logged-in page shows, once', async () => {
    asAna()
    await router.push('/tables')
    expect(getBids).not.toHaveBeenCalled()
    expect(getCards).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(getBids).toHaveBeenCalledTimes(1)
    expect(getCards).toHaveBeenCalledTimes(1)

    await router.push('/account')
    await vi.advanceTimersByTimeAsync(1000)
    expect(getBids).toHaveBeenCalledTimes(1)
    expect(getCards).toHaveBeenCalledTimes(1)
  })

  test('never reads it for a guest', async () => {
    asGuest()
    await router.push('/home')
    await vi.advanceTimersByTimeAsync(1000)

    expect(getBids).not.toHaveBeenCalled()
    expect(getCards).not.toHaveBeenCalled()
  })

  test('a failed prefetch is swallowed and tried again on a later page', async () => {
    asAna()
    vi.mocked(getBids).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(getCards).mockRejectedValueOnce(new Error('offline'))
    await router.push('/tables')
    await vi.advanceTimersByTimeAsync(1000)
    expect(getBids).toHaveBeenCalledTimes(1)
    expect(getCards).toHaveBeenCalledTimes(1)

    await router.push('/history')
    await vi.advanceTimersByTimeAsync(1000)
    expect(getBids).toHaveBeenCalledTimes(2)
    expect(getCards).toHaveBeenCalledTimes(2)
  })
})

describe('finding the seat for "Your table"', () => {
  test('a reload on a page that loads no table asks where the user sits', async () => {
    asAna()
    await router.push('/history')

    expect(tablesService.listTables).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(useTablesStore().loaded).toBe(true)

    // Known now: no more asking on the next pages.
    await router.push('/account')
    expect(tablesService.listTables).toHaveBeenCalledTimes(1)
  })

  test('leaves it to a page that finds the seat itself', async () => {
    asAna()
    await router.push('/tables/3/play')
    await router.push('/tables')
    await router.push('/home')

    expect(tablesService.listTables).not.toHaveBeenCalled()
  })

  test('never asks for a guest or a banned user', async () => {
    asGuest()
    await router.push('/reset-password')
    expect(tablesService.listTables).not.toHaveBeenCalled()

    setActivePinia(createPinia())
    vi.mocked(fetchUser).mockResolvedValue({
      ...ana,
      ban: { reason: 'x', until: '2026-12-01', banned_at: '2026-10-01' },
    })
    await router.push('/history')
    expect(useAuthStore().isBanned).toBe(true)
    expect(tablesService.listTables).not.toHaveBeenCalled()
  })
})
