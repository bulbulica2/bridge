import { DOMWrapper, VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import LoginPage from '@/views/LoginPage.vue'
import AccountPage from '@/views/AccountPage.vue'
import * as authService from '@/services/auth'
import { navigateAndSettle } from '@/router/loading'
import { showToast } from '@/utils/toast'

vi.mock('@/services/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  fetchUser: vi.fn(),
}))
vi.mock('@/router/loading', () => ({ navigateAndSettle: vi.fn() }))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn() }))
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  useIonRouter: () => ({ navigate: vi.fn() }),
}))

// A promise the test resolves by hand, to hold the flow at one step.
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

// Ionic's web components take `disabled` as a DOM property, not an attribute.
function isDisabled(wrapper: DOMWrapper<Element>) {
  return (wrapper.element as Element & { disabled?: boolean }).disabled
}

function logOutButton(wrapper: VueWrapper) {
  return wrapper.findAll('ion-button').find((b) => b.text().includes('Log out'))!
}

const user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }

describe('Login form busy state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    vi.mocked(authService.fetchUser).mockResolvedValue(user)
  })

  test('locks the whole form until /account has been reached', async () => {
    const navigation = deferred()
    vi.mocked(navigateAndSettle).mockReturnValue(navigation.promise)
    const wrapper = mount(LoginPage)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    // Logged in, but the next page isn't up yet: everything stays disabled.
    expect(navigateAndSettle).toHaveBeenCalledWith(expect.anything(), '/account')
    for (const input of wrapper.findAll('ion-input')) {
      expect(isDisabled(input)).toBe(true)
    }
    for (const button of wrapper.find('.login').findAll('ion-button')) {
      expect(isDisabled(button)).toBe(true)
    }
    expect(wrapper.find('ion-spinner').exists()).toBe(true)

    navigation.resolve()
    await flushPromises()
    expect(wrapper.find('ion-spinner').exists()).toBe(false)
    expect(isDisabled(wrapper.find('ion-input'))).toBe(false)
  })

  test('ignores a second submit while the first is running', async () => {
    const login = deferred()
    vi.mocked(authService.login).mockReturnValue(login.promise)
    vi.mocked(navigateAndSettle).mockResolvedValue()
    const wrapper = mount(LoginPage)

    await wrapper.find('form').trigger('submit')
    await wrapper.find('form').trigger('submit')
    login.resolve()
    await flushPromises()

    expect(authService.login).toHaveBeenCalledTimes(1)
  })

  test('unlocks the form and shows the error when login fails', async () => {
    vi.mocked(authService.login).mockRejectedValue(new Error('boom'))
    const wrapper = mount(LoginPage)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(navigateAndSettle).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Login failed')
    expect(isDisabled(wrapper.find('ion-input'))).toBe(false)
  })
})

describe('Logout confirmation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    vi.mocked(navigateAndSettle).mockResolvedValue()
  })

  test('confirms a logout with a success toast once /login is up', async () => {
    const navigation = deferred()
    vi.mocked(navigateAndSettle).mockReturnValue(navigation.promise)
    const wrapper = mount(AccountPage)

    await logOutButton(wrapper).trigger('click')
    await flushPromises()
    expect(navigateAndSettle).toHaveBeenCalledWith(expect.anything(), '/login')
    expect(showToast).not.toHaveBeenCalled()

    navigation.resolve()
    await flushPromises()
    expect(showToast).toHaveBeenCalledWith('You have been logged out.', 'success')
  })

  test('warns when the server could not be told', async () => {
    vi.mocked(authService.logout).mockRejectedValue(new Error('offline'))
    const wrapper = mount(AccountPage)

    await logOutButton(wrapper).trigger('click')
    await flushPromises()

    expect(navigateAndSettle).toHaveBeenCalledWith(expect.anything(), '/login')
    expect(showToast).toHaveBeenCalledWith(
      'Could not reach the server, so you were logged out locally.',
      'warning',
    )
  })
})
