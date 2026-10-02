import { AxiosError, AxiosHeaders } from 'axios'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { IonInput, IonTextarea } from '@ionic/vue'
import http from '@/services/http'
import * as authService from '@/services/auth'
import * as echo from '@/services/echo'
import { banUser, liftBan } from '@/services/users'
import type { PublicUser, UserBan } from '@/services/users'
import type { Ban, User } from '@/services/auth'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'
import { useUsersStore } from '@/stores/users'
import AppHeader from '@/components/AppHeader.vue'
import BanUserForm from '@/components/BanUserForm.vue'
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue'
import TablesPage from '@/views/TablesPage.vue'
import { banDate, banFormErrors, banText, canBan } from '@/utils/ban'
import { showToast } from '@/utils/toast'

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
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn() }))
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  useIonRouter: () => ({ navigate }),
}))

function axiosError(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data, statusText: '', headers: {}, config }
  return error
}

// Local noon, so the date reads the same in every time zone the tests run in.
const UNTIL = new Date(2026, 9, 12, 12, 0).toISOString()
const BANNED_AT = new Date(2026, 9, 5, 12, 0).toISOString()

const ownBan: Ban = { reason: 'Playing two accounts at once.', until: UNTIL, banned_at: BANNED_AT }
const admin: User = { id: 1, name: 'Admin', username: 'admin', email: 'email@abc.com', is_admin: true }
const ana: User = { id: 2, name: 'Ana', username: 'ana', email: 'ana@example.com', is_admin: false }
const bob: PublicUser = { id: 9, name: 'Bob', username: 'bob', description: null, is_robot: false, is_admin: false }
const robot: PublicUser = { id: 20, name: 'Robot 1', username: 'robot-1', description: null, is_robot: true, is_admin: false }
const otherAdmin: PublicUser = { id: 3, name: 'Eve', username: 'eve', description: null, is_robot: false, is_admin: true }

function adminBan(extra: Partial<UserBan> = {}): UserBan {
  return {
    id: 4,
    user_id: 9,
    reason: ownBan.reason,
    banned_at: BANNED_AT,
    until: UNTIL,
    banned_by: { id: 1, name: 'Admin', username: 'admin', description: null, is_robot: false, is_admin: true },
    lifted_at: null,
    lifted_by: null,
    active: true,
    ...extra,
  }
}

// IonModal only renders its content once presented, which jsdom never does.
const modalStub = { template: '<div><slot /></div>' }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
})

describe('ban helpers', () => {
  test('banDate and banText word the end of a ban like the backend', () => {
    expect(banDate(UNTIL)).toBe('12 Oct 2026')
    expect(banText(ownBan)).toBe('You are banned until 12 Oct 2026: Playing two accounts at once.')
  })

  test('only an admin may ban, never themselves, another admin or a robot', () => {
    expect(canBan(admin, bob)).toBe(true)
    expect(canBan(ana, bob)).toBe(false)
    expect(canBan(null, bob)).toBe(false)
    expect(canBan(admin, { ...bob, id: admin.id })).toBe(false)
    expect(canBan(admin, otherAdmin)).toBe(false)
    expect(canBan(admin, robot)).toBe(false)
  })

  test('the form wants 1–365 whole days and a reason', () => {
    expect(banFormErrors({ days: 7, reason: 'Collusion.' })).toEqual({})
    expect(banFormErrors({ days: 365, reason: 'x' })).toEqual({})
    expect(Object.keys(banFormErrors({ days: 0, reason: 'x' }))).toEqual(['days'])
    expect(Object.keys(banFormErrors({ days: 366, reason: 'x' }))).toEqual(['days'])
    expect(Object.keys(banFormErrors({ days: 2.5, reason: 'x' }))).toEqual(['days'])
    expect(Object.keys(banFormErrors({ days: NaN, reason: 'x' }))).toEqual(['days'])
    expect(Object.keys(banFormErrors({ days: 7, reason: '   ' }))).toEqual(['reason'])
    expect(Object.keys(banFormErrors({ days: 7, reason: 'x'.repeat(1001) }))).toEqual(['reason'])
  })
})

