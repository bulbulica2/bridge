import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth'
import * as authService from '@/services/auth'

vi.mock('@/services/auth', () => ({
  login: vi.fn(),
  fetchUser: vi.fn(),
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
})
