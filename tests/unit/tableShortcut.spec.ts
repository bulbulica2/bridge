import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { IonBadge, IonButton, IonItem, IonSplitPane, menuController } from '@ionic/vue'
import App from '@/App.vue'
import AppHeader from '@/components/AppHeader.vue'
import AppMenu from '@/components/AppMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'
import * as tablesService from '@/services/tables'
import type { Playing } from '@/services/game'
import type { Seat, Table } from '@/services/tables'
import {
  MENU_PINNED_KEY,
  menuPinned,
  readMenuPinned,
  setMenuPinned,
  toggleMenu,
} from '@/utils/menu'

vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  listTables: vi.fn(),
}))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))
vi.mock('@ionic/vue', async (importOriginal) => {
  const ionic = await importOriginal<typeof import('@ionic/vue')>()
  return { ...ionic, menuController: { ...ionic.menuController, toggle: vi.fn() } }
})

const ana = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }
const ids: Record<string, number> = { ana: 1, bob: 2, cid: 3, dan: 4 }

function makeTable(
  id: number,
  seats: Partial<Record<Seat, string>>,
  overrides: Partial<Table> = {},
): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id,
    name: `Table ${id}`,
    created_by: 1,
    moderated_by: 1,
    board_id: null,
    unattended_since: null,
    created_at: '2026-09-20T10:00:00.000000Z',
    updated_at: '2026-09-20T10:00:00.000000Z',
    seats: taken.map(([seat, username], i) => ({
      id: id * 10 + i,
      table_id: id,
      user_id: ids[username],
      seat,
      ready: true,
      away_since: null,
      user: { id: ids[username], name: username, username, description: null, is_robot: false },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: false,
    ...overrides,
  }
}

const full = { N: 'bob', E: 'ana', S: 'cid', W: 'dan' }

// What the tables store would hold once it found Ana's seat.
function seatAt(table: Table) {
  useAuthStore().user = ana
  const tables = useTablesStore()
  tables.tables = [table]
  tables.loaded = true
}

const Blank = defineComponent({ template: '<div />' })

function routerAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/:rest(.*)*', component: Blank },
    ],
  })
  router.push(path)
  return router
}

async function mountHeader(path?: string) {
  const router = path ? routerAt(path) : null
  if (router) {
    await router.isReady()
  }
  return mount(AppHeader, {
    props: { title: 'My boards' },
    global: { plugins: router ? [router] : [] },
  })
}

