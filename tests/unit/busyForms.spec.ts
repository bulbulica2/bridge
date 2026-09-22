import { DOMWrapper, VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { IonInput, IonTextarea } from '@ionic/vue'
import LoginPage from '@/views/LoginPage.vue'
import AccountPage from '@/views/AccountPage.vue'
import * as authService from '@/services/auth'
import { useAuthStore } from '@/stores/auth'
import { navigateAndSettle } from '@/router/loading'
import { showToast, showWelcomeToast } from '@/utils/toast'

vi.mock('@/services/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  fetchUser: vi.fn(),
  updateProfile: vi.fn(),
}))
vi.mock('@/router/loading', () => ({ navigateAndSettle: vi.fn() }))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn(), showWelcomeToast: vi.fn() }))
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
    expect(showWelcomeToast).not.toHaveBeenCalled()

    navigation.resolve()
    await flushPromises()
    expect(showWelcomeToast).toHaveBeenCalledWith('Welcome back, Ana!')
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
    expect(showWelcomeToast).not.toHaveBeenCalled()
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

function button(wrapper: VueWrapper, label: string) {
  return wrapper.find('.account').findAll('ion-button').find((b) => b.text().includes(label))!
}

function validationError(errors: Record<string, string[]>): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status: 422, data: { message: 'Invalid.', errors }, statusText: '', headers: {}, config }
  return error
}

describe('Profile edit', () => {
  const profile = { ...user, description: 'Plays a strong club.' }

  async function editPage() {
    useAuthStore().user = { ...profile }
    const wrapper = mount(AccountPage)
    await button(wrapper, 'Edit profile').trigger('click')
    return wrapper
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  test('locks the form while saving, then shows the new name and a toast', async () => {
    const saved = { ...profile, name: 'Ana Maria' }
    let finish!: () => void
    vi.mocked(authService.updateProfile).mockReturnValue(
      new Promise((resolve) => (finish = () => resolve(saved))),
    )
    const wrapper = await editPage()

    await wrapper.findComponent(IonInput).setValue('  Ana Maria ')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    // Only the changed field goes out, trimmed, and only once.
    expect(authService.updateProfile).toHaveBeenCalledTimes(1)
    expect(authService.updateProfile).toHaveBeenCalledWith({ name: 'Ana Maria' })
    expect(isDisabled(wrapper.find('ion-input'))).toBe(true)
    expect(isDisabled(wrapper.find('ion-textarea'))).toBe(true)
    expect(isDisabled(button(wrapper, 'Cancel'))).toBe(true)
    expect(wrapper.find('.actions ion-spinner').exists()).toBe(true)

    finish()
    await flushPromises()
    expect(showToast).toHaveBeenCalledWith('Profile updated.', 'success')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('.identity h1').text()).toBe('Ana Maria')
  })

  test('clearing the description sends null', async () => {
    vi.mocked(authService.updateProfile).mockResolvedValue({ ...profile, description: null })
    const wrapper = await editPage()

    await wrapper.findComponent(IonTextarea).setValue('   ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(authService.updateProfile).toHaveBeenCalledWith({ description: null })
  })

  test('saving without changes just closes the form', async () => {
    const wrapper = await editPage()

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(authService.updateProfile).not.toHaveBeenCalled()
    expect(wrapper.find('form').exists()).toBe(false)
  })

  test('counts the description live', async () => {
    const wrapper = await editPage()
    expect(wrapper.find('.counter').text()).toBe('20 / 1000')

    await wrapper.findComponent(IonTextarea).setValue('abc')
    expect(wrapper.find('.counter').text()).toBe('3 / 1000')
  })

  test('shows a 422 under its field and unlocks the form', async () => {
    vi.mocked(authService.updateProfile).mockRejectedValue(
      validationError({ name: ['The name field is required.'] }),
    )
    const wrapper = await editPage()

    await wrapper.findComponent(IonInput).setValue('')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.field-error').text()).toBe('The name field is required.')
    expect(wrapper.find('.error').exists()).toBe(false)
    expect(isDisabled(wrapper.find('ion-input'))).toBe(false)
    expect(showToast).not.toHaveBeenCalled()
    expect(useAuthStore().user?.name).toBe('Ana')
  })

  test('shows username and email read-only', async () => {
    const wrapper = await editPage()

    expect(wrapper.findAll('ion-input')).toHaveLength(1)
    expect(wrapper.text()).toContain('@ana')
    expect(wrapper.text()).toContain('ana@example.com')
    expect(wrapper.text()).toContain("Username and email can't be changed yet.")
  })
})