describe('ban endpoints', () => {
  test('banUser posts days and reason and returns the ban with its message', async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: { status: 201, message: 'User banned until 12 Oct 2026.', data: adminBan() },
    })

    await expect(banUser(9, { days: 7, reason: 'Collusion.' })).resolves.toEqual({
      ban: adminBan(),
      message: 'User banned until 12 Oct 2026.',
    })
    expect(http.post).toHaveBeenCalledWith('/users/9/ban', { days: 7, reason: 'Collusion.' })
  })

  test('liftBan deletes the ban and returns it lifted', async () => {
    const lifted = adminBan({ active: false, lifted_at: UNTIL })
    vi.mocked(http.delete).mockResolvedValue({ data: { status: 200, message: 'Ban lifted.', data: lifted } })

    await expect(liftBan(9)).resolves.toEqual(lifted)
    expect(http.delete).toHaveBeenCalledWith('/users/9/ban')
  })
})

describe('users store bans', () => {
  test('a ban lands on the cached profile and heads its history', async () => {
    const older = adminBan({ id: 2, active: false, lifted_at: BANNED_AT })
    const store = useUsersStore()
    store.profiles[9] = { ...bob, ban: null, bans: [older] }
    vi.mocked(http.post).mockResolvedValue({ data: { status: 201, message: '', data: adminBan() } })

    await store.ban(9, { days: 7, reason: 'Collusion.' })

    expect(store.profiles[9].ban).toEqual(adminBan())
    expect(store.profiles[9].bans!.map((b) => b.id)).toEqual([4, 2])
  })

  test('lifting clears the ban in force and updates its history row', async () => {
    const lifted = adminBan({ active: false, lifted_at: UNTIL })
    const store = useUsersStore()
    store.profiles[9] = { ...bob, ban: adminBan(), bans: [adminBan()] }
    vi.mocked(http.delete).mockResolvedValue({ data: { status: 200, message: 'Ban lifted.', data: lifted } })

    await store.liftBan(9)

    expect(store.profiles[9].ban).toBeNull()
    expect(store.profiles[9].bans).toEqual([lifted])
  })

  test('a 404 on lifting drops the stale ban and rethrows', async () => {
    const store = useUsersStore()
    store.profiles[9] = { ...bob, ban: adminBan() }
    vi.mocked(http.delete).mockRejectedValue(axiosError(404, { status: 404, message: 'That user is not banned.', data: [] }))

    await expect(store.liftBan(9)).rejects.toMatchObject({ response: { status: 404 } })
    expect(store.profiles[9].ban).toBeNull()
  })
})

describe('BanUserForm', () => {
  function mountForm() {
    useUsersStore().profiles[9] = { ...bob }
    return mount(BanUserForm, { props: { user: bob } })
  }

  test('Cancel gives up without sending', async () => {
    const wrapper = mountForm()

    await wrapper.findAll('ion-button').find((b) => b.text() === 'Cancel')!.trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(http.post).not.toHaveBeenCalled()
  })

  test('refuses to send without a reason', async () => {
    const wrapper = mountForm()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(http.post).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Give a reason')
  })

  test('refuses a number of days out of range', async () => {
    const wrapper = mountForm()
    wrapper.findComponent(IonInput).vm.$emit('update:modelValue', '400')
    wrapper.findComponent(IonTextarea).vm.$emit('update:modelValue', 'Collusion.')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(http.post).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('from 1 to 365')
  })

  test('a quick pick sets the days, and the ban is sent and toasted', async () => {
    vi.mocked(http.post).mockResolvedValue({
      data: { status: 201, message: 'User banned until 12 Oct 2026.', data: adminBan() },
    })
    const wrapper = mountForm()

    const thirty = wrapper.findAll('ion-button').find((b) => b.text() === '30 days')!
    await thirty.trigger('click')
    wrapper.findComponent(IonTextarea).vm.$emit('update:modelValue', '  Collusion.  ')
    await flushPromises()
    expect(wrapper.text()).toContain('Ban for 30 days')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(http.post).toHaveBeenCalledWith('/users/9/ban', { days: 30, reason: 'Collusion.' })
    expect(showToast).toHaveBeenCalledWith('User banned until 12 Oct 2026.', 'success')
    expect(wrapper.emitted('banned')).toEqual([[adminBan()]])
    expect(useUsersStore().profiles[9].ban).toEqual(adminBan())
  })

  test('shows the backend refusal', async () => {
    vi.mocked(http.post).mockRejectedValue(axiosError(403, { message: 'An admin cannot be banned.' }))
    const wrapper = mountForm()
    wrapper.findComponent(IonTextarea).vm.$emit('update:modelValue', 'Collusion.')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('An admin cannot be banned.')
    expect(wrapper.emitted('banned')).toBeUndefined()
  })
})

