import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import TablePlayPage from '@/views/TablePlayPage.vue'
import AuctionHistory from '@/components/AuctionHistory.vue'
import BridgeTable from '@/components/BridgeTable.vue'
import ExplainCallSheet from '@/components/ExplainCallSheet.vue'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Bid, Playing, Seat } from '@/services/game'
import type { Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useElementWidth } from '@/composables/useElementWidth'
import { useSteadyHeight } from '@/composables/useSteadyHeight'
import { WIDE_TABLE_MIN_PX } from '@/utils/layout'
import { bidWith } from './biddingBox'

// The play page on a wide screen (#163, boards A/B of the design canvas):
// the table's wide layout once the page's column has room for it, the
// board tile in its corner, and the auction with the bidding box in its
// centre while the auction lasts.
vi.mock('@/services/chat', () => ({ getMessages: () => new Promise(() => {}), sendMessage: () => new Promise(() => {}) }))
vi.mock('@/services/game', () => ({ getPlaying: vi.fn(), getBids: vi.fn(), makeCall: vi.fn() }))
vi.mock('@/services/history', () => ({
  getMyPlayings: vi.fn(() => new Promise(() => {})),
  getSet: vi.fn(() => new Promise(() => {})),
  getBoardResults: vi.fn(() => new Promise(() => {})),
  getDoubleDummy: vi.fn(() => new Promise(() => {})),
}))
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
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
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ params: { id: '5' } }),
}))
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate: vi.fn() }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
    onIonViewWillLeave: () => {},
  }
})

// A ResizeObserver reporting every element `width` px wide.
let width = 0
const observers: { disconnect: ReturnType<typeof vi.fn> }[] = []
class FakeResizeObserver {
  disconnect = vi.fn()
  constructor(private callback: ResizeObserverCallback) {
    observers.push(this)
  }
  observe(el: Element) {
    this.callback([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], this as never)
  }
}

// A screen from 1100 px: the chat's breakpoint.
function wideScreen(matches = true) {
  window.matchMedia = vi.fn(
    () => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
  )
}

const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null, is_robot: false },
  E: { id: 2, name: 'Bob', username: 'bob', description: null, is_robot: false },
  S: { id: 3, name: 'Cy', username: 'cy', description: null, is_robot: false },
  W: { id: 4, name: 'Di', username: 'di', description: null, is_robot: false },
}

function makeTable(): Table {
  const seats: Seat[] = ['N', 'E', 'S', 'W']
  return {
    id: 5,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: 7,
    unattended_since: null,
    created_at: '',
    updated_at: '',
    seats: seats.map((seat, i) => ({
      id: i + 1,
      table_id: 5,
      user_id: PLAYERS[seat].id,
      seat,
      ready: false,
      user: PLAYERS[seat],
    })),
    free_seats: [],
    set: null,
    can_manage: false,
  }
}

const pass = { id: 1, call: 'P', level: null, strain: null, special: true } as Bid
const oneHeart = { id: 6, call: '1H', level: 1, strain: 'H', special: false } as Bid

// The user is South (Cy); East opened 1♥ and it is South's call.
function auction(overrides: Partial<Playing> = {}): Playing {
  return {
    phase: 'auction',
    playing_id: 42,
    set: null,
    board: { id: 7, number: 7, dealer: 'E', vulnerable: 'NS' },
    players: PLAYERS,
    turn: 'S',
    acting_user_id: 3,
    auction: [{ seat: 'E', bid: oneHeart, alert: null, question: null }],
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    claim: null,
    result: null,
    deal: null,
    ready: null,
    next_board_at: null,
    my_seat: 'S',
    hand: [],
    declarer_hand: null,
    ...overrides,
  }
}

const modalStub = { template: '<div><slot /></div>' }