function shortcut(wrapper: VueWrapper) {
  return wrapper.findAllComponents(IonButton).find((b) => b.classes('table-shortcut'))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  menuPinned.value = true
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the header\'s "Your table"', () => {
  test('a guest gets no button', async () => {
    const wrapper = await mountHeader()

    expect(shortcut(wrapper)).toBeUndefined()
  })

  test('nobody seated gets no button', async () => {
    useAuthStore().user = ana
    useTablesStore().tables = [makeTable(2, { N: 'bob' })]
    const wrapper = await mountHeader()

    expect(shortcut(wrapper)).toBeUndefined()
  })

  test('a banned user gets no button: the table pages would send them away', async () => {
    seatAt(makeTable(7, full))
    useAuthStore().user = { ...ana, ban: { reason: 'x', until: '2026-12-01', banned_at: '2026-10-01' } }
    const wrapper = await mountHeader()

    expect(shortcut(wrapper)).toBeUndefined()
  })

  test('with no board, it leads to the table and shows no status', async () => {
    seatAt(makeTable(7, full))
    const wrapper = await mountHeader('/history')

    const button = shortcut(wrapper)!
    expect(button.text()).toContain('Table 7')
    expect(button.props('routerLink')).toBe('/tables/7')
    expect(button.attributes('aria-label')).toBe('Your table: Table 7')
    expect(button.attributes('aria-current')).toBeUndefined()
    expect(button.find('.status-dot').exists()).toBe(false)
  })

  test('with a board dealt, it leads to the game and says a board is on', async () => {
    seatAt(makeTable(7, full, { board_id: 3 }))
    const wrapper = await mountHeader('/history')

    const button = shortcut(wrapper)!
    expect(button.props('routerLink')).toBe('/tables/7/play')
    expect(button.find('.status-board').exists()).toBe(true)
    expect(button.attributes('aria-label')).toBe('Your table: Table 7, board in progress')
  })

  test('a table without a name goes by its number', async () => {
    seatAt(makeTable(7, full, { name: '' }))
    const wrapper = await mountHeader()

    expect(shortcut(wrapper)!.text()).toContain('Table #7')
  })

  test('follows the seat live: it appears when the user sits down and goes when they leave', async () => {
    useAuthStore().user = ana
    const tables = useTablesStore()
    const wrapper = await mountHeader()
    expect(shortcut(wrapper)).toBeUndefined()

    tables.tables = [makeTable(7, full)]
    await nextTick()
    expect(shortcut(wrapper)!.props('routerLink')).toBe('/tables/7')

    tables.tables = [makeTable(7, full, { board_id: 3 })]
    await nextTick()
    expect(shortcut(wrapper)!.props('routerLink')).toBe('/tables/7/play')

    tables.tables = [makeTable(7, { N: 'bob' })]
    await nextTick()
    expect(shortcut(wrapper)).toBeUndefined()
  })

  test('a held seat leads back to the game and says so, ahead of anything else', async () => {
    seatAt(makeTable(7, full))
    useTablesStore().heldTableId = 7
    const wrapper = await mountHeader()

    const button = shortcut(wrapper)!
    expect(button.props('routerLink')).toBe('/tables/7/play')
    expect(button.find('.status-away').exists()).toBe(true)
    expect(button.attributes('aria-label')).toBe('Your table: Table 7, away')
  })

  test('a seat marked away counts as away too', async () => {
    const table = makeTable(7, full, { board_id: 3 })
    table.seats[1].away_since = '2026-10-04T10:00:00Z'
    seatAt(table)
    const wrapper = await mountHeader()

    expect(shortcut(wrapper)!.find('.status-away').exists()).toBe(true)
  })

  test('says when the game waits for the user', async () => {
    seatAt(makeTable(7, full, { board_id: 3 }))
    const game = useGameStore()
    game.tableId = 7
    game.playing = { phase: 'auction', acting_user_id: ana.id, board: { id: 3 } } as unknown as Playing
    const wrapper = await mountHeader()

    const button = shortcut(wrapper)!
    expect(button.find('.status-turn').exists()).toBe(true)
    expect(button.attributes('aria-label')).toBe('Your table: Table 7, your turn')
    // The Daylight pill: tinted, the turn written out beside the name.
    expect(button.classes()).toContain('turn-pill')
    expect(button.get('.table-shortcut-turn').text()).toBe('Your turn')

    game.playing = { ...game.playing, acting_user_id: ids.bob }
    await nextTick()
    expect(button.find('.status-board').exists()).toBe(true)
    expect(button.classes()).not.toContain('turn-pill')
    expect(button.find('.table-shortcut-turn').exists()).toBe(false)
  })

  test('the pill counts our turn clock down', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-05T12:00:00Z'))
    try {
      seatAt(makeTable(7, full, { board_id: 3 }))
      const game = useGameStore()
      game.tableId = 7
      game.playing = {
        phase: 'auction',
        acting_user_id: ana.id,
        board: { id: 3 },
        turn_deadline: '2026-10-05T12:00:42Z',
      } as unknown as Playing
      const wrapper = await mountHeader()

      expect(shortcut(wrapper)!.get('.table-shortcut-turn').text()).toBe('Your turn · 0:42')
    } finally {
      vi.useRealTimers()
    }
  })

  test('a Start the table waits for is the user\'s turn too', async () => {
    const table = makeTable(7, full)
    table.seats[1].ready = false
    seatAt(table)
    const wrapper = await mountHeader()

    expect(shortcut(wrapper)!.find('.status-turn').exists()).toBe(true)
  })

  test('another table\'s board in the game store says nothing about ours', async () => {
    seatAt(makeTable(7, full, { board_id: 3 }))
    const game = useGameStore()
    game.tableId = 9
    game.playing = { phase: 'auction', acting_user_id: ana.id } as unknown as Playing
    const wrapper = await mountHeader()

    expect(shortcut(wrapper)!.find('.status-board').exists()).toBe(true)
  })

  test('on the page it leads to, it shows as the current page and leads nowhere', async () => {
    seatAt(makeTable(7, full, { board_id: 3 }))
    const wrapper = await mountHeader('/tables/7/play')

    const button = shortcut(wrapper)!
    expect(button.attributes('aria-current')).toBe('page')
    // Ionic's wrapper reads an unset router-link as a Symbol.
    expect(typeof button.props('routerLink')).not.toBe('string')
    expect(button.props('fill')).toBe('solid')
  })

  test('on the table\'s other page it shows as current but still leads to the game', async () => {
    seatAt(makeTable(7, full, { board_id: 3 }))
    const wrapper = await mountHeader('/tables/7')

    const button = shortcut(wrapper)!
    expect(button.attributes('aria-current')).toBeUndefined()
    expect(button.props('routerLink')).toBe('/tables/7/play')
    expect(button.props('fill')).toBe('solid')
  })

  test('on another table\'s page it is a plain link', async () => {
    seatAt(makeTable(7, full))
    const wrapper = await mountHeader('/tables/2')

    expect(shortcut(wrapper)!.props('fill')).toBe('outline')
  })
})

