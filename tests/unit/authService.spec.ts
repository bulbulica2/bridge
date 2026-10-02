import { beforeEach, describe, expect, test, vi } from 'vitest'
import http from '@/services/http'
import { login } from '@/services/auth'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

describe('auth service login', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  test('fetches the CSRF cookie, then posts remember in the /login body', async () => {
    await login({ email: 'ana@example.com', password: 'secret', remember: true })

    expect(http.get).toHaveBeenCalledWith('/sanctum/csrf-cookie')
    expect(http.post).toHaveBeenCalledWith('/login', {
      email: 'ana@example.com',
      password: 'secret',
      remember: true,
    })
    expect(vi.mocked(http.get).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(http.post).mock.invocationCallOrder[0])
  })

  test('posts remember: false when it is off', async () => {
    await login({ email: 'ana@example.com', password: 'secret', remember: false })

    expect(http.post).toHaveBeenCalledWith('/login', expect.objectContaining({ remember: false }))
  })
})
