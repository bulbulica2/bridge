import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HomePage from '@/views/HomePage.vue'
import { beforeEach, describe, expect, test } from 'vitest'

describe('HomePage.vue', () => {
  // AppHeader reads the auth store to decide whether to show the Account
  // button, so mounting any page needs an active Pinia.
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('renders HomePage', () => {
    const wrapper = mount(HomePage)
    expect(wrapper.text()).toMatch('Home')
  })
})
