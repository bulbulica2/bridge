import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { pullToRefresh } from './ionEvents'
import TablesPage from '@/views/TablesPage.vue'
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue'
import * as historyService from '@/services/history'
import * as tablesService from '@/services/tables'
import * as usersService from '@/services/users'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useTablesStore } from '@/stores/tables'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
  createTable: vi.fn(),
  sendHeartbeat: vi.fn(),
}))
vi.mock('@/services/users', () => ({ getMyStats: vi.fn() }))
vi.mock('@/services/history', () => ({ getMyPlayings: vi.fn(), getSet: vi.fn() }))
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
// Entering the page loads the list; outside a router outlet that is mounting.
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})

function axiosError(status: number, message = 'Refused.'): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message }, statusText: '', headers: {}, config }
  return error
}

function makeTable(id: number, seats: Partial<Record<Seat, string>>): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id,
    name: `Table ${id}`,
    created_by: 1,
    moderated_by: 1,
    board_id: null,
    unattended_since: null,
    created_at: '',
    updated_at: '',
    seats: taken.map(([seat, username], i) => {
      const userId = username === 'ana' ? 1 : id * 10 + i + 100
      return {
        id: id * 10 + i,
        table_id: id,
        user_id: userId,
        seat,
        ready: false,
        away_since: null,
        replace_at: null,
        user: { id: userId, name: username, username, description: null, is_robot: false, is_admin: false },
      }
    }),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: false,
    set_minutes: 16,
    set: null,
  }
}

const mountPage = () =>
  mount(TablesPage, {
    global: { stubs: { PlayerProfileSheet: true, 'router-link': RouterLinkStub } },
  })

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
  // The aside's reads have their own tests below: they never answer here.
  vi.mocked(usersService.getMyStats).mockReturnValue(new Promise(() => {}))
  vi.mocked(historyService.getMyPlayings).mockReturnValue(new Promise(() => {}))
})

afterEach(() => {
  useTablesStore().unwatchTable()
})

describe('TablesPage.vue loading', () => {
  test('shows skeleton rows on the first visit, then the list', async () => {
    let answer!: (tables: Table[]) => void
    vi.mocked(tablesService.listTables).mockReturnValue(new Promise((r) => (answer = r)))
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('ion-skeleton-text').exists()).toBe(true)

    answer([makeTable(2, { N: 'bob' })])
    await flushPromises()

    expect(wrapper.find('ion-skeleton-text').exists()).toBe(false)
    expect(wrapper.text()).toContain('Table 2')
  })

  test('a failed load shows an error', async () => {
    vi.mocked(tablesService.listTables).mockRejectedValue(new Error('offline'))
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.error').text()).toBe('Could not load the tables. Please try again.')
  })

  test('an expired session goes to log in', async () => {
    vi.mocked(tablesService.listTables).mockRejectedValue(axiosError(401))
    mountPage()
    await flushPromises()

    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })

  test('pull to refresh keeps the list up while it reloads', async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(2, { N: 'bob' })])
    const wrapper = mountPage()
    await flushPromises()
    const complete = vi.fn()
    vi.mocked(tablesService.listTables).mockReturnValue(new Promise(() => {}))

    await pullToRefresh(wrapper, complete)
    await flushPromises()

    expect(wrapper.find('.refreshing').exists()).toBe(true)
    expect(wrapper.text()).toContain('Table 2')
  })

  test('the refresher completes once the list is back', async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([])
    const wrapper = mountPage()
    await flushPromises()
    const complete = vi.fn()

    await pullToRefresh(wrapper, complete)
    await flushPromises()

    expect(tablesService.listTables).toHaveBeenCalledTimes(2)
    expect(complete).toHaveBeenCalled()
  })

  test('a held seat offers to come back to its game', async () => {
    const mine = makeTable(4, { N: 'ana', E: 'bob' })
    vi.mocked(tablesService.listTables).mockResolvedValue([mine])
    const wrapper = mountPage()
    await flushPromises()

    useTablesStore().heldTableId = 4
    await flushPromises()

    const button = wrapper.getComponent('.your-table-go')
    expect(button.text()).toBe('Come back')
    expect(button.props('routerLink')).toBe('/tables/4/play')
  })

  test('tapping a player opens their profile, closing it clears it', async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(2, { N: 'bob' })])
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.seat-user').trigger('click')
    const sheet = wrapper.findComponent(PlayerProfileSheet)
    expect(sheet.props('player')).toMatchObject({ username: 'bob' })

    sheet.vm.$emit('close')
    await flushPromises()
    expect(sheet.props('player')).toBeNull()
  })

  test("a refused create shows the backend's reason in the form", async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([])
    vi.mocked(tablesService.createTable).mockRejectedValue(axiosError(409, 'You already have 3 active tables.'))
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('You already have 3 active tables.')
    expect(navigate).not.toHaveBeenCalled()
  })

  test('an invalid name shows the error on the card, and goes nowhere', async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([])
    vi.mocked(tablesService.createTable).mockRejectedValue(axiosError(422, 'The name field must not be greater than 50 characters.'))
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('.start-friends .error').text()).toBe('The name field must not be greater than 50 characters.')
    expect(navigate).not.toHaveBeenCalled()
  })

  test("once the list is in, the aside reads our form and recent boards", async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([])
    vi.mocked(usersService.getMyStats).mockResolvedValue({
      user_id: 1,
      boards: { played: 34, compared: 30, won: 18, win_rate: 0.6, average_percent: 54.25 },
      sets: { played: 8, won: 3, win_rate: 0.375, average_percent: 51 },
      leaving: { abandoned: 0, abandoned_by_reason: {} as never, left_rate: 0 },
    })
    vi.mocked(historyService.getMyPlayings).mockResolvedValue({
      current_page: 1,
      last_page: 1,
      next_page_url: null,
      per_page: 20,
      total: 1,
      data: [
        {
          playing_id: 9,
          table_id: 4,
          set: { id: 2, number: 3, board: 1, of: 4 },
          board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
          seat: 'S',
          partner: null,
          contract: { id: 1, call: '4S', level: 4, strain: 'S', special: false },
          doubled: 0,
          declarer: 'S',
          tricks_won: 11,
          score_ns: 450,
          made_by: 1,
          score: 450,
          finished_at: '2026-10-01T12:00:00Z',
        },
      ],
    })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findAll('.form-figure b').map((b) => b.text())).toEqual(['54.3 %', '3 / 8', '34'])
    expect(wrapper.get('.recent-row').text()).toContain('4♠ S +1')
    expect(wrapper.get('.recent-row').text()).toContain('Set 3 · B1')
  })

})
