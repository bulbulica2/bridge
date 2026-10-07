import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import PlayerAvatar from '@/components/PlayerAvatar.vue'
import SeatPlate from '@/components/SeatPlate.vue'
import type { PublicUser } from '@/services/users'

// The seat plates off the table (#163): StartBox and the table's page draw
// each seated player in the table's plate look.
const ana: PublicUser = { id: 1, name: 'Ana', username: 'ana', description: null, is_robot: false }
const robot: PublicUser = { id: 9, name: 'Robot', username: 'robot-1', description: null, is_robot: true }
const eve: PublicUser = { id: 5, name: 'Eve', username: 'eve', description: null, is_robot: false, is_admin: true }

describe('PlayerAvatar', () => {
  test('two letters of the username', () => {
    const wrapper = mount(PlayerAvatar, { props: { user: { username: 'bulbulica', is_robot: false } } })

    expect(wrapper.text()).toBe('BU')
    const avatar = wrapper.get('.player-avatar')
    expect(avatar.attributes('aria-hidden')).toBe('true')
    expect(avatar.attributes('title')).toBeUndefined()
  })

  test("a robot's icon, and the away avatar's red", () => {
    const wrapper = mount(PlayerAvatar, { props: { user: robot, away: true } })

    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.text()).toBe('')
    expect(wrapper.get('.player-avatar').attributes('title')).toBe('Robot player')
    expect(wrapper.get('.player-avatar').classes()).toEqual(expect.arrayContaining(['player-avatar-robot', 'player-avatar-away']))
  })
})

describe('SeatPlate', () => {
  test('avatar, name, seat; the name plain text unless selectable', () => {
    const wrapper = mount(SeatPlate, { props: { user: ana, seat: 'W' } })

    expect(wrapper.get('.player-avatar').text()).toBe('AN')
    expect(wrapper.get('.seat-user').element.tagName).toBe('SPAN')
    expect(wrapper.get('.seat-name').text()).toBe('West')
    expect(wrapper.find('.seat-you').exists()).toBe(false)
    expect(wrapper.find('.seat-plate-tick').exists()).toBe(false)
    expect(wrapper.find('.admin-badge').exists()).toBe(false)
  })

  test('selectable: the name opens the profile', async () => {
    const wrapper = mount(SeatPlate, { props: { user: ana, seat: 'S', selectable: true, mine: true } })

    const name = wrapper.get('button.seat-user')
    expect(name.attributes('aria-label')).toBe("ana's profile")
    await name.trigger('click')

    expect(wrapper.emitted('select')).toEqual([[ana]])
    expect(wrapper.get('.seat-you').text()).toBe('· you')
    expect(wrapper.get('.seat-plate').classes()).toContain('seat-plate-mine')
  })

  test('pressed Start: the green tick, "ready"', () => {
    const wrapper = mount(SeatPlate, { props: { user: robot, seat: 'N', ready: true } })

    expect(wrapper.get('.seat-plate').classes()).toContain('seat-plate-ready')
    expect(wrapper.find('.seat-plate-tick').exists()).toBe(true)
    expect(wrapper.get('.plate-ready').text()).toBe('· ready')
    expect(wrapper.get('.plate-robot').text()).toBe('· robot')
  })

  test('away: red, its clock instead of the tick', () => {
    const wrapper = mount(SeatPlate, {
      props: { user: eve, seat: 'E', ready: true, away: { seconds: 42, urgent: false } },
    })

    expect(wrapper.get('.seat-plate').classes()).toContain('seat-plate-away')
    expect(wrapper.get('.seat-plate').classes()).not.toContain('seat-plate-ready')
    expect(wrapper.get('.seat-away').text()).toBe('away · 0:42')
    expect(wrapper.find('.seat-plate-tick').exists()).toBe(false)
    expect(wrapper.find('.plate-ready').exists()).toBe(false)
    expect(wrapper.get('.player-avatar').classes()).toContain('player-avatar-away')
    expect(wrapper.find('.admin-badge').exists()).toBe(true)
  })
})
