import { mount } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { defineComponent, h, ref, withDirectives } from 'vue'
import { IonRefresher } from '@ionic/vue'
import { vIonEvent } from '@/directives/ionEvent'

// The real IonRefresher with the directive on it, as the pages use it.
function mountRefresher(first: (event: CustomEvent) => void) {
  const handler = ref(first)
  const shown = ref(true)
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        shown.value
          ? withDirectives(h(IonRefresher, { slot: 'fixed' }), [
              [vIonEvent, handler.value, 'ion-refresh'],
            ])
          : null,
    }),
  )
  return { wrapper, handler, shown }
}

describe('v-ion-event', () => {
  test('runs on the kebab-case event the element really dispatches', () => {
    const refresh = vi.fn()
    const { wrapper } = mountRefresher(refresh)
    const element = wrapper.find('ion-refresher').element

    element.dispatchEvent(new CustomEvent('ionRefresh'))
    expect(refresh).not.toHaveBeenCalled()

    element.dispatchEvent(new CustomEvent('ion-refresh', { detail: 1 }))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh.mock.calls[0][0].target).toBe(element)
  })

  test('a new handler replaces the old one, and unmounting stops it', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { wrapper, handler, shown } = mountRefresher(first)
    const element = wrapper.find('ion-refresher').element

    handler.value = second
    await wrapper.vm.$nextTick()
    element.dispatchEvent(new CustomEvent('ion-refresh'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    shown.value = false
    await wrapper.vm.$nextTick()
    element.dispatchEvent(new CustomEvent('ion-refresh'))
    expect(second).toHaveBeenCalledTimes(1)
  })
})

// Ionic Vue 8 wrappers never run `@ionChange`, `@ion-change`, `@ionRefresh`
// and the like (#158): values go through v-model / @update:model-value,
// other events through v-ion-event. Keep it that way.
describe('no Ionic event listeners in the templates', () => {
  const sources = import.meta.glob('/src/**/*.vue', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >

  test('finds the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
  })

  test.each(Object.entries(sources))('%s', (_path, source) => {
    const template = source.replace(/<script[\s\S]*?<\/script>/g, '')
    expect(template.match(/(?:@|v-on:)ion[A-Z-][\w-]*/g)).toBeNull()
  })
})
