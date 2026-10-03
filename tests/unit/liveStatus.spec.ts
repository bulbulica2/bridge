import { flushPromises, mount } from '@vue/test-utils'
import { IonButton } from '@ionic/vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import OfflineRefresh from '@/components/OfflineRefresh.vue'
import { OFFLINE_GRACE_MS, useLiveStatus } from '@/composables/useLiveStatus'
import {
  clearSubscribed,
  isLive,
  resetLiveStatus,
  setConnection,
  setSubscribed,
} from '@/services/liveStatus'

function goLive(tableId: number) {
  setConnection('connected')
  setSubscribed(tableId)
}

beforeEach(() => {
  resetLiveStatus()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('live status', () => {
  test('is live only while connected with that table subscribed', () => {
    expect(isLive(3)).toBe(false)

    setConnection('connected')
    expect(isLive(3)).toBe(false)

    setSubscribed(3)
    expect(isLive(3)).toBe(true)
    expect(isLive(4)).toBe(false)

    clearSubscribed(4)
    expect(isLive(3)).toBe(true)
    clearSubscribed(3)
    expect(isLive(3)).toBe(false)
  })

  test('a connection that is not connected drops the subscription', () => {
    goLive(3)

    setConnection('connecting')

    expect(isLive(3)).toBe(false)
    setConnection('connected')
    expect(isLive(3)).toBe(false)
  })
})

describe('useLiveStatus', () => {
  test('says offline only after live updates stay off for the grace period', async () => {
    const scope = effectScope()
    const status = scope.run(() => useLiveStatus(() => 3))!

    expect(status.live.value).toBe(false)
    expect(status.offline.value).toBe(false)

    vi.advanceTimersByTime(OFFLINE_GRACE_MS - 1)
    expect(status.offline.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(status.offline.value).toBe(true)

    goLive(3)
    await nextTick()
    expect(status.live.value).toBe(true)
    expect(status.offline.value).toBe(false)

    scope.stop()
  })

  test('a brief drop never says offline', async () => {
    goLive(3)
    const scope = effectScope()
    const status = scope.run(() => useLiveStatus(() => 3))!

    setConnection('connecting')
    await nextTick()
    vi.advanceTimersByTime(OFFLINE_GRACE_MS - 1000)
    goLive(3)
    await nextTick()
    vi.advanceTimersByTime(OFFLINE_GRACE_MS)

    expect(status.offline.value).toBe(false)
    scope.stop()
  })

  test('follows the table it is asked about', async () => {
    goLive(3)
    const tableId = ref(3)
    const scope = effectScope()
    const status = scope.run(() => useLiveStatus(() => tableId.value))!
    expect(status.live.value).toBe(true)

    tableId.value = 4
    await nextTick()

    expect(status.live.value).toBe(false)
    scope.stop()
  })

  test('stops its timer when its scope ends', () => {
    const scope = effectScope()
    const status = scope.run(() => useLiveStatus(() => 3))!

    scope.stop()
    vi.advanceTimersByTime(OFFLINE_GRACE_MS)

    expect(status.offline.value).toBe(false)
  })
})

describe('OfflineRefresh', () => {
  test('shows nothing while live', async () => {
    goLive(5)
    const wrapper = mount(OfflineRefresh, { props: { tableId: 5 } })

    vi.advanceTimersByTime(OFFLINE_GRACE_MS)
    await nextTick()

    expect(wrapper.find('.offline-refresh').exists()).toBe(false)
  })

  test('after a few seconds offline shows the note and a Refresh that asks for a reload', async () => {
    const wrapper = mount(OfflineRefresh, { props: { tableId: 5 } })
    expect(wrapper.find('.offline-refresh').exists()).toBe(false)

    vi.advanceTimersByTime(OFFLINE_GRACE_MS)
    await nextTick()

    expect(wrapper.find('.offline-note').text()).toBe(
      'Live updates are off. Refresh to see the latest.',
    )
    await wrapper.get('ion-button.refresh').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)

    goLive(5)
    await flushPromises()
    expect(wrapper.find('.offline-refresh').exists()).toBe(false)
  })

  test('passes on disabled to the button', async () => {
    const wrapper = mount(OfflineRefresh, { props: { tableId: 5, disabled: true } })

    vi.advanceTimersByTime(OFFLINE_GRACE_MS)
    await nextTick()

    expect(wrapper.getComponent(IonButton).props('disabled')).toBe(true)
  })
})
