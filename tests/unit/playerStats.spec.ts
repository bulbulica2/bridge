import { AxiosError, AxiosHeaders } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import http from '@/services/http'
import * as authService from '@/services/auth'
import { getMyStats, getUserStats } from '@/services/users'
import type { PublicUser, UserStats } from '@/services/users'
import { useAuthStore } from '@/stores/auth'
import { useUsersStore } from '@/stores/users'
import PlayerStats from '@/components/PlayerStats.vue'
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue'
import AccountPage from '@/views/AccountPage.vue'
import {
  NO_FIGURE,
  STATS_EXPLAINED,
  averageText,
  boardsLine,
  comparedNote,
  leavingLine,
  leavingReasons,
  rateText,
  setsLine,
  statsSummary,
} from '@/utils/stats'
import { percentText } from '@/utils/result'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn() },
}))
vi.mock('@/services/auth', () => ({ logout: vi.fn(), fetchUser: vi.fn(), updateProfile: vi.fn() }))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))
vi.mock('@/router/loading', () => ({ navigateAndSettle: vi.fn() }))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn(), showWelcomeToast: vi.fn() }))

const navigate = vi.fn()
// The Account page's entry hook, run by the test once the page is mounted, as
// Ionic does when the view enters.
let enterHooks: Array<() => void> = []
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  useIonRouter: () => ({ navigate }),
  onIonViewWillEnter: (hook: () => void) => enterHooks.push(hook),
}))

function axiosError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message: 'Server Error' }, statusText: '', headers: {}, config }
  return error
}

// The example of bridge_backend docs/API.md, GET /users/{user}/stats.
function statsOf(userId: number, changes: Partial<UserStats> = {}): UserStats {
  return {
    user_id: userId,
    boards: { played: 48, compared: 40, won: 26, win_rate: 0.65, average_percent: 56 },
    sets: { played: 12, won: 7, win_rate: 0.5833, average_percent: 54.2 },
    leaving: {
      abandoned: 1,
      abandoned_by_reason: { turn_timeout: 1, away: 0, moved: 0, kicked: 0, left: 0 },
      left_rate: 0.0769,
    },
    ...changes,
  }
}

// A player with nothing finished yet: zeros and nulls.
function newPlayer(userId: number): UserStats {
  return {
    user_id: userId,
    boards: { played: 0, compared: 0, won: 0, win_rate: null, average_percent: null },
    sets: { played: 0, won: 0, win_rate: null, average_percent: null },
    leaving: {
      abandoned: 0,
      abandoned_by_reason: { turn_timeout: 0, away: 0, moved: 0, kicked: 0, left: 0 },
      left_rate: null,
    },
  }
}

const ann: PublicUser = { id: 3, name: 'Ann', username: 'ann', description: 'Plays a strong club.', is_robot: false }
const me = { id: 5, name: 'Me', username: 'me', email: 'me@example.com' }

const envelope = (data: unknown) => ({ data: { status: 200, message: '', data } })

