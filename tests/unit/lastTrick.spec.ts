import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import LastTrickPopover from '@/components/LastTrickPopover.vue'
import type { Card, PlayedCard, Suit, Trick } from '@/services/game'
import type { Seat } from '@/services/tables'

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.restoreAllMocks()
})

// "SA" is the ace of spades, "H10" the ten of hearts; ids are unique per card.
const RANKS: Record<string, number> = { J: 12, Q: 13, K: 14, A: 15 }
function c(name: string): Card {
  const suit = name[0] as Suit
  const rank = RANKS[name.slice(1)] ?? Number(name.slice(1))
  return { id: 'SHDC'.indexOf(suit) * 20 + rank, suit, rank, rank_name: name.slice(1) }
}

function played(written: string): PlayedCard[] {
  return written.split(', ').map((made) => {
    const [seat, card] = made.split(' ')
    return { seat: seat as Seat, card: c(card) }
  })
}

// West led the 3 of spades, East won it with the king.
const TRICK: Trick = { round: 4, leader: 'W', cards: played('W S3, N SQ, E SK, S S7'), winner: 'E' }

function mountPopover(mySeat: Seat | null = 'S', trick: Trick = TRICK) {
  return mount(LastTrickPopover, { props: { trick, mySeat }, attachTo: document.body })
}

// Each side of the pop-up's trick: the seat drawn there and its card ("N Q♠").
function sides(wrapper: ReturnType<typeof mountPopover>) {
  return Object.fromEntries(
    wrapper
      .findAll('.last-trick-popup .slot')
      .map((slot) => [
        slot.attributes('data-side'),
        `${slot.attributes('data-seat')} ${slot.find('.corner').text().replace(/\s+/g, '')}`,
      ]),
  )
}

describe('LastTrickPopover', () => {
  test('closed at first: only the button, which a keyboard can reach', () => {
    const wrapper = mountPopover()

    const button = wrapper.get('.last-trick-button')
    expect(button.element.tagName).toBe('BUTTON')
    expect(button.text()).toBe('Last trick')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.last-trick-popup').exists()).toBe(false)
  })

  test('compact for the corner: the icon and a label that a narrow table hides, the name kept', () => {
    const button = mountPopover().get('.last-trick-button')

    // The icon first, then the words in a span of their own: under a
    // 420 px table only the icon shows, so the name is in aria-label.
    expect(button.element.children[0]!.tagName).toBe('ION-ICON')
    expect(button.get('ion-icon').attributes('aria-hidden')).toBe('true')
    expect(button.get('.last-trick-label').text()).toBe('Last trick')
    expect(button.attributes('aria-label')).toBe('Last trick')
    expect(button.attributes('aria-haspopup')).toBe('dialog')
  })

  test('opens from the corner downward and to the left, nudged back on screen', async () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(360)
    // Laid out from the button's right edge, it would cross the left one.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: -30,
      right: 320,
      width: 350,
      top: 172,
      bottom: 520,
      height: 348,
      x: -30,
      y: 172,
      toJSON: () => ({}),
    } as DOMRect)
    const wrapper = mountPopover()

    await wrapper.get('.last-trick-button').trigger('click')
    await new Promise((resolve) => setTimeout(resolve))

    const popup = wrapper.get('.last-trick-popup')
    expect(popup.attributes('style')).toContain('--nudge: 38px')
    // Its controls point at it while open.
    expect(wrapper.get('.last-trick-button').attributes('aria-controls')).toBe(popup.attributes('id'))
  })

  test('a tap shows the four cards, each at its seat, rotated for the viewer', async () => {
    const wrapper = mountPopover('S')

    await wrapper.get('.last-trick-button').trigger('click')

    expect(wrapper.get('.last-trick-button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.last-trick-popup .playing-card')).toHaveLength(4)
    expect(sides(wrapper)).toEqual({
      top: 'N Q♠',
      left: 'W 3♠',
      right: 'E K♠',
      bottom: 'S 7♠',
    })
    // Spread apart, each card tagged with its seat (the viewer's as "You").
    expect(wrapper.get('.last-trick-popup .trick').classes()).toContain('spread')
    expect(wrapper.findAll('.last-trick-popup .seat-tag').map((t) => t.text())).toEqual([
      'N',
      'W',
      'E',
      'You',
    ])
    // The winner is ringed and named.
    expect(wrapper.get('.last-trick-popup .won').attributes('data-seat')).toBe('E')
    expect(wrapper.get('.last-trick-title').text()).toBe('Trick 4 · E wins')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Last trick: E wins')
  })

  test('East sees their own card at the bottom, and their win as theirs', async () => {
    const wrapper = mountPopover('E')

    await wrapper.get('.last-trick-button').trigger('click')

    expect(sides(wrapper)).toEqual({
      top: 'W 3♠',
      left: 'S 7♠',
      right: 'N Q♠',
      bottom: 'E K♠',
    })
    expect(wrapper.get('.last-trick-title').text()).toBe('Trick 4 · You win')
  })

  test('a mouse hovering opens it, moving away closes it', async () => {
    const wrapper = mountPopover()
    const root = wrapper.get('.last-trick')

    await root.trigger('pointerenter', { pointerType: 'mouse' })
    expect(wrapper.findAll('.last-trick-popup .playing-card')).toHaveLength(4)

    await root.trigger('pointerleave', { pointerType: 'mouse' })
    expect(wrapper.find('.last-trick-popup').exists()).toBe(false)
  })

  test('a click while hovering keeps it open after the mouse leaves', async () => {
    const wrapper = mountPopover()
    const root = wrapper.get('.last-trick')

    await root.trigger('pointerenter', { pointerType: 'mouse' })
    await wrapper.get('.last-trick-button').trigger('click')
    await root.trigger('pointerleave', { pointerType: 'mouse' })
    expect(wrapper.find('.last-trick-popup').exists()).toBe(true)

    await wrapper.get('.last-trick-button').trigger('click')
    expect(wrapper.find('.last-trick-popup').exists()).toBe(false)
  })

  test("a touch's pointer events leave it to the tap", async () => {
    const wrapper = mountPopover()
    const root = wrapper.get('.last-trick')

    await root.trigger('pointerenter', { pointerType: 'touch' })
    expect(wrapper.find('.last-trick-popup').exists()).toBe(false)

    await wrapper.get('.last-trick-button').trigger('click')
    await root.trigger('pointerleave', { pointerType: 'touch' })
    expect(wrapper.find('.last-trick-popup').exists()).toBe(true)
  })

  test('a tap outside closes it; a tap inside does not', async () => {
    const wrapper = mountPopover()
    await wrapper.get('.last-trick-button').trigger('click')

    await wrapper.get('.last-trick-popup').trigger('pointerdown')
    expect(wrapper.find('.last-trick-popup').exists()).toBe(true)

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.last-trick-popup').exists()).toBe(false)
  })

  test('Escape closes it and gives the focus back to the button', async () => {
    const wrapper = mountPopover()
    const button = wrapper.get('.last-trick-button')
    ;(button.element as HTMLButtonElement).focus()
    await button.trigger('click')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.last-trick-popup').exists()).toBe(false)
    expect(document.activeElement).toBe(button.element)
  })
})
