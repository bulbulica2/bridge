import { AxiosError, AxiosHeaders } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import http from '@/services/http'
import { getUser } from '@/services/users'
import type { PublicUser } from '@/services/users'
import { useUsersStore } from '@/stores/users'
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn() },
}))

const navigate = vi.fn()
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

const ann: PublicUser = { id: 3, name: 'Ann', username: 'ann', description: 'Plays a strong club.' }

// GET /users/{id} as the backend answers it: the public profile in the envelope.
function answer(user: PublicUser) {
  vi.mocked(http.get).mockResolvedValue({
    data: { status: 200, message: 'User retrieved successfully.', data: user },
  })
}

// Laravel's route-model binding 404: a bare {message}, no envelope.
function notFound() {
  vi.mocked(http.get).mockRejectedValue(axiosError(404, { message: 'Not Found' }))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
})

describe('users service', () => {
  test('getUser unwraps the envelope', async () => {
    answer(ann)

    await expect(getUser(3)).resolves.toEqual(ann)
    expect(http.get).toHaveBeenCalledWith('/users/3')
  })

  test('getUser rejects with the 404 for an unknown id', async () => {
    notFound()

    await expect(getUser(999)).rejects.toMatchObject({ response: { status: 404 } })
  })
})

describe('users store', () => {
  test('load caches the fresh profile', async () => {
    answer(ann)
    const store = useUsersStore()

    await store.load(3)

    expect(store.profiles[3]).toEqual(ann)
  })

  test('a 404 drops the cached profile and rethrows', async () => {
    const store = useUsersStore()
    store.profiles[3] = ann
    notFound()

    await expect(store.load(3)).rejects.toMatchObject({ response: { status: 404 } })
    expect(store.profiles[3]).toBeUndefined()
  })

  test('other failures keep the cached profile', async () => {
    const store = useUsersStore()
    store.profiles[3] = ann
    vi.mocked(http.get).mockRejectedValue(axiosError(500, { message: 'Server Error' }))

    await expect(store.load(3)).rejects.toBeTruthy()
    expect(store.profiles[3]).toEqual(ann)
  })
})

describe('PlayerProfileSheet', () => {
  // IonModal only renders its content once presented, which jsdom never does,
  // so render the sheet's content inline instead.
  const modalStub = { template: '<div><slot /></div>' }
  function mountSheet(player: PublicUser | null) {
    return mount(PlayerProfileSheet, {
      props: { player },
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
  }

  test('shows the embedded profile at once, then the fresh one', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(http.get).mockReturnValue(new Promise((r) => (resolve = r)))
    const wrapper = mountSheet({ ...ann, description: 'Old description.' })
    await flushPromises()

    expect(wrapper.text()).toContain('Old description.')
    expect(wrapper.text()).toContain('Refreshing')

    resolve({ data: { status: 200, message: '', data: ann } })
    await flushPromises()

    expect(wrapper.text()).toContain('Plays a strong club.')
    expect(wrapper.text()).not.toContain('Refreshing')
    expect(wrapper.text()).not.toContain('@example.com')
  })

  test('says so when the player no longer exists', async () => {
    notFound()
    const wrapper = mountSheet(ann)
    await flushPromises()

    expect(wrapper.text()).toContain('no longer exists')
    expect(wrapper.text()).not.toContain('Plays a strong club.')
  })

  test('keeps the embedded profile when the refresh fails', async () => {
    vi.mocked(http.get).mockRejectedValue(axiosError(500, { message: 'Server Error' }))
    const wrapper = mountSheet(ann)
    await flushPromises()

    expect(wrapper.text()).toContain('Plays a strong club.')
    expect(wrapper.text()).toContain('Server Error')
  })

  test('Full profile closes the sheet and opens /users/:id', async () => {
    answer(ann)
    const wrapper = mountSheet(ann)
    await flushPromises()

    await wrapper.find('ion-button').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(navigate).toHaveBeenCalledWith('/users/3', 'forward')
  })
})
