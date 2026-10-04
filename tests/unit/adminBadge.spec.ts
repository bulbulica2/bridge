import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import AdminBadge from '@/components/AdminBadge.vue'

describe('AdminBadge.vue', () => {
  test('reads "admin", with a title for hover', () => {
    const wrapper = mount(AdminBadge)

    expect(wrapper.text()).toBe('admin')
    expect(wrapper.get('.admin-badge').attributes('title')).toBe('Admin')
  })
})