describe('Ban on the profile sheet', () => {
  function mountSheet(player: PublicUser) {
    vi.mocked(http.get).mockResolvedValue({ data: { status: 200, message: '', data: player } })
    return mount(PlayerProfileSheet, {
      props: { player },
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
  }
  const banButton = (wrapper: ReturnType<typeof mountSheet>) =>
    wrapper.findAll('ion-button').find((b) => /^Ban/.test(b.text()))

  test('an admin sees Ban, which opens the form', async () => {
    useAuthStore().user = admin
    const wrapper = mountSheet(bob)
    await flushPromises()

    await banButton(wrapper)!.trigger('click')

    expect(wrapper.findComponent(BanUserForm).exists()).toBe(true)
  })

  test('nobody else does, and an admin never for an admin or a robot', async () => {
    useAuthStore().user = ana
    expect(banButton(mountSheet(bob))).toBeUndefined()

    useAuthStore().user = admin
    expect(banButton(mountSheet(otherAdmin))).toBeUndefined()
    expect(banButton(mountSheet(robot))).toBeUndefined()
  })

  test('the form closes on a ban (showing it) or Cancel, and dismissing closes the sheet', async () => {
    useAuthStore().user = admin
    // A stub that passes the modal's dismissal on.
    const dismissable = { name: 'IonModal', emits: ['didDismiss'], template: '<div><slot /></div>' }
    vi.mocked(http.get).mockResolvedValue({ data: { status: 200, message: '', data: bob } })
    const wrapper = mount(PlayerProfileSheet, {
      props: { player: bob },
      global: { stubs: { IonModal: dismissable, 'ion-modal': dismissable } },
    })
    await flushPromises()

    await banButton(wrapper)!.trigger('click')
    useUsersStore().profiles[9] = { ...bob, ban: adminBan() }
    wrapper.findComponent(BanUserForm).vm.$emit('banned', adminBan())
    await flushPromises()
    expect(wrapper.findComponent(BanUserForm).exists()).toBe(false)
    expect(wrapper.text()).toContain('Banned until 12 Oct 2026')

    await banButton(wrapper)!.trigger('click')
    wrapper.findComponent(BanUserForm).vm.$emit('cancel')
    await flushPromises()
    expect(wrapper.findComponent(BanUserForm).exists()).toBe(false)

    wrapper.findComponent({ name: 'IonModal' }).vm.$emit('didDismiss')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('shows an admin the ban in force', async () => {
    useAuthStore().user = admin
    const wrapper = mountSheet({ ...bob, ban: adminBan() })
    await flushPromises()

    expect(wrapper.text()).toContain('Banned until 12 Oct 2026: Playing two accounts at once.')
    expect(banButton(wrapper)!.text()).toBe('Ban again')
  })
})

describe('the banned user', () => {
  test('UserBanned on their channel ends the session and keeps the ban to show', () => {
    const auth = useAuthStore()
    auth.user = ana
    useGameStore().watchUser(ana.id)
    const tables = useTablesStore()
    const unwatchTable = vi.spyOn(tables, 'unwatchTable')

    // The third handler listenToUser was given is the UserBanned one.
    const onBanned = vi.mocked(echo.listenToUser).mock.calls[0][2]
    onBanned(ownBan)

    expect(auth.user).toBeNull()
    expect(auth.banNotice).toEqual(ownBan)
    expect(unwatchTable).toHaveBeenCalled()
    expect(echo.leaveUser).toHaveBeenCalledWith(ana.id)
    expect(echo.disconnectEcho).toHaveBeenCalled()
    // The session is already gone server-side: no POST /logout.
    expect(authService.logout).not.toHaveBeenCalled()

    auth.dismissBanNotice()
    expect(auth.banNotice).toBeNull()
  })

  test('a UserBanned after logging out is ignored', () => {
    const auth = useAuthStore()
    auth.applyBan(ownBan)

    expect(auth.banNotice).toBeNull()
  })

  test('logging in while banned keeps the ban on the user', async () => {
    vi.mocked(authService.fetchUser).mockResolvedValue({ ...ana, ban: ownBan })
    const auth = useAuthStore()

    await auth.login({ email: 'ana@example.com', password: 'secret' })

    expect(auth.isBanned).toBe(true)
    expect(auth.ban).toEqual(ownBan)
  })

  test('every page header shows the ban banner', async () => {
    const auth = useAuthStore()
    auth.user = { ...ana, ban: ownBan }
    const wrapper = mount(AppHeader, { props: { title: 'Home' } })

    expect(wrapper.text()).toContain('You are banned until 12 Oct 2026: Playing two accounts at once.')

    auth.user = ana
    await flushPromises()
    expect(wrapper.text()).not.toContain('banned')
  })
})

describe('TablesPage.vue for a banned user', () => {
  function makeTable(id: number, seats: Partial<Record<Seat, string>>): Table {
    const taken = Object.entries(seats) as [Seat, string][]
    return {
      id,
      name: `Table ${id}`,
      created_by: 50,
      moderated_by: 50,
      board_id: null,
      unattended_since: null,
      created_at: '2026-10-01T10:00:00.000000Z',
      updated_at: '2026-10-01T10:00:00.000000Z',
      seats: taken.map(([seat, username], i) => ({
        id: id * 10 + i,
        table_id: id,
        user_id: 50 + i,
        seat,
        user: { id: 50 + i, name: username, username, description: null, is_robot: false },
      })),
      free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
      can_manage: false,
    }
  }

  // Ionic's web components take `disabled` as a DOM property, not an attribute.
  function isDisabled(button: { element: Element }) {
    return (button.element as Element & { disabled?: boolean }).disabled
  }

  function mountPage() {
    const store = useTablesStore()
    store.tables = [makeTable(1, { N: 'bob' })]
    store.loaded = true
    return mount(TablesPage, { global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } } })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('shows the ban instead of Create table and disables the seats', () => {
    useAuthStore().user = { ...ana, ban: ownBan }
    const wrapper = mountPage()

    const page = wrapper.get('.tables-page')
    expect(page.text()).toContain("Until then you can't create a table or take a seat.")
    const buttons = page.findAll('ion-button')
    expect(buttons.some((b) => b.text() === 'Create table')).toBe(false)
    expect(buttons.some((b) => b.text().startsWith('Open'))).toBe(false)
    const seats = buttons.filter((b) => b.text() === 'empty')
    expect(seats.length).toBeGreaterThan(0)
    for (const seat of seats) {
      expect(isDisabled(seat)).toBe(true)
    }
  })

  test('a user who is not banned keeps them', () => {
    useAuthStore().user = ana
    const wrapper = mountPage()

    const page = wrapper.get('.tables-page')
    expect(page.text()).not.toContain("can't create a table")
    expect(page.findAll('ion-button').some((b) => b.text() === 'Create table')).toBe(true)
    const seat = page.findAll('ion-button').find((b) => b.text() === 'empty')!
    expect(isDisabled(seat)).toBe(false)
  })
})

describe('route guard for a banned user', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('sends them from a table and its game to the lobby', async () => {
    // The guard's page and bid prefetches wait on timers that never fire here.
    vi.useFakeTimers()
    vi.mocked(authService.fetchUser).mockResolvedValue({ ...ana, ban: ownBan })
    const { default: router } = await import('@/router')

    await router.push('/tables/5/play')
    expect(router.currentRoute.value.path).toBe('/tables')

    await router.push('/tables/5')
    expect(router.currentRoute.value.path).toBe('/tables')

    await router.push('/history')
    expect(router.currentRoute.value.path).toBe('/history')
  })
})
