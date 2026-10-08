import { readFileSync } from 'fs'
import { resolve } from 'path'
import { DOMWrapper, VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { IonButton, IonInput, IonTextarea } from '@ionic/vue'
import LoginPage from '@/views/LoginPage.vue'
import CreateAccountPage from '@/views/CreateAccountPage.vue'
import ResetPasswordPage from '@/views/ResetPasswordPage.vue'
import AccountPage from '@/views/AccountPage.vue'
import BanUserForm from '@/components/BanUserForm.vue'
import * as authService from '@/services/auth'
import http from '@/services/http'
import type { PublicUser } from '@/services/users'
import { useAuthStore } from '@/stores/auth'
import { formErrors } from '@/utils/errors'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))
vi.mock('@/services/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  fetchUser: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  updateProfile: vi.fn(),
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

const route = { params: {} as Record<string, string>, query: {} as Record<string, string> }
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => route,
}))
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  useIonRouter: () => ({ navigate: vi.fn() }),
  onIonViewWillEnter: (hook: () => void) => hook(),
}))

const bob: PublicUser = { id: 9, name: 'Bob', username: 'bob', description: null, is_robot: false, is_admin: false }

function axiosError(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data, statusText: '', headers: {}, config }
  return error
}

function invalid(errors: Record<string, string[]>): AxiosError {
  return axiosError(422, { message: Object.values(errors)[0][0], errors })
}

// The fields in order, as elements: their classes and slotted children.
function fields(wrapper: VueWrapper): DOMWrapper<Element>[] {
  return wrapper.findAll('ion-input, ion-textarea')
}

function labels(wrapper: VueWrapper): string[] {
  return wrapper.findAllComponents(IonInput).map((input) => input.props('label') as string)
}

// The labels of the fields that carry a show/hide toggle in their end slot.
function toggled(wrapper: VueWrapper): string[] {
  return wrapper
    .findAllComponents(IonInput)
    .filter((input) => input.find('ion-input-password-toggle[slot="end"]').exists())
    .map((input) => input.props('label') as string)
}

function isInvalid(field: DOMWrapper<Element>) {
  return field.classes('bridge-field-invalid')
}

// A field's message is the one its aria-describedby names.
function messageOf(wrapper: VueWrapper, field: DOMWrapper<Element>) {
  const id = field.attributes('aria-describedby')
  return wrapper.find(`#${id}`)
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  route.params = {}
  route.query = {}
})

describe('formErrors', () => {
  test("a 422's messages go under the fields the form shows", () => {
    const e = invalid({ email: ['These credentials do not match our records.'] })

    expect(formErrors(e, ['email', 'password'], 'Login failed.')).toEqual({
      fields: { email: 'These credentials do not match our records.' },
      message: '',
    })
  })

  test('a field the form does not show goes under the form instead', () => {
    const e = invalid({ email: ['Bad email.'], token: ['This password reset token is invalid.'] })

    expect(formErrors(e, ['email'], 'Failed.')).toEqual({
      fields: { email: 'Bad email.' },
      message: 'This password reset token is invalid.',
    })
  })

  test('only fields the form does not show: the first one under the form', () => {
    const e = invalid({ token: ['This password reset token is invalid.'] })

    expect(formErrors(e, ['email'], 'Failed.')).toEqual({
      fields: {},
      message: 'This password reset token is invalid.',
    })
  })

  test('anything but a 422 is the message, or the fallback', () => {
    expect(formErrors(axiosError(429, { message: 'Too many attempts.' }), ['email'], 'Failed.')).toEqual({
      fields: {},
      message: 'Too many attempts.',
    })
    expect(formErrors(new Error('boom'), ['email'], 'Failed.')).toEqual({ fields: {}, message: 'Failed.' })
  })
})

