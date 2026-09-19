import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth'
import * as authService from '@/services/auth'

vi.mock('@/services/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  fetchUser: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}))

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  test('login stores the current user', async () => {
    const user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
    vi.mocked(authService.fetchUser).mockResolvedValue(user)

    const auth = useAuthStore()
    await auth.login({ email: 'ana@example.com', password: 'secret' })

    expect(authService.login).toHaveBeenCalledWith({ email: 'ana@example.com', password: 'secret' })
    expect(auth.user).toEqual(user)
    expect(auth.isAuthenticated).toBe(true)
  })

  test('failed login leaves the user logged out', async () => {
    vi.mocked(authService.login).mockRejectedValue(new Error('422'))

    const auth = useAuthStore()
    await expect(auth.login({ email: 'x@example.com', password: 'bad' })).rejects.toThrow()

    expect(auth.isAuthenticated).toBe(false)
  })

  test('register stores the new user', async () => {
    const user = { id: 2, name: 'Bob', username: 'bob', email: 'bob@example.com' }
    vi.mocked(authService.fetchUser).mockResolvedValue(user)
    const data = {
      name: 'Bob',
      username: 'bob',
      email: 'bob@example.com',
      password: 'secret123',
      password_confirmation: 'secret123',
    }

    const auth = useAuthStore()
    await auth.register(data)

    expect(authService.register).toHaveBeenCalledWith(data)
    expect(auth.user).toEqual(user)
    expect(auth.isAuthenticated).toBe(true)
  })

  test('failed registration leaves the user logged out', async () => {
    vi.mocked(authService.register).mockRejectedValue(new Error('422'))

    const auth = useAuthStore()
    await expect(auth.register({
      name: 'Bob',
      username: 'bob',
      email: 'taken@example.com',
      password: 'secret123',
      password_confirmation: 'secret123',
    })).rejects.toThrow()

    expect(authService.fetchUser).not.toHaveBeenCalled()
    expect(auth.isAuthenticated).toBe(false)
  })

  test('logout clears the user', async () => {
    const user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
    vi.mocked(authService.fetchUser).mockResolvedValue(user)

    const auth = useAuthStore()
    await auth.loadSession()
    await auth.logout()

    expect(authService.logout).toHaveBeenCalled()
    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
  })

  test('logout clears the user even when the request fails', async () => {
    const user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
    vi.mocked(authService.fetchUser).mockResolvedValue(user)
    vi.mocked(authService.logout).mockRejectedValue(new Error('network'))

    const auth = useAuthStore()
    await auth.loadSession()
    await expect(auth.logout()).rejects.toThrow()

    expect(auth.isAuthenticated).toBe(false)
  })

  test('loadSession restores the user from a live session', async () => {
    const user = { id: 3, name: 'Cara', username: 'cara', email: 'cara@example.com' }
    vi.mocked(authService.fetchUser).mockResolvedValue(user)

    const auth = useAuthStore()
    await auth.loadSession()

    expect(auth.user).toEqual(user)
    expect(auth.isAuthenticated).toBe(true)
  })

  test('loadSession leaves the user logged out when there is no session', async () => {
    vi.mocked(authService.fetchUser).mockRejectedValue(new Error('401'))

    const auth = useAuthStore()
    await auth.loadSession()

    expect(auth.user).toBeNull()
    expect(auth.isAuthenticated).toBe(false)
  })

  test('loadSession only asks the backend once per page load', async () => {
    const user = { id: 3, name: 'Cara', username: 'cara', email: 'cara@example.com' }
    vi.mocked(authService.fetchUser).mockResolvedValue(user)

    const auth = useAuthStore()
    await Promise.all([auth.loadSession(), auth.loadSession()])
    await auth.loadSession()

    expect(authService.fetchUser).toHaveBeenCalledTimes(1)
  })

  test('requesting a reset link returns the backend status and does not log anyone in', async () => {
    vi.mocked(authService.requestPasswordReset).mockResolvedValue(
      'We have emailed your password reset link.',
    )

    const auth = useAuthStore()
    const status = await auth.requestPasswordReset({ email: 'ana@example.com' })

    expect(authService.requestPasswordReset).toHaveBeenCalledWith({ email: 'ana@example.com' })
    expect(status).toBe('We have emailed your password reset link.')
    expect(authService.fetchUser).not.toHaveBeenCalled()
    expect(auth.isAuthenticated).toBe(false)
  })

  test('an unknown email surfaces the backend validation error', async () => {
    vi.mocked(authService.requestPasswordReset).mockRejectedValue(new Error('422'))

    const auth = useAuthStore()
    await expect(auth.requestPasswordReset({ email: 'nobody@example.com' })).rejects.toThrow()

    expect(auth.isAuthenticated).toBe(false)
  })

  test('resetting the password returns the status but leaves the user logged out', async () => {
    vi.mocked(authService.resetPassword).mockResolvedValue('Your password has been reset.')
    const data = {
      token: 'reset-token',
      email: 'ana@example.com',
      password: 'new-secret123',
      password_confirmation: 'new-secret123',
    }

    const auth = useAuthStore()
    const status = await auth.resetPassword(data)

    expect(authService.resetPassword).toHaveBeenCalledWith(data)
    expect(status).toBe('Your password has been reset.')
    // The backend does not start a session on reset; the page sends them to /login.
    expect(authService.fetchUser).not.toHaveBeenCalled()
    expect(auth.isAuthenticated).toBe(false)
  })

  test('an invalid or expired token rejects', async () => {
    vi.mocked(authService.resetPassword).mockRejectedValue(new Error('422'))

    const auth = useAuthStore()
    await expect(auth.resetPassword({
      token: 'expired',
      email: 'ana@example.com',
      password: 'new-secret123',
      password_confirmation: 'new-secret123',
    })).rejects.toThrow()

    expect(auth.isAuthenticated).toBe(false)
  })
})