// Answers GET by URL: a profile, someone's stats, or our own.
function serve(routes: Record<string, unknown>) {
  vi.mocked(http.get).mockImplementation(async (url: string) => {
    if (!(url in routes)) {
      throw new Error(`unexpected GET ${url}`)
    }
    const answer = routes[url]
    if (answer instanceof Error) {
      throw answer
    }
    return envelope(answer)
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  enterHooks = []
})

describe('stats service', () => {
  test("getUserStats reads a player's stats and unwraps the envelope", async () => {
    serve({ '/users/3/stats': statsOf(3) })

    await expect(getUserStats(3)).resolves.toEqual(statsOf(3))
    expect(http.get).toHaveBeenCalledWith('/users/3/stats')
  })

  test('getMyStats reads your own', async () => {
    serve({ '/api/user/stats': statsOf(5) })

    await expect(getMyStats()).resolves.toEqual(statsOf(5))
    expect(http.get).toHaveBeenCalledWith('/api/user/stats')
  })
})

describe('users store stats', () => {
  test("caches a player's stats by id and reads them again each time", async () => {
    serve({ '/users/3/stats': statsOf(3) })
    const store = useUsersStore()

    await store.loadStats(3)
    expect(store.stats[3]).toEqual(statsOf(3))

    serve({ '/users/3/stats': newPlayer(3) })
    await store.loadStats(3)

    expect(http.get).toHaveBeenCalledTimes(2)
    expect(store.stats[3]).toEqual(newPlayer(3))
  })

  test('your own are kept under the id the answer names', async () => {
    serve({ '/api/user/stats': statsOf(5) })
    const store = useUsersStore()

    await expect(store.loadStats(null)).resolves.toEqual(statsOf(5))

    expect(store.stats[5]).toEqual(statsOf(5))
  })

  test('a 404 drops the cached stats and rethrows', async () => {
    const store = useUsersStore()
    store.stats[3] = statsOf(3)
    serve({ '/users/3/stats': axiosError(404) })

    await expect(store.loadStats(3)).rejects.toMatchObject({ response: { status: 404 } })

    expect(store.stats[3]).toBeUndefined()
  })

  test('other failures keep the cached stats', async () => {
    const store = useUsersStore()
    store.stats[3] = statsOf(3)
    store.stats[5] = statsOf(5)
    serve({ '/users/3/stats': axiosError(500), '/api/user/stats': axiosError(404) })

    await expect(store.loadStats(3)).rejects.toThrow()
    await expect(store.loadStats(null)).rejects.toThrow()

    expect(store.stats[3]).toEqual(statsOf(3))
    expect(store.stats[5]).toEqual(statsOf(5))
  })

  test('logout clears the stats and the profiles', async () => {
    const store = useUsersStore()
    store.stats[3] = statsOf(3)
    store.profiles[3] = ann
    const auth = useAuthStore()
    auth.user = me
    vi.mocked(authService.logout).mockResolvedValue(undefined)

    await auth.logout()

    expect(store.stats).toEqual({})
    expect(store.profiles).toEqual({})
  })
})

describe('stats wording', () => {
  test('rates are whole percentages, averages one decimal, nothing to divide by a dash', () => {
    expect(rateText(0.65)).toBe('65 %')
    expect(rateText(0.5833)).toBe('58 %')
    expect(rateText(1)).toBe('100 %')
    expect(rateText(null)).toBe(NO_FIGURE)
    expect(averageText(56)).toBe('56.0 %')
    expect(averageText(54.25)).toBe('54.3 %')
    expect(averageText(null)).toBe('—')
    expect(percentText('56.0')).toBe('56.0 %')
  })

  test('words the three groups', () => {
    const stats = statsOf(3)

    expect(setsLine(stats)).toBe('12 played · 7 won (58 %) · avg 54.2 %')
    expect(boardsLine(stats)).toBe('48 played · 26 won (65 %) · avg 56.0 %')
    expect(comparedNote(stats)).toBe('40 compared with other tables')
    expect(leavingLine(stats)).toBe('1 abandoned (8 %)')
    expect(leavingReasons(stats)).toBe('1 out of time')
  })

  test('a new player has zeros and dashes, and no notes', () => {
    const stats = newPlayer(3)

    expect(setsLine(stats)).toBe('0 played · 0 won (—) · avg —')
    expect(boardsLine(stats)).toBe('0 played · 0 won (—) · avg —')
    expect(comparedNote(stats)).toBeNull()
    expect(leavingLine(stats)).toBe('0 abandoned (—)')
    expect(leavingReasons(stats)).toBeNull()
    expect(statsSummary(stats)).toBe('No boards played yet.')
  })

  test('says why for every reason a set was left', () => {
    const stats = statsOf(3, {
      leaving: {
        abandoned: 9,
        abandoned_by_reason: { turn_timeout: 2, set_time: 3, away: 1, moved: 1, kicked: 1, left: 1 },
        left_rate: 0.3333,
      },
    })

    expect(leavingReasons(stats)).toBe(
      '2 out of time · 3 out of time for the set · 1 away · 1 moved table · 1 removed · 1 left',
    )
  })

  test('a reason the answer leaves out counts as none', () => {
    const stats = statsOf(3)
    stats.leaving.abandoned_by_reason = { moved: 2 } as UserStats['leaving']['abandoned_by_reason']

    expect(leavingReasons(stats)).toBe('2 moved table')
  })

  test("the sheet's line counts boards, singular for one", () => {
    expect(statsSummary(statsOf(3))).toBe('48 boards · 65 % won · avg 56.0 %')
    const one = statsOf(3, { boards: { played: 1, compared: 0, won: 0, win_rate: null, average_percent: null } })
    expect(statsSummary(one)).toBe('1 board · — won · avg —')
  })
})

describe('PlayerStats', () => {
  async function mountStats(props: { userId: number | null; compact?: boolean }) {
    const wrapper = mount(PlayerStats, { props })
    const load = (wrapper.vm as unknown as { load: () => Promise<void> }).load()
    return { wrapper, load }
  }

  test('shows a skeleton while loading, then the three groups', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(http.get).mockReturnValue(new Promise((r) => (resolve = r)))
    const { wrapper } = await mountStats({ userId: 3 })
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/users/3/stats')
    expect(wrapper.find('.stats-loading').exists()).toBe(true)
    expect(wrapper.findAll('.stats-skeleton')).toHaveLength(3)

    resolve(envelope(statsOf(3)))
    await flushPromises()

    expect(wrapper.find('.stats-loading').exists()).toBe(false)
    expect(wrapper.find('.stats-title').text()).toBe('Stats')
    expect(wrapper.findAll('dt').map((dt) => dt.text())).toEqual(['Sets', 'Boards', 'Left early'])
    expect(wrapper.find('.stats-sets').text()).toBe('12 played · 7 won (58 %) · avg 54.2 %')
    expect(wrapper.find('.stats-boards').text()).toBe('48 played · 26 won (65 %) · avg 56.0 %')
    expect(wrapper.find('.stats-compared').text()).toBe('40 compared with other tables')
    expect(wrapper.find('.stats-leaving').text()).toBe('1 abandoned (8 %)')
    expect(wrapper.find('.stats-reasons').text()).toBe('1 out of time')
    expect(wrapper.find('.stats-explained').text()).toBe(STATS_EXPLAINED)
    expect(wrapper.find('.stats-error').exists()).toBe(false)
  })

  test('a new player shows zeros and dashes without the notes', async () => {
    serve({ '/users/3/stats': newPlayer(3) })
    const { wrapper } = await mountStats({ userId: 3 })
    await flushPromises()

    expect(wrapper.find('.stats-sets').text()).toBe('0 played · 0 won (—) · avg —')
    expect(wrapper.find('.stats-boards').text()).toBe('0 played · 0 won (—) · avg —')
    expect(wrapper.find('.stats-leaving').text()).toBe('0 abandoned (—)')
    expect(wrapper.find('.stats-compared').exists()).toBe(false)
    expect(wrapper.find('.stats-reasons').exists()).toBe(false)
  })

  test('every board compared: no note', async () => {
    serve({
      '/users/3/stats': statsOf(3, {
        boards: { played: 4, compared: 4, won: 2, win_rate: 0.5, average_percent: 50 },
      }),
    })
    const { wrapper } = await mountStats({ userId: 3 })
    await flushPromises()

    expect(wrapper.find('.stats-compared').exists()).toBe(false)
  })

  test('null reads your own stats', async () => {
    useAuthStore().user = me
    serve({ '/api/user/stats': statsOf(5) })
    const { wrapper } = await mountStats({ userId: null })
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/api/user/stats')
    expect(wrapper.find('.stats-boards').text()).toContain('48 played')
  })

  test('nothing to show for nobody logged in', async () => {
    vi.mocked(http.get).mockReturnValue(new Promise(() => {}))
    const wrapper = mount(PlayerStats, { props: { userId: null } })

    expect(wrapper.find('.stats-groups').exists()).toBe(false)
  })

  test('a failed read says so quietly, and Retry reads again', async () => {
    serve({ '/users/3/stats': axiosError(500) })
    const { wrapper } = await mountStats({ userId: 3 })
    await flushPromises()

    expect(wrapper.find('.stats-error').text()).toContain("Couldn't load the stats.")
    expect(wrapper.find('.stats-loading').exists()).toBe(false)

    serve({ '/users/3/stats': statsOf(3) })
    await wrapper.find('.stats-error ion-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.stats-error').exists()).toBe(false)
    expect(wrapper.find('.stats-sets').exists()).toBe(true)
  })

  test('stats already held stay up while they are read again', async () => {
    useUsersStore().stats[3] = statsOf(3)
    vi.mocked(http.get).mockReturnValue(new Promise(() => {}))
    const { wrapper } = await mountStats({ userId: 3 })
    await flushPromises()

    expect(wrapper.find('.stats-loading').exists()).toBe(false)
    expect(wrapper.find('.stats-sets').exists()).toBe(true)
  })

  test('a 401 sends the user to log in', async () => {
    serve({ '/users/3/stats': axiosError(401) })
    const { wrapper } = await mountStats({ userId: 3 })
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
    expect(wrapper.find('.stats-error').exists()).toBe(false)
  })

  test('only the latest read settles the state', async () => {
    const answers: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
    vi.mocked(http.get).mockImplementation(
      () => new Promise((resolve, reject) => answers.push({ resolve, reject })),
    )
    const { wrapper } = await mountStats({ userId: 3 })
    await wrapper.setProps({ userId: 4 })
    const second = (wrapper.vm as unknown as { load: () => Promise<void> }).load()
    await flushPromises()

    // The first player's read fails after the second began: nothing said.
    answers[0].reject(axiosError(500))
    await flushPromises()
    expect(wrapper.find('.stats-error').exists()).toBe(false)
    expect(wrapper.find('.stats-loading').exists()).toBe(true)

    answers[1].resolve(envelope(statsOf(4)))
    await second
    await flushPromises()
    expect(wrapper.find('.stats-loading').exists()).toBe(false)
    expect(wrapper.find('.stats-sets').exists()).toBe(true)
  })

  test('only the latest read settles the state when an older one succeeds late', async () => {
    const answers: Array<(v: unknown) => void> = []
    vi.mocked(http.get).mockImplementation(() => new Promise((resolve) => answers.push(resolve)))
    const { wrapper } = await mountStats({ userId: 3 })
    await wrapper.setProps({ userId: 4 })
    void (wrapper.vm as unknown as { load: () => Promise<void> }).load()
    await flushPromises()

    answers[0](envelope(statsOf(3)))
    await flushPromises()

    expect(wrapper.find('.stats-loading').exists()).toBe(true)
  })

  test('compact: one line, a one-line skeleton', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(http.get).mockReturnValue(new Promise((r) => (resolve = r)))
    const { wrapper } = await mountStats({ userId: 3, compact: true })
    await flushPromises()

    expect(wrapper.findAll('.stats-skeleton')).toHaveLength(1)
    expect(wrapper.find('.stats-title').exists()).toBe(false)

    resolve(envelope(statsOf(3)))
    await flushPromises()

    expect(wrapper.find('.stats-summary').text()).toBe('48 boards · 65 % won · avg 56.0 %')
    expect(wrapper.find('.stats-groups').exists()).toBe(false)
  })
})