describe('the header\'s menu button', () => {
  function menuButton(wrapper: VueWrapper) {
    return wrapper.findAllComponents(IonButton).find((b) => b.classes('menu-toggle'))!
  }

  test('on a phone it slides the menu in, as before', async () => {
    const wrapper = await mountHeader()

    await menuButton(wrapper).trigger('click')

    expect(menuController.toggle).toHaveBeenCalled()
    expect(menuPinned.value).toBe(true)
  })

  test('from md up it collapses the pinned menu and brings it back, remembered', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const wrapper = await mountHeader()

    await menuButton(wrapper).trigger('click')
    expect(menuPinned.value).toBe(false)
    expect(localStorage.getItem(MENU_PINNED_KEY)).toBe('false')
    expect(menuController.toggle).not.toHaveBeenCalled()

    await menuButton(wrapper).trigger('click')
    expect(menuPinned.value).toBe(true)
    expect(localStorage.getItem(MENU_PINNED_KEY)).toBe('true')
  })

  test('below md even a wide-screen check that says no slides it in', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))

    await toggleMenu()

    expect(menuController.toggle).toHaveBeenCalled()
  })
})

describe('the collapse preference', () => {
  test('is open on a first visit', () => {
    expect(readMenuPinned()).toBe(true)
  })

  test('reads back a collapse', () => {
    setMenuPinned(false)

    expect(readMenuPinned()).toBe(false)
  })

  test('is open when storage refuses to be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('denied')
    })

    expect(readMenuPinned()).toBe(true)
  })

  test('a collapse storage refuses still holds until the reload', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota')
    })

    setMenuPinned(false)

    expect(setItem).toHaveBeenCalled()
    expect(menuPinned.value).toBe(false)
  })
})

describe('the menu', () => {
  async function mountMenu(path = '/history') {
    const router = routerAt(path)
    await router.isReady()
    return mount(AppMenu, { global: { plugins: [router] } })
  }

  function links(wrapper: VueWrapper) {
    return wrapper.findAllComponents(IonItem).map((item) => item.props('routerLink'))
  }

  // The badge the entry shows, not its invisible sizer.
  function badge(wrapper: VueWrapper) {
    return wrapper.findAllComponents(IonBadge).find((b) => b.classes('menu-table-badge'))
  }

  function sizer(wrapper: VueWrapper) {
    return wrapper.findAllComponents(IonBadge).find((b) => b.classes('menu-table-sizer'))
  }

  test('puts "Your table" first while seated, with its status', async () => {
    seatAt(makeTable(7, full, { board_id: 3 }))
    const wrapper = await mountMenu()

    expect(links(wrapper)).toEqual(['/tables/7/play', '/home', '/tables', '/history'])
    const entry = wrapper.findAllComponents(IonItem)[0]
    expect(entry.text()).toContain('Your table')
    expect(entry.text()).toContain('Table 7')
    expect(badge(wrapper)!.text()).toBe('Board in progress')
    expect(badge(wrapper)!.props('color')).toBe('success')
  })

  test('without a status there is no badge, but its room is kept', async () => {
    seatAt(makeTable(7, full))
    const wrapper = await mountMenu()

    expect(badge(wrapper)).toBeUndefined()
    expect(sizer(wrapper)!.text()).toBe('Board in progress')
    expect(sizer(wrapper)!.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.menu-table-status').attributes('slot')).toBe('end')
  })

  test('your turn is a tertiary badge', async () => {
    seatAt(makeTable(7, full, { board_id: 3 }))
    const game = useGameStore()
    game.tableId = 7
    game.playing = { phase: 'auction', acting_user_id: ana.id, board: { id: 3 } } as unknown as Playing
    const wrapper = await mountMenu()

    expect(badge(wrapper)!.text()).toBe('Your turn')
    expect(badge(wrapper)!.props('color')).toBe('tertiary')
  })

  test('our turn with a clock running counts it down', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-05T12:00:00Z'))
    try {
      seatAt(makeTable(7, full, { board_id: 3 }))
      const game = useGameStore()
      game.tableId = 7
      game.playing = {
        phase: 'auction',
        acting_user_id: ana.id,
        board: { id: 3 },
        turn_deadline: '2026-10-05T12:00:42Z',
      } as unknown as Playing
      const wrapper = await mountMenu()

      expect(badge(wrapper)!.text()).toBe('Your turn · 0:42')
      vi.advanceTimersByTime(2000)
      await flushPromises()
      expect(badge(wrapper)!.text()).toBe('Your turn · 0:40')

      // Somebody else's clock is not ours to show.
      game.playing = { ...game.playing, acting_user_id: 99 } as Playing
      await flushPromises()
      expect(badge(wrapper)!.text()).toBe('Board in progress')
    } finally {
      vi.useRealTimers()
    }
  })

  test('an away seat is a warning badge', async () => {
    seatAt(makeTable(7, full, { board_id: 3 }))
    useTablesStore().heldTableId = 7
    const wrapper = await mountMenu()

    expect(badge(wrapper)!.text()).toBe('Away')
    expect(badge(wrapper)!.props('color')).toBe('warning')
  })

  test('the status changes in place, the room for it stays the longest', async () => {
    seatAt(makeTable(7, full))
    const wrapper = await mountMenu()
    expect(badge(wrapper)).toBeUndefined()

    useTablesStore().tables = [makeTable(7, full, { board_id: 3 })]
    await nextTick()
    expect(badge(wrapper)!.text()).toBe('Board in progress')

    useTablesStore().heldTableId = 7
    await nextTick()
    expect(badge(wrapper)!.text()).toBe('Away')
    expect(sizer(wrapper)!.text()).toBe('Board in progress')
  })

  test('the table\'s name carries its full text as a title, for when it is cut short', async () => {
    const name = 'A table whose name runs on to fifty characters, max'
    seatAt(makeTable(7, full, { name }))
    const wrapper = await mountMenu()

    const heading = wrapper.find('.menu-table h2')
    expect(heading.text()).toBe(name)
    expect(heading.attributes('title')).toBe(name)
  })

  test('a table without a name goes by its number, in the title too', async () => {
    seatAt(makeTable(7, full, { name: '' }))
    const wrapper = await mountMenu()

    expect(wrapper.find('.menu-table h2').attributes('title')).toBe('Table #7')
  })

  test('no entry when not seated', async () => {
    useAuthStore().user = ana
    const wrapper = await mountMenu()

    expect(links(wrapper)).toEqual(['/home', '/tables', '/history'])
  })

  test('marks the page on screen', async () => {
    useAuthStore().user = ana
    const wrapper = await mountMenu('/history')

    const items = wrapper.findAllComponents(IonItem)
    expect(items.map((i) => i.attributes('aria-current'))).toEqual([undefined, undefined, 'page'])
    expect(items[2].classes()).toContain('current')
  })

  test('marks "Your table" on its pages', async () => {
    seatAt(makeTable(7, full))
    const wrapper = await mountMenu('/tables/7')

    const entry = wrapper.findAllComponents(IonItem)[0]
    expect(entry.attributes('aria-current')).toBe('page')
    expect(entry.classes()).toContain('current')
  })
})

