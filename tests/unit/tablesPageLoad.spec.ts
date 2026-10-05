import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { IonButton, IonRefresher } from '@ionic/vue'
import TablesPage from '@/views/TablesPage.vue'
import PlayerProfileSheet from '@/components/PlayerProfileSheet.vue'
import * as tablesService from '@/services/tables'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useTablesStore } from '@/stores/tables'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
  createTable: vi.fn(),
  sendHeartbeat: vi.fn(),
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
        user: { id: userId, name: username, username, description: null, is_robot: false },
      }
    }),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: false,
  }
}

const modalStub = { props: ['isOpen'], template: '<div class="modal" :data-open="isOpen"><slot /></div>' }
const mountPage = () =>
  mount(TablesPage, {
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub, PlayerProfileSheet: true } },
  })

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  useAuthStore().user = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
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

    wrapper.findComponent(IonRefresher).vm.$emit('ionRefresh', { target: { complete } })
    await flushPromises()

    expect(wrapper.find('.refreshing').exists()).toBe(true)
    expect(wrapper.text()).toContain('Table 2')
  })

  test('the refresher completes once the list is back', async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([])
    const wrapper = mountPage()
    await flushPromises()
    const complete = vi.fn()

    wrapper.findComponent(IonRefresher).vm.$emit('ionRefresh', { target: { complete } })
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

    const button = wrapper.find('.held').findComponent(IonButton)
    expect(button.text()).toBe('Come back to Table 4')
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

  test('an invalid name keeps the modal open with the error, and goes nowhere', async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([])
    vi.mocked(tablesService.createTable).mockRejectedValue(axiosError(422, 'The name field must not be greater than 50 characters.'))
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('ion-button').find((b) => b.text() === 'Create table')!.trigger('click')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('.modal').attributes('data-open')).toBe('true')
    expect(wrapper.text()).toContain('The name field must not be greater than 50 characters.')
    expect(navigate).not.toHaveBeenCalled()
  })
})
