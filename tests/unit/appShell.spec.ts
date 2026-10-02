import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import { IonItem, toastController } from '@ionic/vue'
import App from '@/App.vue'
import AppMenu from '@/components/AppMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { navigationEnded, navigationStarted } from '@/router/loading'
import { showToast, showWelcomeToast } from '@/utils/toast'

vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))

const present = vi.fn()
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  toastController: { create: vi.fn(async () => ({ present })) },
}))

const ana = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }

// router-link is a prop of Ionic's Vue wrapper, not a DOM attribute.
function menuLinks(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents(IonItem).map((item) => item.props('routerLink'))
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('AppMenu', () => {
  test('a guest gets Home and Login', () => {
    const wrapper = mount(AppMenu)

    expect(menuLinks(wrapper)).toEqual(['/home', '/login'])
  })

  test('a logged-in user gets Home, Tables and My boards', async () => {
    const wrapper = mount(AppMenu)
    useAuthStore().user = ana
    await nextTick()

    expect(menuLinks(wrapper)).toEqual(['/home', '/tables', '/history'])
    expect(wrapper.text()).toContain('My boards')
  })
})

describe('App', () => {
  test('shows the route progress bar only while a slow navigation runs', async () => {
    vi.useFakeTimers()
    // BanNotice needs Ionic's router; bans.spec.ts covers it.
    const wrapper = mount(App, { global: { stubs: { IonRouterOutlet: true, BanNotice: true } } })
    expect(wrapper.find('.route-progress').exists()).toBe(false)

    navigationStarted('/tables')
    vi.advanceTimersByTime(150)
    await nextTick()
    expect(wrapper.find('.route-progress').exists()).toBe(true)

    navigationEnded('/tables')
    await nextTick()
    expect(wrapper.find('.route-progress').exists()).toBe(false)
    vi.useRealTimers()
  })
})

describe('toasts', () => {
  test('showToast presents a short bottom toast in the given colour', async () => {
    await showToast('Left the table.', 'success')

    expect(toastController.create).toHaveBeenCalledWith({
      message: 'Left the table.',
      duration: 4000,
      color: 'success',
      position: 'bottom',
    })
    expect(present).toHaveBeenCalled()
  })

  test('showWelcomeToast greets at the top with the welcome style', async () => {
    await showWelcomeToast('Welcome, Ana!')

    expect(toastController.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Welcome, Ana!',
        position: 'top',
        color: 'primary',
        cssClass: 'welcome-toast',
      }),
    )
    expect(present).toHaveBeenCalled()
  })
})
