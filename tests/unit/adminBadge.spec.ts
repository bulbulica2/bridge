import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import AdminBadge from '@/components/AdminBadge.vue'
import NextBoardBox from '@/components/NextBoardBox.vue'
import type { PublicUser } from '@/services/users'

const user = (id: number, username: string, is_admin = false): PublicUser => ({
  id,
  name: username,
  username,
  description: null,
  is_robot: false,
  is_admin,
})

describe('AdminBadge.vue', () => {
  test('reads "admin", with a title for hover', () => {
    const wrapper = mount(AdminBadge)

    expect(wrapper.text()).toBe('admin')
    expect(wrapper.get('.admin-badge').attributes('title')).toBe('Admin')
  })
})

describe('NextBoardBox.vue', () => {
  test("marks an admin's seat, and nobody else's", () => {
    const wrapper = mount(NextBoardBox, {
      props: {
        ready: [],
        players: { N: user(1, 'ana'), E: user(7, 'eve', true), S: user(2, 'bob'), W: user(3, 'cy') },
        mySeat: 'N',
      },
    })

    expect(wrapper.get('[data-seat="E"]').find('.admin-badge').exists()).toBe(true)
    expect(wrapper.findAll('.admin-badge')).toHaveLength(1)
  })
})
