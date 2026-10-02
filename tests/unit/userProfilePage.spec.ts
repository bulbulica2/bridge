import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { IonRefresher } from '@ionic/vue'
import UserProfilePage from '@/views/UserProfilePage.vue'
import { getUser } from '@/services/users'
import { getMyPlayings, getUserPlayings } from '@/services/history'
import type { PublicUser } from '@/services/users'
import { useAuthStore } from '@/stores/auth'
import { useUsersStore } from '@/stores/users'

vi.mock('@/services/users', () => ({ getUser: vi.fn() }))
vi.mock('@/services/history', () => ({ getMyPlayings: vi.fn(), getUserPlayings: vi.fn() }))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))

const navigate = vi.fn()
const route = { params: {} as Record<string, string> }
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

function axiosError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message: 'Server Error' }, statusText: '', headers: {}, config }
  return error
}

const ann: PublicUser = { id: 3, name: 'Ann', username: 'ann', description: 'Plays a strong club.', is_robot: false }
const emptyPage = { data: [], current_page: 1, last_page: 1, total: 0 }

const mountPage = () => mount(UserProfilePage, { global: { stubs: { 'router-link': true } } })

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  route.params = { id: '3' }
  vi.mocked(getUserPlayings).mockResolvedValue(emptyPage)
  vi.mocked(getMyPlayings).mockResolvedValue(emptyPage)
})

describe('UserProfilePage', () => {
  test("shows the player's profile, then their boards", async () => {
    vi.mocked(getUser).mockResolvedValue(ann)
    const wrapper = mountPage()
    expect(wrapper.text()).toContain('Loading profile…')

    await flushPromises()

    expect(getUser).toHaveBeenCalledWith(3)
    expect(wrapper.find('.profile-name').text()).toBe('Ann')
    expect(wrapper.find('.profile-username').text()).toBe('@ann')
    expect(wrapper.find('.profile-description').text()).toBe('Plays a strong club.')
    expect(wrapper.find('.profile-mine').exists()).toBe(false)
    expect(getUserPlayings).toHaveBeenCalledWith(3, 1)
    expect(wrapper.text()).toContain('No finished boards yet.')
  })

  test('your own profile points to Account and lists "My boards"', async () => {
    useAuthStore().user = { id: 3, name: 'Ann', username: 'ann', email: 'ann@example.com' }
    vi.mocked(getUser).mockResolvedValue({ ...ann, description: null })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.profile-mine').exists()).toBe(true)
    expect(wrapper.find('.profile-empty').text()).toBe('No description yet.')
    expect(getMyPlayings).toHaveBeenCalled()
    expect(getUserPlayings).not.toHaveBeenCalled()
  })

  test('a profile already held shows at once and refreshes in place', async () => {
    useUsersStore().profiles[3] = ann
    vi.mocked(getUser).mockReturnValue(new Promise(() => {}))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.profile-name').text()).toBe('Ann')
    expect(wrapper.find('.refreshing').exists()).toBe(true)
  })

  test("an id that can't be a user is not found without asking", async () => {
    route.params = { id: 'abc' }
    const wrapper = mountPage()
    await flushPromises()

    expect(getUser).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain("This player doesn't exist.")
  })

  test('a 404 says the player does not exist', async () => {
    vi.mocked(getUser).mockRejectedValue(axiosError(404))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain("This player doesn't exist.")
  })

  test('a 401 sends the user to log in', async () => {
    vi.mocked(getUser).mockRejectedValue(axiosError(401))
    mountPage()
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })

  test('another failure shows an error and Refresh tries again', async () => {
    vi.mocked(getUser).mockRejectedValueOnce(new Error('offline'))
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('.error').text()).toBe('Could not load this profile. Please try again.')

    vi.mocked(getUser).mockResolvedValue(ann)
    useUsersStore().profiles[3] = ann
    await flushPromises()
    await wrapper.find('ion-button.refresh').trigger('click')
    await flushPromises()

    expect(getUser).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.error').exists()).toBe(false)
  })

  test('pull to refresh reloads and completes the refresher', async () => {
    vi.mocked(getUser).mockResolvedValue(ann)
    const wrapper = mountPage()
    await flushPromises()
    const complete = vi.fn()

    wrapper.findComponent(IonRefresher).vm.$emit('ionRefresh', { target: { complete } })
    await flushPromises()

    expect(getUser).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalled()
  })
})
