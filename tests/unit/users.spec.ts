import { AxiosError, AxiosHeaders } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import http from '@/services/http'
import { getUser, searchUsers } from '@/services/users'
import type { PublicUser, SearchedUser } from '@/services/users'
import { SEARCH_DEBOUNCE_MS, useUserSearch } from '@/composables/useUserSearch'
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

const jo: SearchedUser = { id: 7, name: 'Joanna', username: 'jo', description: null, seated: true }

// GET /users?search= as the backend answers it: the matches in the envelope.
function found(users: SearchedUser[]) {
  return { data: { status: 200, message: 'Users retrieved successfully.', data: users } }
}

describe('user search', () => {
  test('searchUsers sends the term as a query parameter and unwraps the envelope', async () => {
    vi.mocked(http.get).mockResolvedValue(found([jo]))

    await expect(searchUsers('jo')).resolves.toEqual([jo])
    expect(http.get).toHaveBeenCalledWith('/users', { params: { search: 'jo' } })
  })

  describe('useUserSearch', () => {
    // The composable cleans up with its scope, as it would with a component.
    let scope: ReturnType<typeof effectScope>

    function start() {
      scope = effectScope()
      return scope.run(() => useUserSearch())!
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      scope?.stop()
      vi.useRealTimers()
    })

    test('waits for a pause in the typing and sends only the last term', async () => {
      vi.mocked(http.get).mockResolvedValue(found([jo]))
      const search = start()

      for (const text of ['jo', 'joa', 'joan']) {
        search.query.value = text
        await nextTick()
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50)
      }
      expect(http.get).not.toHaveBeenCalled()
      expect(search.searching.value).toBe(true)

      vi.advanceTimersByTime(50)
      await flushPromises()

      expect(http.get).toHaveBeenCalledTimes(1)
      expect(http.get).toHaveBeenCalledWith('/users', { params: { search: 'joan' } })
      expect(search.results.value).toEqual([jo])
      expect(search.searched.value).toBe('joan')
      expect(search.searching.value).toBe(false)
    })

    test('never searches fewer than two characters, spaces aside', async () => {
      const search = start()

      search.query.value = ' j '
      await nextTick()
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2)

      expect(http.get).not.toHaveBeenCalled()
      expect(search.tooShort.value).toBe(true)
      expect(search.searching.value).toBe(false)
    })

    test('trims the term it sends', async () => {
      vi.mocked(http.get).mockResolvedValue(found([]))
      const search = start()

      search.query.value = '  ann  '
      await nextTick()
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
      await flushPromises()

      expect(http.get).toHaveBeenCalledWith('/users', { params: { search: 'ann' } })
      expect(search.results.value).toEqual([])
      expect(search.searched.value).toBe('ann')
    })

    test('an answer that arrives after the box was cleared is dropped', async () => {
      let answerLate: (value: unknown) => void = () => {}
      vi.mocked(http.get).mockReturnValue(new Promise((resolve) => (answerLate = resolve)))
      const search = start()

      search.query.value = 'jo'
      await nextTick()
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
      search.query.value = 'j'
      await nextTick()
      answerLate(found([jo]))
      await flushPromises()

      expect(search.results.value).toEqual([])
      expect(search.searched.value).toBeNull()
      expect(search.searching.value).toBe(false)
    })

    test('a throttled search says so', async () => {
      vi.mocked(http.get).mockRejectedValue(axiosError(429, { message: 'Too Many Attempts.' }))
      const search = start()

      search.query.value = 'jo'
      await nextTick()
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
      await flushPromises()

      expect(search.error.value).toMatch(/too many searches/i)
      expect(search.searching.value).toBe(false)
    })

    test('reset clears the box and cancels a pending search', async () => {
      const search = start()

      search.query.value = 'jo'
      await nextTick()
      search.reset()
      await nextTick()
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2)

      expect(http.get).not.toHaveBeenCalled()
      expect(search.query.value).toBe('')
      expect(search.searching.value).toBe(false)
    })
  })
})
