import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  navigateAndSettle,
  navigationEnded,
  navigationStarted,
  nextNavigationSettled,
  routeLoading,
} from '@/router/loading'
import type { UseIonRouterResult } from '@ionic/vue'

describe('route loading indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    navigationEnded()
    vi.useRealTimers()
  })

  test('stays hidden for fast navigations', () => {
    navigationStarted('/tables')
    vi.advanceTimersByTime(100)
    navigationEnded('/tables')
    vi.advanceTimersByTime(500)

    expect(routeLoading.value).toBe(false)
  })

  test('shows after 150 ms and hides when the navigation ends', () => {
    navigationStarted('/tables')
    vi.advanceTimersByTime(150)
    expect(routeLoading.value).toBe(true)

    navigationEnded('/tables')
    expect(routeLoading.value).toBe(false)
  })

  test('a guard redirect keeps it running until the redirect target is reached', () => {
    navigationStarted('/account')
    navigationStarted('/login')
    vi.advanceTimersByTime(150)

    navigationEnded('/account')
    expect(routeLoading.value).toBe(true)

    navigationEnded('/login')
    expect(routeLoading.value).toBe(false)
  })

  test('a chunk-load error always ends it', () => {
    navigationStarted('/tables')
    vi.advanceTimersByTime(150)

    navigationEnded()
    expect(routeLoading.value).toBe(false)
  })

  test('nextNavigationSettled resolves only once the navigation ends', async () => {
    const settled = vi.fn()
    nextNavigationSettled().then(settled)
    navigationStarted('/account')
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    navigationEnded('/account')
    await Promise.resolve()
    expect(settled).toHaveBeenCalled()
  })

  test('navigateAndSettle navigates with Ionic and waits for the route', async () => {
    const navigate = vi.fn()
    const done = vi.fn()
    navigateAndSettle({ navigate } as unknown as UseIonRouterResult, '/account').then(done)

    expect(navigate).toHaveBeenCalledWith('/account', 'root', 'replace')
    navigationStarted('/account')
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()

    navigationEnded('/account')
    await Promise.resolve()
    expect(done).toHaveBeenCalled()
  })
})
