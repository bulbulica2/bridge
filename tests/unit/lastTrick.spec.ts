import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, test } from 'vitest'
import LastTrickPopover from '@/components/LastTrickPopover.vue'
import type { Card, PlayedCard, Suit, Trick } from '@/services/game'
import type { Seat } from '@/services/tables'

enableAutoUnmount(afterEach)

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
