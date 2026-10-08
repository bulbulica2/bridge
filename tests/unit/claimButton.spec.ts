import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import ClaimButton from '@/components/ClaimButton.vue'
import { CLAIM_LOCKED_TEXT } from '@/utils/claim'

// Claim in the table's bottom-right corner (#171): claims, or, locked after
// a refused claim, says why in a pop-up above it.

function note(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('.claim-locked-note')
}

function shown(wrapper: ReturnType<typeof mount>) {
  return !(note(wrapper).element as HTMLElement).style.display
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ClaimButton', () => {
  test('a tap claims', async () => {
    const wrapper = mount(ClaimButton)
    const button = wrapper.get('.claim-button')

    expect(button.text()).toBe('Claim')
    expect(button.attributes('aria-disabled')).toBeUndefined()
    expect(button.attributes('aria-describedby')).toBeUndefined()
    expect(button.attributes('aria-expanded')).toBeUndefined()
    expect(wrapper.find('.claim-locked-note').exists()).toBe(false)
    await button.trigger('click')

    expect(wrapper.emitted('claim')).toHaveLength(1)
  })

  test('disabled while a card or a claim is in flight', () => {
    const wrapper = mount(ClaimButton, { props: { disabled: true } })

    expect((wrapper.get('.claim-button').element as HTMLButtonElement).disabled).toBe(true)
  })

  test('locked: grey, described by the note, which a tap shows and hides', async () => {
    const wrapper = mount(ClaimButton, { props: { locked: true } })
    const button = wrapper.get('.claim-button')

    expect(button.text()).toBe('Claim · locked')
    expect(button.classes()).toContain('is-locked')
    expect(button.attributes('aria-disabled')).toBe('true')
    expect(note(wrapper).text()).toBe(CLAIM_LOCKED_TEXT)
    expect(note(wrapper).attributes('role')).toBe('tooltip')
    expect(button.attributes('aria-describedby')).toBe(note(wrapper).attributes('id'))
    expect(shown(wrapper)).toBe(false)
    expect(button.attributes('aria-expanded')).toBe('false')

    await button.trigger('click')
    expect(shown(wrapper)).toBe(true)
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(wrapper.emitted('claim')).toBeUndefined()

    await button.trigger('click')
    expect(shown(wrapper)).toBe(false)
  })

  test('locked: a mouse hovering shows the note, leaving hides it', async () => {
    const wrapper = mount(ClaimButton, { props: { locked: true } })
    const root = wrapper.get('.claim-peek')

    await root.trigger('pointerenter', { pointerType: 'mouse' })
    expect(shown(wrapper)).toBe(true)
    await root.trigger('pointerleave', { pointerType: 'mouse' })
    expect(shown(wrapper)).toBe(false)
  })

  test('unlocked, hovering opens nothing', async () => {
    const wrapper = mount(ClaimButton)

    await wrapper.get('.claim-peek').trigger('pointerenter', { pointerType: 'mouse' })

    expect(wrapper.get('.claim-button').attributes('aria-expanded')).toBeUndefined()
    expect(wrapper.find('.claim-locked-note').exists()).toBe(false)
  })

  test('the next card unlocks it: the note goes and a tap claims again', async () => {
    const wrapper = mount(ClaimButton, { props: { locked: true } })
    await wrapper.get('.claim-button').trigger('click')
    expect(shown(wrapper)).toBe(true)

    await wrapper.setProps({ locked: false })
    expect(wrapper.find('.claim-locked-note').exists()).toBe(false)
    await wrapper.get('.claim-button').trigger('click')
    expect(wrapper.emitted('claim')).toHaveLength(1)

    // Locked again later: the note starts hidden.
    await wrapper.setProps({ locked: true })
    expect(shown(wrapper)).toBe(false)
  })

  test('the note stays on screen: nudged off an edge, dropped below the top', async () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 300,
      right: 540,
      width: 240,
      top: -20,
      bottom: 60,
      height: 80,
      x: 300,
      y: -20,
      toJSON: () => ({}),
    } as DOMRect)
    const wrapper = mount(ClaimButton, { props: { locked: true } })

    await wrapper.get('.claim-button').trigger('click')
    await new Promise((resolve) => setTimeout(resolve))

    const style = note(wrapper).attributes('style')
    expect(style).toContain('--nudge: -148px')
    expect(style).toContain('--drop: 28px')
  })
})