async function mountPage(playing: Playing = auction()) {
  vi.mocked(tablesService.getTable).mockResolvedValue(makeTable())
  vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
  const wrapper = mount(TablePlayPage, {
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub, 'router-link': true } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  observers.length = 0
  width = 800
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  wideScreen()
  useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
  vi.mocked(gameService.getBids).mockResolvedValue([pass, oneHeart])
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('the wide table on the play page', () => {
  test('the auction and our bidding box sit in the middle of the table', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get('.play').classes()).toContain('play-wide')
    expect(wrapper.findComponent(BridgeTable).props('wide')).toBe(true)
    const centre = wrapper.get('.bridge-table .centre-auction')
    expect(centre.find('.auction').exists()).toBe(true)
    expect(centre.find('.bidding-box').exists()).toBe(true)
    // Nowhere else: the auction is drawn once.
    expect(wrapper.findAllComponents(AuctionHistory)).toHaveLength(1)
    expect(wrapper.findAll('.bidding-box')).toHaveLength(1)
    // The board's details in the table's corners, nothing above it.
    expect(wrapper.find('.bridge-table .corner-top-left .vul-label').exists()).toBe(true)
    expect(wrapper.find('.board-bar').exists()).toBe(false)
    expect(wrapper.find('.board-tile').exists()).toBe(false)
  })

  test('a call goes out from the centre, with its alert', async () => {
    vi.mocked(gameService.makeCall).mockResolvedValue(auction({ turn: 'W', acting_user_id: 4 }))
    const wrapper = await mountPage()
    const centre = wrapper.get('.centre-auction')

    await centre.get('.alert-toggle').trigger('click')
    expect(wrapper.get('.centre-auction .alert-toggle').classes()).toContain('on')
    await wrapper.get('.centre-auction .alert-input').setValue('Forcing')
    await bidWith(wrapper, 'P')
    await flushPromises()

    expect(gameService.makeCall).toHaveBeenCalledWith(5, 1, { alert: true, explanation: 'Forcing' })
    // Not our turn now: the box goes, the auction stays in the centre.
    expect(wrapper.find('.bidding-box').exists()).toBe(false)
    expect(wrapper.find('.centre-auction .auction').exists()).toBe(true)
  })

  test('an opponent’s call asked about in the chat, or ours explained, from the centre', async () => {
    const wrapper = await mountPage()
    const history = wrapper.findComponent(AuctionHistory)

    history.vm.$emit('chat', 0)
    await flushPromises()
    expect(useChatStore().about).toBe(0)

    history.vm.$emit('explain', 0)
    await flushPromises()
    expect(wrapper.findComponent(ExplainCallSheet).props('open')).toBe(true)
  })

  test('the bidding box failing to load says so in the centre, with Try again', async () => {
    vi.mocked(gameService.getBids).mockRejectedValue(new Error('offline'))
    const wrapper = await mountPage()

    const missing = wrapper.get('.centre-auction .bids-missing')
    expect(missing.text()).toContain('Could not load the bidding box.')
    vi.mocked(gameService.getBids).mockResolvedValue([pass, oneHeart])
    await missing.get('ion-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.centre-auction .bidding-box').exists()).toBe(true)
  })

  test('the play: the trick in the centre as before, the auction behind the button bottom left', async () => {
    const contract = { bid: oneHeart, doubled: '' as const, declarer: 'E' as Seat, dummy: 'W' as Seat }
    const wrapper = await mountPage(
      auction({ phase: 'play', contract, turn: 'S', current_trick: [], tricks: [], tricks_won: { ns: 0, ew: 0 } }),
    )

    expect(wrapper.find('.centre-auction').exists()).toBe(false)
    expect(wrapper.find('.bridge-table .centre .trick').exists()).toBe(true)
    expect(wrapper.findComponent(AuctionHistory).exists()).toBe(false)
    await wrapper.get('.bridge-table .corner-bottom-left .auction-button').trigger('click')
    const history = wrapper.findComponent(AuctionHistory)
    expect(history.element.closest('.centre')).toBeNull()
    expect(history.element.closest('.auction-popup')).not.toBeNull()
    expect(wrapper.get('.corner-top-right .contract-line').text().replace(/\s+/g, ' ')).toBe('1♥ by East')
    expect(wrapper.find('.corner-bottom-right .claim-button').exists()).toBe(true)
  })

  test('a column too narrow (menu pinned, chat open) keeps the table it has below 1100 px', async () => {
    width = WIDE_TABLE_MIN_PX - 1
    const wrapper = await mountPage()

    expect(wrapper.get('.play').classes()).not.toContain('play-wide')
    expect(wrapper.findComponent(BridgeTable).props('wide')).toBe(false)
    expect(wrapper.find('.centre-auction').exists()).toBe(false)
    expect(wrapper.findComponent(AuctionHistory).element.closest('.bridge-table')).toBeNull()
    // The corners at every width.
    expect(wrapper.findAll('.bridge-table .corner')).toHaveLength(4)
    expect(wrapper.find('.board-tile').exists()).toBe(false)
  })

  test('a narrow screen never gets it, however wide the column', async () => {
    wideScreen(false)
    const wrapper = await mountPage()

    expect(wrapper.find('.play-wide').exists()).toBe(false)
    expect(wrapper.find('.centre-auction').exists()).toBe(false)
  })
})