describe('App shell', () => {
  test('pins the menu beside the page from md up, unless collapsed', async () => {
    const wrapper = mount(App, { global: { stubs: { IonRouterOutlet: true, BanNotice: true } } })
    const pane = wrapper.findComponent(IonSplitPane)
    expect(pane.props('when')).toBe('md')
    expect(pane.props('contentId')).toBe('main-content')

    setMenuPinned(false)
    await nextTick()
    expect(pane.props('when')).toBe(false)
  })
})

describe('finding the seat on any page', () => {
  test('one GET /tables tells where the user sits, and follows that table', async () => {
    useAuthStore().user = ana
    vi.mocked(tablesService.listTables).mockResolvedValue([makeTable(7, full)])
    const tables = useTablesStore()

    tables.findSeat()
    tables.findSeat()
    await flushPromises()

    expect(tablesService.listTables).toHaveBeenCalledTimes(1)
    expect(tables.myTable?.id).toBe(7)
    expect(tables.watchedTableId).toBe(7)
    tables.unwatchTable()
  })

  test('asks nothing once the list is loaded or a table we hold seats us', async () => {
    useAuthStore().user = ana
    const tables = useTablesStore()
    tables.currentTable = makeTable(7, full)
    tables.findSeat()

    tables.currentTable = null
    tables.loaded = true
    tables.findSeat()

    expect(tablesService.listTables).not.toHaveBeenCalled()
  })

  test('a failed lookup is quiet and asked again later', async () => {
    useAuthStore().user = ana
    vi.mocked(tablesService.listTables).mockRejectedValueOnce(new Error('offline'))
    const tables = useTablesStore()

    tables.findSeat()
    await flushPromises()
    expect(tables.loaded).toBe(false)

    vi.mocked(tablesService.listTables).mockResolvedValue([])
    tables.findSeat()
    await flushPromises()
    expect(tablesService.listTables).toHaveBeenCalledTimes(2)
    expect(tables.loaded).toBe(true)
  })

  test('logging out forgets every table held', async () => {
    seatAt(makeTable(7, full))
    const tables = useTablesStore()
    tables.currentTable = makeTable(7, full)
    tables.watchTable(7)

    tables.clear()

    expect(tables.tables).toEqual([])
    expect(tables.currentTable).toBeNull()
    expect(tables.loaded).toBe(false)
    expect(tables.watchedTableId).toBeNull()
    expect(tables.myTable).toBeNull()
  })
})
