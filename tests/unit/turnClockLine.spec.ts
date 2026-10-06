import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import TurnClockLine from '@/components/TurnClockLine.vue'

describe('TurnClockLine', () => {
  test('our move: the words left, the clock right, the bar filled to the time left, in orange', () => {
    const wrapper = mount(TurnClockLine, {
      props: { text: 'Your turn · follow in ♦', time: '0:38', fraction: 38 / 60, mine: true },
    })

    expect(wrapper.attributes('role')).toBe('timer')
    expect(wrapper.get('.turn-line-text').text()).toBe('Your turn · follow in ♦')
    expect(wrapper.get('.turn-line-time').text()).toBe('0:38')
    expect(wrapper.get('.turn-bar-fill').attributes('style')).toMatch(/^width: 63\.33/)
    expect(wrapper.classes()).toEqual(['turn-line', 'turn-line-mine'])
  })

  test('in its last seconds: red', () => {
    const wrapper = mount(TurnClockLine, {
      props: { text: 'Your call', time: '0:09', fraction: 0.15, mine: true, urgent: true },
    })

    expect(wrapper.classes()).toContain('turn-line-urgent')
    expect(wrapper.get('.turn-bar-fill').attributes('style')).toBe('width: 15%;')
  })

  test("somebody else's move: plain, and a robot's reads as thinking", () => {
    const waiting = mount(TurnClockLine, { props: { text: 'Waiting for East', time: '0:05', fraction: 0.1 } })
    expect(waiting.classes()).toEqual(['turn-line'])

    const robot = mount(TurnClockLine, { props: { text: 'robot-1 is thinking…', robot: true } })
    expect(robot.classes()).toContain('turn-line-robot')
  })

  test('no clock: no time, and the bar keeps its empty track so nothing moves', () => {
    const wrapper = mount(TurnClockLine, { props: { text: '' } })

    expect(wrapper.find('.turn-line-time').exists()).toBe(false)
    expect(wrapper.find('.turn-bar').exists()).toBe(true)
    expect(wrapper.find('.turn-bar-fill').exists()).toBe(false)
  })
})
