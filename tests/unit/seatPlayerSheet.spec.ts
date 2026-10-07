import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { IonItem, IonSearchbar } from '@ionic/vue'
import SeatPlayerSheet from '@/components/SeatPlayerSheet.vue'
import type { SearchedUser } from '@/services/users'

// The search itself has its own tests (users.spec.ts); here the sheet only
// draws whatever state the composable is in.
const search = vi.hoisted(() => ({ state: null as null | Record<string, unknown> }))
vi.mock('@/composables/useUserSearch', () => ({
  SEARCH_MIN_LENGTH: 2,
  useUserSearch: () => search.state,
}))

const bob: SearchedUser = { id: 2, name: 'Bob', username: 'bob', description: null, is_robot: false, seated: false }
const cy: SearchedUser = { id: 3, name: 'Cy', username: 'cy', description: null, is_robot: false, seated: true }

function state(overrides: Record<string, unknown> = {}) {
  search.state = {
    query: ref(''),
    results: ref<SearchedUser[]>([]),
    searching: ref(false),
    error: ref(''),
    searched: ref<string | null>(null),
    tooShort: ref(false),
    reset: vi.fn(),
    ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, ref(v)])),
  }
}

// IonModal only renders its content once presented, which jsdom never does,
// so render the sheet's content inline; the stub passes the modal's events on.
const modalStub = {
  name: 'IonModal',
  emits: ['didPresent', 'didDismiss'],
  template: '<div><slot /></div>',
}
const mountSheet = () =>
  mount(SeatPlayerSheet, {
    props: { seat: 'E' },
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
  })

beforeEach(() => {
  state()
})

describe('SeatPlayerSheet', () => {
  test('names the seat and asks for more characters', () => {
    state({ tooShort: true })
    const wrapper = mountSheet()

    expect(wrapper.find('.title').text()).toBe('Seat a player at E')
    expect(wrapper.text()).toContain('Type at least 2 characters')
  })

  test('shows a failed search', () => {
    state({ error: 'Too many searches. Wait a minute.' })

    expect(mountSheet().text()).toContain('Too many searches. Wait a minute.')
  })

  test('shows a spinner while the first answer is on its way', () => {
    state({ searching: true })

    expect(mountSheet().find('.searching').exists()).toBe(true)
  })

  test('says when nobody matches', () => {
    state({ searched: 'zz' })

    expect(mountSheet().text()).toContain('No players match “zz”.')
  })

  test('lists the matches, a seated one greyed out, and keeps them while searching again', () => {
    state({ results: [bob, cy], searching: true })
    const wrapper = mountSheet()

    const items = wrapper.findAllComponents(IonItem)
    // Each with the plates' avatar (#163).
    expect(items.map((i) => i.text())).toEqual(['BObobBob', 'CYcyCyalready at a table'])
    expect(items[1].props('disabled')).toBe(true)
    expect(wrapper.find('.searching').exists()).toBe(false)
    expect(wrapper.text()).toContain('Searching…')
  })

  test('picking a free player selects them, a seated one does nothing', async () => {
    state({ results: [bob, cy] })
    const wrapper = mountSheet()

    const items = wrapper.findAllComponents(IonItem)
    await items[1].trigger('click')
    await items[0].trigger('click')

    expect(wrapper.emitted('select')).toEqual([[bob]])
  })

  test('focuses the search once shown, and empties it when dismissed', async () => {
    const wrapper = mountSheet()
    const setFocus = vi.fn()
    Object.defineProperty(wrapper.findComponent(IonSearchbar).vm.$el, 'setFocus', { value: setFocus })
    const modal = wrapper.findComponent({ name: 'IonModal' })

    modal.vm.$emit('didPresent')
    modal.vm.$emit('didDismiss')
    await nextTick()

    expect(setFocus).toHaveBeenCalled()
    expect(search.state!.reset).toHaveBeenCalled()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
