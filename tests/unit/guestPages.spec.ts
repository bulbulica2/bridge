import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { IonInput, IonText } from '@ionic/vue'
import CreateAccountPage from '@/views/CreateAccountPage.vue'
import LoginPage from '@/views/LoginPage.vue'
import ResetPasswordPage from '@/views/ResetPasswordPage.vue'
import * as authService from '@/services/auth'
import { navigateAndSettle } from '@/router/loading'
import { showWelcomeToast } from '@/utils/toast'
import { NAME_MAX, USERNAME_MAX } from '@/utils/limits'

vi.mock('@/services/auth', () => ({
  register: vi.fn(),
  fetchUser: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}))
vi.mock('@/router/loading', () => ({ navigateAndSettle: vi.fn() }))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn(), showWelcomeToast: vi.fn() }))

const navigate = vi.fn()
const route = { params: {} as Record<string, string>, query: {} as Record<string, string> }
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => route,
}))
// Ionic's view hooks only fire inside a router outlet; run them at setup, as
// entering the page would.
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  useIonRouter: () => ({ navigate }),
  onIonViewWillEnter: (hook: () => void) => hook(),
}))

function axiosError(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data, statusText: '', headers: {}, config }
  return error
}

// Fills the form's inputs in order.
async function fill(wrapper: VueWrapper, values: string[]) {
  const inputs = wrapper.findAllComponents(IonInput)
  for (const [i, value] of values.entries()) {
    await inputs[i].setValue(value)
  }
}

// Ionic sets `color` as a DOM property, so find the line by its prop.
function coloured(wrapper: VueWrapper, color: 'danger' | 'success') {
  return wrapper.findAllComponents(IonText).find((t) => t.props('color') === color)
}

function errorText(wrapper: VueWrapper) {
  return coloured(wrapper, 'danger')?.text()
}

const ana = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  route.params = {}
  route.query = {}
})

// A guest who came from a link sees where they are.
describe("the app's name above the form", () => {
  test.each([
    ['LoginPage', LoginPage],
    ['CreateAccountPage', CreateAccountPage],
    ['ResetPasswordPage', ResetPasswordPage],
  ])('%s', (_, page) => {
    const wrapper = mount(page)

    expect(wrapper.find('.bridge-form-page > .bridge-form-brand').text()).toBe('Bridge4U')
  })
})

describe('CreateAccountPage', () => {
  test('registers, goes to /account and greets the new user', async () => {
    vi.mocked(authService.fetchUser).mockResolvedValue(ana)
    vi.mocked(navigateAndSettle).mockResolvedValue()
    const wrapper = mount(CreateAccountPage)
    await fill(wrapper, ['Ana', 'ana', 'ana@example.com', 'secret12', 'secret12'])

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(authService.register).toHaveBeenCalledWith({
      name: 'Ana',
      username: 'ana',
      email: 'ana@example.com',
      password: 'secret12',
      password_confirmation: 'secret12',
    })
    expect(navigateAndSettle).toHaveBeenCalledWith(expect.anything(), '/account')
    expect(showWelcomeToast).toHaveBeenCalledWith('Welcome, Ana! Your account is ready.')
  })

  test("caps the name and username at the backend's limits", () => {
    const inputs = mount(CreateAccountPage).findAllComponents(IonInput)

    expect(inputs[0].props('maxlength')).toBe(NAME_MAX)
    expect(inputs[1].props('maxlength')).toBe(USERNAME_MAX)
    expect([NAME_MAX, USERNAME_MAX]).toEqual([50, 30])
  })

  test('stops at mismatched passwords without asking the backend', async () => {
    const wrapper = mount(CreateAccountPage)
    await fill(wrapper, ['Ana', 'ana', 'ana@example.com', 'secret12', 'secret13'])

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(authService.register).not.toHaveBeenCalled()
    expect(errorText(wrapper)).toBe('Passwords do not match.')
  })

  test("shows the backend's reason and unlocks the form", async () => {
    vi.mocked(authService.register).mockRejectedValue(
      axiosError(422, { message: 'The username has already been taken.', errors: {} }),
    )
    const wrapper = mount(CreateAccountPage)
    await fill(wrapper, ['Ana', 'ana', 'ana@example.com', 'pw', 'pw'])

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(errorText(wrapper)).toBe('The username has already been taken.')
    expect(navigateAndSettle).not.toHaveBeenCalled()
    expect(wrapper.find('ion-spinner').exists()).toBe(false)
  })
})

describe('ResetPasswordPage, asking for a link', () => {
  test('sends the email and shows the backend status', async () => {
    vi.mocked(authService.requestPasswordReset).mockResolvedValue('We have emailed your password reset link.')
    const wrapper = mount(ResetPasswordPage)
    expect(wrapper.text()).toContain('Reset password')
    await fill(wrapper, ['ana@example.com'])

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(authService.requestPasswordReset).toHaveBeenCalledWith({ email: 'ana@example.com' })
    expect(coloured(wrapper, 'success')?.text()).toBe('We have emailed your password reset link.')
  })

  test('shows why the link could not be sent', async () => {
    vi.mocked(authService.requestPasswordReset).mockRejectedValue(new Error('offline'))
    const wrapper = mount(ResetPasswordPage)
    await fill(wrapper, ['ana@example.com'])

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(errorText(wrapper)).toBe('Could not send the reset link. Please try again.')
    expect(coloured(wrapper, 'success')).toBeUndefined()
  })
})

describe('ResetPasswordPage, from the emailed link', () => {
  beforeEach(() => {
    route.params = { token: 'tok123' }
    route.query = { email: 'ana@example.com' }
  })

  test('takes the email from the link and resets with the token, then goes to /login', async () => {
    vi.mocked(authService.resetPassword).mockResolvedValue('Your password has been reset.')
    const wrapper = mount(ResetPasswordPage)
    expect(wrapper.text()).toContain('Choose a new password')
    const inputs = wrapper.findAllComponents(IonInput)
    expect(inputs[0].props('modelValue')).toBe('ana@example.com')
    await inputs[1].setValue('newpass12')
    await inputs[2].setValue('newpass12')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(authService.resetPassword).toHaveBeenCalledWith({
      token: 'tok123',
      email: 'ana@example.com',
      password: 'newpass12',
      password_confirmation: 'newpass12',
    })
    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })

  test('stops at mismatched passwords', async () => {
    const wrapper = mount(ResetPasswordPage)
    await fill(wrapper, ['ana@example.com', 'newpass12', 'other'])

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(authService.resetPassword).not.toHaveBeenCalled()
    expect(errorText(wrapper)).toBe('Passwords do not match.')
  })

  test("shows the backend's reason for a stale token and stays", async () => {
    vi.mocked(authService.resetPassword).mockRejectedValue(
      axiosError(422, { message: 'This password reset token is invalid.', errors: {} }),
    )
    const wrapper = mount(ResetPasswordPage)
    await fill(wrapper, ['ana@example.com', 'newpass12', 'newpass12'])

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(errorText(wrapper)).toBe('This password reset token is invalid.')
    expect(navigate).not.toHaveBeenCalled()
  })
})