describe('the shared field style', () => {
  test('every field of every form uses it, outside any ion-item', async () => {
    useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com', description: null }
    const account = mount(AccountPage)
    await account.findAll('ion-button').find((b) => b.text().includes('Edit profile'))!.trigger('click')
    route.params = { token: 'abc' }
    const pages = [
      mount(LoginPage),
      mount(CreateAccountPage),
      mount(ResetPasswordPage),
      account,
      mount(BanUserForm, { props: { user: bob } }),
    ]

    for (const page of pages) {
      expect(fields(page).length).toBeGreaterThan(0)
      for (const field of fields(page)) {
        expect(field.classes()).toContain('bridge-field')
        expect(field.element.closest('ion-item')).toBeNull()
      }
      const components = [...page.findAllComponents(IonInput), ...page.findAllComponents(IonTextarea)]
      expect(components.map((field) => field.props('labelPlacement'))).toEqual(components.map(() => 'stacked'))
    }
  })

  test('the guest pages sit in a white card with the orange primary button', () => {
    route.params = { token: 'abc' }
    for (const page of [mount(LoginPage), mount(CreateAccountPage), mount(ResetPasswordPage)]) {
      expect(page.find('.bridge-form-page .bridge-form-card form.bridge-form').exists()).toBe(true)
      const submit = page.findAllComponents(IonButton).find((b) => b.props('type') === 'submit')!
      expect(submit.props('color')).toBe('action')
      expect(page.find('.bridge-form-card .bridge-form-links ion-button').exists()).toBe(true)
    }
  })

  test("Remember me is a checkbox with a 44 px tap area (the shared class)", () => {
    expect(mount(LoginPage).find('ion-checkbox').classes()).toContain('bridge-check')
  })
})

describe('password toggles', () => {
  test('Login: on the password only', () => {
    const wrapper = mount(LoginPage)

    expect(labels(wrapper)).toEqual(['Email', 'Password'])
    expect(toggled(wrapper)).toEqual(['Password'])
  })

  test('Create account: on both password fields', () => {
    expect(toggled(mount(CreateAccountPage))).toEqual(['Password', 'Confirm password'])
  })

  test('Reset password: on both new-password fields, none when asking for the link', () => {
    expect(toggled(mount(ResetPasswordPage))).toEqual([])

    route.params = { token: 'abc' }
    expect(toggled(mount(ResetPasswordPage))).toEqual(['New password', 'Confirm new password'])
  })
})

