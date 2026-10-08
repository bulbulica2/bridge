import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'

// What a real Ionic component does when it fires (#158): Ionic Vue 8
// dispatches the kebab-case event (`ion-change`, `ion-refresh`) on the
// element. Emitting `ionChange` from the Vue wrapper instead runs listeners
// the real app never runs, so drive the components through these.

type Found = VueWrapper | DOMWrapper<Element>

// ion-segment scrolls its checked button into view; jsdom has no scrolling.
Element.prototype.scrollTo ??= () => {}

// A tap on a segment button: the segment takes the value, then fires
// `ion-change`; the wrapper's v-model hook reads `value` off the element.
export function tapSegment(wrapper: Found, value: string | undefined, selector = 'ion-segment') {
  const segment = wrapper.find(selector).element as HTMLElement & { value?: string }
  segment.value = value
  segment.dispatchEvent(new CustomEvent('ion-change', { bubbles: true, detail: { value } }))
}

// The same, and whatever it sets off settled.
export async function pickSegment(wrapper: Found, value: string | undefined, selector = 'ion-segment') {
  tapSegment(wrapper, value, selector)
  await flushPromises()
}

// A pull to refresh or a scroll to the end: `complete` stands in for the
// element's own, which the page calls once it has loaded.
export async function fireIonEvent(wrapper: Found, selector: string, event: string, complete: () => void) {
  const element = wrapper.find(selector).element as HTMLElement & { complete?: () => void }
  element.complete = complete
  element.dispatchEvent(new CustomEvent(event, { bubbles: true }))
  await flushPromises()
}

export const pullToRefresh = (wrapper: Found, complete: () => void) =>
  fireIonEvent(wrapper, 'ion-refresher', 'ion-refresh', complete)

// A switch flipped: the toggle takes the new `checked`, then fires
// `ion-change`; the wrapper's v-model hook reads `checked` off the element.
export async function flipToggle(wrapper: Found, checked: boolean, selector = 'ion-toggle') {
  const toggle = wrapper.find(selector).element as HTMLElement & { checked?: boolean }
  toggle.checked = checked
  toggle.dispatchEvent(new CustomEvent('ion-change', { bubbles: true, detail: { checked } }))
  await flushPromises()
}
