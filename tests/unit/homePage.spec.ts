import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { IonButton } from '@ionic/vue'
import HomePage from '@/views/HomePage.vue'
import { useAuthStore } from '@/stores/auth'
import * as tablesService from '@/services/tables'
import type { Seat, Table } from '@/services/tables'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
}))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))

const ana = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }

const ids: Record<string, number> = { ana: 1, bob: 2, cid: 3, dan: 4 }

function makeTable(id: number, seats: Partial<Record<Seat, string>>, board_id: number | null = null): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id,
    name: `Table ${id}`,
    created_by: 1,
    moderated_by: 1,
    board_id,
    created_at: '2026-09-20T10:00:00.000000Z',
    updated_at: '2026-09-20T10:00:00.000000Z',
    seats: taken.map(([seat, username], i) => ({
      id: id * 10 + i,
      table_id: id,
      user_id: ids[username],
      seat,
      user: { id: ids[username], name: username, username, description: null },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
  }
}

// Ionic's onIonViewWillEnter never fires outside a router outlet, so the page
// is mounted as a guest and the login triggers the table lookup, as it would
// if someone logged in while Home was on screen.
async function mountLoggedIn() {
  const wrapper = mount(HomePage)
  useAuthStore().user = ana
  await flushPromises()
  return wrapper
}

// The header adds an Account button once logged in, so stay inside the page body.
// router-link is a prop of Ionic's Vue wrapper, not a DOM attribute.
function pageLinks(wrapper: VueWrapper) {
  return wrapper
    .findAllComponents(IonButton)
    .filter((b) => b.element.closest('.home'))
    .map((b) => ({ text: b.text(), to: b.props('routerLink') }))
}

describe('HomePage.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  test('explains the app to guests and offers log in and sign up', () => {
    const wrapper = mount(HomePage)

    expect(wrapper.text()).toContain('13 tricks')
    expect(pageLinks(wrapper).map((l) => l.to)).toEqual(['/login', '/create-account'])
    expect(tablesService.listTables).not.toHaveBeenCalled()
  })

  test('shows a seated user their table, one tap away', async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([
      makeTable(2, { N: 'bob' }),
      makeTable(7, { E: 'ana', S: 'bob' }, 3),
    ])
    const wrapper = await mountLoggedIn()

    expect(wrapper.text()).toContain('Welcome back, Ana!')
    const card = wrapper.find('.your-table')
    expect(card.text()).toContain('Table 7')
    expect(card.text()).toContain('Board in progress')
    expect(card.text()).toContain('ana (you)')
    expect(card.text()).toContain('bob')
    expect(pageLinks(wrapper)).toEqual([{ text: 'Go to table', to: '/tables/7' }])
  })

  test('leaves out the board badge when no board is being played', async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(7, { N: 'ana' })])
    const wrapper = await mountLoggedIn()

    expect(wrapper.find('.your-table').text()).not.toContain('Board in progress')
  })

  test('sends an unseated user to find a table', async () => {
    vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(2, { N: 'bob' })])
    const wrapper = await mountLoggedIn()

    expect(wrapper.find('.your-table').exists()).toBe(false)
    expect(pageLinks(wrapper)).toEqual([{ text: 'Find a table', to: '/tables' }])
  })

  test('says so when the table lookup fails', async () => {
    vi.mocked(tablesService.listTables).mockRejectedValue(new Error('offline'))
    const wrapper = await mountLoggedIn()

    expect(wrapper.text()).toContain('Could not check your table')
  })
})