describe('PlayerProfileSheet stats', () => {
  const modalStub = { template: '<div><slot /></div>' }
  function mountSheet(player: PublicUser | null) {
    return mount(PlayerProfileSheet, {
      props: { player },
      global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
    })
  }

  test("shows one line of the player's stats", async () => {
    serve({ '/users/3': ann, '/users/3/stats': statsOf(3) })
    const wrapper = mountSheet(ann)
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/users/3/stats')
    expect(wrapper.find('.stats-summary').text()).toBe('48 boards · 65 % won · avg 56.0 %')
  })

  test('reads the next player tapped', async () => {
    const bob: PublicUser = { id: 4, name: 'Bob', username: 'bob', description: null, is_robot: false }
    serve({ '/users/3': ann, '/users/3/stats': statsOf(3), '/users/4': bob, '/users/4/stats': newPlayer(4) })
    const wrapper = mountSheet(ann)
    await flushPromises()

    await wrapper.setProps({ player: bob })
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/users/4/stats')
    expect(wrapper.find('.stats-summary').text()).toBe('No boards played yet.')
  })

  test('a failed read shows the retry note under a profile that loaded', async () => {
    serve({ '/users/3': ann, '/users/3/stats': axiosError(500) })
    const wrapper = mountSheet(ann)
    await flushPromises()

    expect(wrapper.find('.profile-description').text()).toBe('Plays a strong club.')
    expect(wrapper.find('.stats-error').text()).toContain("Couldn't load the stats.")
  })

  test('nothing for a robot', async () => {
    const robot: PublicUser = { id: 9, name: 'Robot 1', username: 'robot-1', description: null, is_robot: true }
    serve({ '/users/9': robot })
    const wrapper = mountSheet(robot)
    await flushPromises()

    expect(wrapper.find('.player-stats').exists()).toBe(false)
    expect(http.get).not.toHaveBeenCalledWith('/users/9/stats')
  })

  test('nothing for an account that is gone', async () => {
    serve({ '/users/3': axiosError(404), '/users/3/stats': axiosError(404) })
    const wrapper = mountSheet(ann)
    await flushPromises()

    expect(wrapper.text()).toContain('no longer exists')
    expect(wrapper.find('.player-stats').exists()).toBe(false)
  })
})

describe('AccountPage stats', () => {
  test('shows your own stats, read again on every visit', async () => {
    useAuthStore().user = me
    serve({ '/api/user/stats': statsOf(5) })
    const wrapper = mount(AccountPage)
    enterHooks.forEach((hook) => hook())
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/api/user/stats')
    expect(wrapper.find('.account-stats .stats-boards').text()).toBe('48 played · 26 won (65 %) · avg 56.0 %')

    enterHooks.forEach((hook) => hook())
    await flushPromises()
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  test('a new player sees zeros and dashes', async () => {
    useAuthStore().user = me
    serve({ '/api/user/stats': newPlayer(5) })
    const wrapper = mount(AccountPage)
    enterHooks.forEach((hook) => hook())
    await flushPromises()

    expect(wrapper.find('.stats-sets').text()).toBe('0 played · 0 won (—) · avg —')
  })

  test('a failed read shows the retry note', async () => {
    useAuthStore().user = me
    serve({ '/api/user/stats': axiosError(500) })
    const wrapper = mount(AccountPage)
    enterHooks.forEach((hook) => hook())
    await flushPromises()

    expect(wrapper.find('.stats-error').text()).toContain("Couldn't load the stats.")
  })
})
