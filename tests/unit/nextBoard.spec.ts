import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import NextBoardBox from '@/components/NextBoardBox.vue'
import type { Seat } from '@/services/tables'
import type { PublicUser } from '@/services/users'

const NOW = Date.parse('2026-10-04T12:00:00Z')
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString()

const user = (id: number, username: string, is_robot = false): PublicUser => ({
  id,
  name: username,
  username,
  description: null,
  is_robot,
  is_admin: false,
})

const PEOPLE = { N: user(1, 'ann'), E: user(2, 'bob'), S: user(3, 'cy'), W: user(4, 'di') }
const ROBOTS = { N: user(11, 'robot-1', true), E: user(12, 'robot-2', true), S: user(3, 'cy'), W: user(13, 'robot-3', true) }

function box(
  props: {
    ready?: Seat[]
    nextBoardAt?: string | null
    players?: typeof PEOPLE
    busy?: boolean
    set?: { board: number; of: number } | null
  } = {},
) {
  return mount(NextBoardBox, {
    props: { ready: [], players: PEOPLE, mySeat: 'S' as Seat, ...props },
  })
}

describe('NextBoardBox.vue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('counts down to next_board_at, then says the deal is on its way', async () => {
    const wrapper = box({ nextBoardAt: inSeconds(10) })

    expect(wrapper.get('.next-title').text()).toBe('Next board in 0:10')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.get('.next-title').text()).toBe('Next board in 0:09')
    await vi.advanceTimersByTimeAsync(8500)
    expect(wrapper.get('.next-title').text()).toBe('Next board in 0:01')
    await vi.advanceTimersByTimeAsync(500)
    expect(wrapper.get('.next-title').text()).toBe('Dealing the next board…')
  })

  test('a ring empties over the wait, the seconds in its middle', async () => {
    const wrapper = box({ nextBoardAt: inSeconds(8) })

    expect(wrapper.get('.next-ring-face').text()).toBe('8')
    expect(wrapper.get('.next-ring').attributes('style')).toContain('--ring-fill: 80%')
    await vi.advanceTimersByTimeAsync(4000)
    expect(wrapper.get('.next-ring-face').text()).toBe('4')
    expect(wrapper.get('.next-ring').attributes('style')).toContain('--ring-fill: 40%')
  })

  test('a deadline further off than the usual wait fills the ring, no more', () => {
    expect(box({ nextBoardAt: inSeconds(30) }).get('.next-ring').attributes('style')).toContain('--ring-fill: 100%')
  })

  test('no ring without a deadline', () => {
    expect(box({ nextBoardAt: null }).find('.next-ring').exists()).toBe(false)
  })

  test("says which board is next, and that it's skippable until we asked", async () => {
    const wrapper = box({ nextBoardAt: inSeconds(8), set: { board: 2, of: 4 } })
    expect(wrapper.get('.next-sub').text()).toBe('Board 3 of 4 · or skip the wait')

    await wrapper.setProps({ ready: ['S'] })
    expect(wrapper.get('.next-sub').text()).toBe('Board 3 of 4')

    // The set's last board has no next one in it; asked, nothing is left to say.
    await wrapper.setProps({ set: { board: 4, of: 4 } })
    expect(wrapper.find('.next-sub').exists()).toBe(false)
  })

  test('a deadline already past, or unreadable, reads as dealing', () => {
    expect(box({ nextBoardAt: inSeconds(-5) }).get('.next-title').text()).toBe('Dealing the next board…')
    expect(box({ nextBoardAt: 'soon' }).get('.next-title').text()).toBe('Dealing the next board…')
  })

  test('no deal coming by itself: no countdown, and the clock never ticks', async () => {
    const wrapper = box({ nextBoardAt: null })

    expect(wrapper.get('.next-title').text()).toBe('Next board')
    expect(vi.getTimerCount()).toBe(0)
    expect(wrapper.get('.next-button').text()).toBe('Deal now')
  })

  test('"Deal now" is optional: it asks, then names the humans still to ask', async () => {
    const wrapper = box({ nextBoardAt: inSeconds(10) })

    await wrapper.get('.next-button').trigger('click')
    expect(wrapper.emitted('next')).toHaveLength(1)

    await wrapper.setProps({ ready: ['N', 'S'] })
    expect(wrapper.find('.next-button').exists()).toBe(false)
    expect(wrapper.text()).toContain('You asked to deal now. Waiting for bob, di.')
  })

  test('robots never hold the deal up', async () => {
    const wrapper = box({ players: ROBOTS, ready: ['S'] })

    expect(wrapper.text()).toContain('You asked to deal now. Waiting for the others.')
  })

  test('a seat without a player is named by its seat', () => {
    const wrapper = box({ players: { ...PEOPLE, E: null } as unknown as typeof PEOPLE, ready: ['S', 'N', 'W'] })

    expect(wrapper.text()).toContain('Waiting for E.')
  })

  test('busy: both buttons wait, Deal now spins', () => {
    const wrapper = box({ busy: true })

    const buttons = wrapper.findAllComponents({ name: 'IonButton' })
    expect(buttons.map((b) => b.props('disabled'))).toEqual([true, true])
    expect(wrapper.find('ion-spinner').exists()).toBe(true)
  })

  test('leaving is offered, free between boards', async () => {
    const wrapper = box()

    await wrapper.findAllComponents({ name: 'IonButton' })[1].trigger('click')
    expect(wrapper.emitted('leave')).toHaveLength(1)
    expect(wrapper.text()).toContain('The board is over, so leaving now abandons nothing.')
  })

  test('without a seat of our own, Deal now still shows', () => {
    const wrapper = mount(NextBoardBox, { props: { ready: ['N'], players: PEOPLE, mySeat: null } })

    expect(wrapper.find('.next-button').exists()).toBe(true)
  })
})
