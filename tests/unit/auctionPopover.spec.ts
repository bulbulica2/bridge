import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import AuctionPopover from '@/components/AuctionPopover.vue'
import type { AuctionCall, Bid, Board, Seat } from '@/services/game'

// The play page's Auction button (#165): the grid in a pop-up, opened by a
// mouse hovering or a tap, with Ask and Ask in the chat still there.
const board: Board = { id: 7, number: 7, dealer: 'N', vulnerable: 'N-S' }

function bid(call: string, id: number): Bid {
  const match = /^(\d)(C|D|H|S|NT)$/.exec(call)
  return match
    ? ({ id, call, level: Number(match[1]), strain: match[2], special: false } as Bid)
    : ({ id, call, level: null, strain: null, special: true } as Bid)
}

const auction: AuctionCall[] = [
  { seat: 'N' as Seat, bid: bid('1NT', 20), alert: null, question: null },
  { seat: 'E' as Seat, bid: bid('2D', 11), alert: { explanation: 'Majors' }, question: null },
  { seat: 'S' as Seat, bid: bid('P', 1), alert: null, question: null },
]

let wrapper: VueWrapper | null = null

function mountPopover(props: Record<string, unknown> = {}) {
  wrapper = mount(AuctionPopover, {
    props: { auction, board, mySeat: 'S', ...props },
    attachTo: document.body,
  })
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('AuctionPopover', () => {
  test('a button, closed at first', () => {
    const w = mountPopover()

    const button = w.get('.auction-button')
    expect(button.text()).toBe('Auction')
    expect(button.attributes('aria-haspopup')).toBe('dialog')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(w.find('.auction-popup').exists()).toBe(false)
  })

  test('a mouse hovering opens it, moving away closes it; a touch does neither', async () => {
    const w = mountPopover()
    const root = w.get('.auction-peek')

    await root.trigger('pointerenter', { pointerType: 'touch' })
    expect(w.find('.auction-popup').exists()).toBe(false)

    await root.trigger('pointerenter', { pointerType: 'mouse' })
    const popup = w.get('.auction-popup')
    expect(popup.attributes('role')).toBe('dialog')
    expect(popup.attributes('id')).toBe(w.get('.auction-button').attributes('aria-controls'))
    // The grid as AuctionHistory draws it: the vulnerable side's seats red,
    // the alert marked.
    expect(popup.findAll('th.vul').map((th) => th.get('.seat').text())).toEqual(['N', 'S'])
    expect(popup.findAll('.call-button.alerted')).toHaveLength(1)

    await root.trigger('pointerleave', { pointerType: 'mouse' })
    expect(w.find('.auction-popup').exists()).toBe(false)
  })

  test('a tap toggles it; Escape or a tap outside closes it', async () => {
    const w = mountPopover()
    const button = w.get('.auction-button')

    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')
    await button.trigger('click')
    expect(w.find('.auction-popup').exists()).toBe(false)

    await button.trigger('click')
    ;(button.element as HTMLButtonElement).focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('.auction-popup').exists()).toBe(false)
    expect(document.activeElement).toBe(button.element)

    await button.trigger('click')
    // A tap inside (a call's own pop-up) keeps it open.
    w.get('.auction-popup').element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(w.find('.auction-popup').exists()).toBe(true)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(w.find('.auction-popup').exists()).toBe(false)
  })

  test("while the board is on, an opponent's call offers Ask and Ask in the chat", async () => {
    const w = mountPopover({ live: true })

    await w.get('.auction-button').trigger('click')
    const east = w.findAll('.auction-popup .call-button').find((b) => b.text().startsWith('2♦'))!
    await east.trigger('click')
    await w.get('.popup-action.ask').trigger('click')
    expect(w.emitted('ask')).toEqual([[1]])

    await w.get('.popup-action.ask-in-chat').trigger('click')
    expect(w.emitted('chat')).toEqual([[1]])
  })

  test('our questioned call offers Answer', async () => {
    const asked = auction.map((call, i) => (i === 2 ? { ...call, question: { asked_by: 'W' as Seat } } : call))
    const w = mountPopover({ auction: asked, live: true })

    await w.get('.auction-button').trigger('click')
    const ours = w.findAll('.auction-popup .call-button').find((b) => b.text().startsWith('Pass'))!
    await ours.trigger('click')
    await w.get('.popup-action.answer').trigger('click')
    expect(w.emitted('explain')).toEqual([[2]])
  })

  test('once the board is over, no Ask', async () => {
    const w = mountPopover()

    await w.get('.auction-button').trigger('click')
    await w.findAll('.auction-popup .call-button').find((b) => b.text().startsWith('2♦'))!.trigger('click')
    expect(w.get('.alert-text').text()).toBe('Majors')
    expect(w.find('.popup-action.ask').exists()).toBe(false)
  })
})