describe('BridgeTable wide', () => {
  const props = { players: PLAYERS, mySeat: 'S' as Seat, board: auction().board, turn: null }

  test('the corners show on the narrow table and the wide one alike', () => {
    const slots = { 'top-left': '<span class="vul">Vul: E-W</span>' }
    const narrow = mount(BridgeTable, { props, slots })
    const wide = mount(BridgeTable, { props: { ...props, wide: true }, slots })

    expect(narrow.get('.corner-top-left .vul').text()).toBe('Vul: E-W')
    expect(narrow.get('.bridge-table').classes()).not.toContain('table-wide')
    expect(wide.get('.bridge-table').classes()).toEqual(expect.arrayContaining(['table-wide', 'with-corners']))
    expect(wide.get('.corner-top-left .vul').text()).toBe('Vul: E-W')
  })

  test('wide without corners: no room kept for them', () => {
    const wrapper = mount(BridgeTable, { props: { ...props, wide: true } })

    expect(wrapper.get('.bridge-table').classes()).toContain('table-wide')
    expect(wrapper.get('.bridge-table').classes()).not.toContain('with-corners')
  })
})

describe('useElementWidth', () => {
  const Probe = defineComponent({
    setup(_, { expose }) {
      const shown = ref(true)
      const el = ref<HTMLElement | null>(null)
      const size = useElementWidth(el)
      expose({ shown, size })
      return () => h('div', [shown.value ? h('p', { ref: el }) : null])
    },
  })

  test('follows the element as it comes and goes', async () => {
    width = 640
    const wrapper = mount(Probe)
    const vm = wrapper.vm as unknown as { shown: boolean; size: number }
    expect(vm.size).toBe(640)

    vm.shown = false
    await nextTick()
    expect(vm.size).toBe(0)
    expect(observers[0].disconnect).toHaveBeenCalled()

    width = 700
    vm.shown = true
    await nextTick()
    expect(vm.size).toBe(700)

    wrapper.unmount()
    expect(observers[1].disconnect).toHaveBeenCalled()
  })

  test('0 without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const wrapper = mount(Probe)

    expect((wrapper.vm as unknown as { size: number }).size).toBe(0)
  })

  test('an empty report changes nothing', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe() {
          this.callback([], this as never)
        }
        disconnect() {}
      },
    )
    const wrapper = mount(Probe)

    expect((wrapper.vm as unknown as { size: number }).size).toBe(0)
  })
})

describe('useSteadyHeight on an element a v-if brings', () => {
  test('starts measuring when it appears', async () => {
    let height = 300
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: 500, height }) as DOMRect,
    )
    const Probe = defineComponent({
      setup(_, { expose }) {
        const shown = ref(false)
        const el = ref<HTMLElement | null>(null)
        useSteadyHeight(el, () => 1)
        expose({ shown, el })
        return () => h('div', [shown.value ? h('p', { ref: el }) : null])
      },
    })
    const wrapper = mount(Probe)
    const vm = wrapper.vm as unknown as { shown: boolean; el: HTMLElement | null }
    expect(observers).toHaveLength(0)

    vm.shown = true
    await nextTick()
    expect(observers).toHaveLength(1)
    expect(vm.el!.style.minHeight).toBe('300px')

    height = 200
    vm.shown = false
    await nextTick()
    expect(observers[0].disconnect).toHaveBeenCalled()

    // Back again: measured afresh, not held at the old height.
    vm.shown = true
    await nextTick()
    expect(vm.el!.style.minHeight).toBe('200px')
    wrapper.unmount()
  })
})