describe('the error state follows fieldErrors', () => {
  test('Login: a 422 marks its field red with the message under it, the next try clears it', async () => {
    vi.mocked(authService.login).mockRejectedValueOnce(
      invalid({ email: ['These credentials do not match our records.'] }),
    )
    const wrapper = mount(LoginPage)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const [email, password] = fields(wrapper)
    expect(isInvalid(email)).toBe(true)
    expect(isInvalid(password)).toBe(false)
    expect(messageOf(wrapper, email).text()).toBe('These credentials do not match our records.')
    expect(messageOf(wrapper, email).classes()).toContain('bridge-field-message')
    expect(messageOf(wrapper, password).exists()).toBe(false)
    // Under its field, not again under the form.
    expect(wrapper.find('.error').exists()).toBe(false)

    vi.mocked(authService.login).mockRejectedValueOnce(new Error('offline'))
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(isInvalid(fields(wrapper)[0])).toBe(false)
    expect(wrapper.find('.bridge-field-message').exists()).toBe(false)
    expect(wrapper.find('.error').text()).toBe('Login failed. Please try again.')
  })

  test('Create account: each field gets its own message', async () => {
    vi.mocked(authService.register).mockRejectedValue(
      invalid({
        username: ['The username has already been taken.'],
        password: ['The password field confirmation does not match.'],
      }),
    )
    const wrapper = mount(CreateAccountPage)
    const inputs = wrapper.findAllComponents(IonInput)
    await inputs[3].setValue('secret12')
    await inputs[4].setValue('secret12')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fields(wrapper).map(isInvalid)).toEqual([false, true, false, true, false])
    expect(messageOf(wrapper, fields(wrapper)[1]).text()).toBe('The username has already been taken.')
    expect(messageOf(wrapper, fields(wrapper)[3]).text()).toBe('The password field confirmation does not match.')
    expect(wrapper.find('.error').exists()).toBe(false)
  })

  test('Reset password, asking for the link: the email field', async () => {
    vi.mocked(authService.requestPasswordReset).mockRejectedValue(
      invalid({ email: ["We can't find a user with that email address."] }),
    )
    const wrapper = mount(ResetPasswordPage)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const [email] = fields(wrapper)
    expect(isInvalid(email)).toBe(true)
    expect(messageOf(wrapper, email).text()).toBe("We can't find a user with that email address.")
  })

  test('Reset password, the new password: a bad token goes under the form', async () => {
    route.params = { token: 'abc' }
    vi.mocked(authService.resetPassword).mockRejectedValue(
      invalid({ password: ['The password field must be at least 8 characters.'], token: ['Bad token.'] }),
    )
    const wrapper = mount(ResetPasswordPage)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fields(wrapper).map(isInvalid)).toEqual([false, true, false])
    expect(messageOf(wrapper, fields(wrapper)[1]).text()).toBe('The password field must be at least 8 characters.')
    expect(wrapper.find('.message').text()).toBe('Bad token.')
  })

  test("Account: the description's error marks the textarea", async () => {
    useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com', description: null }
    vi.mocked(authService.updateProfile).mockRejectedValue(
      invalid({ description: ['The description field must not be greater than 1000 characters.'] }),
    )
    const wrapper = mount(AccountPage)
    await wrapper.findAll('ion-button').find((b) => b.text().includes('Edit profile'))!.trigger('click')
    await wrapper.findComponent(IonTextarea).setValue('Long.')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const [name, description] = fields(wrapper)
    expect(isInvalid(name)).toBe(false)
    expect(isInvalid(description)).toBe(true)
    expect(messageOf(wrapper, description).text()).toBe(
      'The description field must not be greater than 1000 characters.',
    )
  })

  test("BanUserForm: the form's own errors and the backend's mark their fields", async () => {
    const wrapper = mount(BanUserForm, { props: { user: bob } })
    wrapper.findComponent(IonInput).vm.$emit('update:modelValue', '400')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fields(wrapper).map(isInvalid)).toEqual([true, true])
    expect(messageOf(wrapper, fields(wrapper)[0]).text()).toContain('from 1 to 365')
    expect(messageOf(wrapper, fields(wrapper)[1]).text()).toContain('Give a reason')

    vi.mocked(http.post).mockRejectedValue(invalid({ reason: ['The reason is too long.'] }))
    wrapper.findComponent(IonInput).vm.$emit('update:modelValue', '7')
    wrapper.findComponent(IonTextarea).vm.$emit('update:modelValue', 'Collusion.')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fields(wrapper).map(isInvalid)).toEqual([false, true])
    expect(messageOf(wrapper, fields(wrapper)[1]).text()).toBe('The reason is too long.')
  })
})

describe('forms.css', () => {
  // The rules alone: the comments cite issues (#170).
  const css = readFileSync(resolve(__dirname, '../../src/theme/forms.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  test('reads tokens, never a hex colour', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  // A browser that doesn't know one of the two selectors drops a rule naming both.
  test('paints autofill with the field colours, in separate rules for each selector', () => {
    const rules = css.split('}').filter((rule) => /autofill/.test(rule))
    const webkit = rules.find((rule) => rule.includes(':-webkit-autofill:focus {'))!
    const standard = rules.find((rule) => rule.includes(':autofill:focus {'))!

    for (const rule of [webkit, standard]) {
      expect(rule).toContain('var(--bridge-field-bg, var(--bridge-surface)) inset')
      expect(rule).toContain('-webkit-text-fill-color: var(--bridge-field-ink, var(--ion-text-color))')
      expect(rule).toContain('caret-color')
    }
    expect(webkit).not.toMatch(/:autofill/)
    expect(standard).not.toContain('-webkit-autofill')
  })

  test('is loaded with the other theme files', () => {
    const main = readFileSync(resolve(__dirname, '../../src/main.ts'), 'utf8')
    expect(main).toContain("import './theme/forms.css';")
  })
})
