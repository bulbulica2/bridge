import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import BridgeTable from '@/components/BridgeTable.vue'
import HandView from '@/components/HandView.vue'
import type { Card, Suit } from '@/services/game'
import { DEFAULT_CARD_SIZE, cardSize } from '@/utils/cardSize'
import {
  MIN_CARD_PX,
  MIN_STEP_PX,
  SUIT_GAP_PX,
  floorStep,
  naturalStep,
  rowCardWidth,
  rowSteps,
} from '@/utils/handRow'

// Dummy's cards on one row across the top of the table (#172): they overlap
// more where the row is short of room, then get smaller, and never wrap.

// A ResizeObserver reporting every element `width` px wide.
let width = 0
class FakeResizeObserver {
  disconnect = vi.fn()
  constructor(private callback: ResizeObserverCallback) {}
  observe(el: Element) {
    this.callback([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], this as never)
  }
}

// A full hand: four spades, then three of each other suit.
const SUITS_DEALT: [Suit, number][] = [
  ['S', 4],
  ['H', 3],
  ['D', 3],
  ['C', 3],
]
const HAND: Card[] = SUITS_DEALT.flatMap(([suit, count], s) =>
  Array.from({ length: count }, (_, i) => ({ id: s * 20 + 14 - i, suit, rank: 14 - i, rank_name: String(14 - i) })),
)

function cssVar(element: Element, name: string) {
  return (element as HTMLElement).style.getPropertyValue(name)
}

// Each card's left margin in px, in the order drawn (null: none set).
function margins(wrapper: ReturnType<typeof mount>): (number | null)[] {
  return wrapper.findAll('.card').map((card) => {
    const margin = (card.element as HTMLElement).style.marginLeft
    return margin ? Number.parseFloat(margin) : null
  })
}

beforeEach(() => {
  cardSize.value = DEFAULT_CARD_SIZE
  width = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the row maths', () => {
  test('the usual step and the floor', () => {
    expect(naturalStep(48)).toBe(44)
    expect(naturalStep(120)).toBeCloseTo(55.2)
    expect(floorStep(36)).toBe(MIN_STEP_PX)
    expect(floorStep(120)).toBeCloseTo(50.4)
  })

  test("the cards keep the setting's size where 13 fit at the floor", () => {
    expect(rowCardWidth(1000, 120)).toBe(120)
    expect(rowCardWidth(600, 48)).toBe(48)
  })

  test('else they get smaller: the floor a share of the card, then 22 px', () => {
    // 600 - 3 x 4 = 588 = w + 12 x 0.42 w.
    expect(rowCardWidth(600, 120)).toBeCloseTo(588 / 6.04)
    // A 360 px phone's row: 300 - 12 x 22.
    expect(rowCardWidth(312, 96)).toBeCloseTo(36)
    expect(rowCardWidth(200, 96)).toBe(MIN_CARD_PX)
  })

  test('the usual step wherever it fits', () => {
    expect(rowSteps(1000, 120, 4, Array(13).fill(false))).toEqual(Array(12).fill(naturalStep(120)))
    expect(rowSteps(400, 96, 1, [true])).toEqual([])
  })

  test('short of room, the cards overlap more, down to the floor', () => {
    // 600 - 96 - 12 = 492 for twelve steps.
    const steps = rowSteps(600, 96, 4, Array(13).fill(false))
    steps.forEach((step) => expect(step).toBeCloseTo(41))
    expect(rowSteps(300, 96, 4, Array(13).fill(false))).toEqual(Array(12).fill(floorStep(96)))
  })

  test('a card that can be tapped keeps the usual step, the rest share what is left', () => {
    const tappable = [true, true, ...Array(11).fill(false)]
    const steps = rowSteps(600, 96, 4, tappable)
    expect(steps.slice(0, 2)).toEqual([naturalStep(96), naturalStep(96)])
    steps.slice(2).forEach((step) => expect(step).toBeCloseTo((492 - 2 * naturalStep(96)) / 10))
  })

  test("when the tappable ones can't all keep it, the rest stay at the floor and they share", () => {
    // 400 - 36 - 12 = 352: twelve tappable cards share it.
    rowSteps(400, 36, 4, Array(13).fill(true)).forEach((step) => expect(step).toBeCloseTo(352 / 12))
    // Six tappable: 6 x 22 for the rest, 220 shared by them.
    const steps = rowSteps(400, 36, 4, [...Array(6).fill(true), ...Array(7).fill(false)])
    steps.slice(0, 6).forEach((step) => expect(step).toBeCloseTo(220 / 6))
    expect(steps.slice(6)).toEqual(Array(6).fill(MIN_STEP_PX))
    // Never under the floor, though the row then spills over.
    expect(rowSteps(100, 36, 4, Array(13).fill(true))).toEqual(Array(12).fill(MIN_STEP_PX))
  })
})

describe("HandView's single row", () => {
  test("lays the cards on one row from the row's width: the usual step where it fits", async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    width = 1000
    cardSize.value = 'xlarge'
    const wrapper = mount(HandView, { props: { cards: HAND, singleRow: true, label: "Dummy's hand" } })
    await nextTick()

    const root = wrapper.get('.hand')
    expect(root.classes()).toContain('single-row')
    expect(cssVar(root.element, '--card-max')).toBe('120px')
    expect(cssVar(root.element, '--card-step')).toBe(`${naturalStep(120)}px`)
    // Default order ♥ ♣ ♦ ♠: a suit's first card leaves the gap too.
    const step = naturalStep(120) - 120
    expect(margins(wrapper)).toEqual([
      null,
      step,
      step,
      step + SUIT_GAP_PX,
      step,
      step,
      step + SUIT_GAP_PX,
      step,
      step,
      step + SUIT_GAP_PX,
      step,
      step,
      step,
    ])
  })

  test('on a phone the cards get smaller, at the floor step, rather than wrap', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    width = 312
    const wrapper = mount(HandView, { props: { cards: HAND, singleRow: true } })
    await nextTick()

    const root = wrapper.get('.hand').element
    const card = Number.parseFloat(cssVar(root, '--card-max'))
    expect(card).toBeCloseTo(36)
    const shown = margins(wrapper).map((margin) => (margin === null ? null : margin + card))
    expect(shown[1]).toBeCloseTo(MIN_STEP_PX)
    expect(shown[3]).toBeCloseTo(MIN_STEP_PX + SUIT_GAP_PX)
  })

  test("the cards keep their size as they go, so the row keeps its height", async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    width = 600
    const wrapper = mount(HandView, { props: { cards: HAND, singleRow: true } })
    await nextTick()
    const before = cssVar(wrapper.get('.hand').element, '--card-max')

    await wrapper.setProps({ cards: HAND.slice(0, 3) })

    expect(cssVar(wrapper.get('.hand').element, '--card-max')).toBe(before)
    // Three cards fit at the usual step now.
    const card = Number.parseFloat(before)
    expect(margins(wrapper)[1]).toBeCloseTo(naturalStep(card) - card)
  })

  test('a playable card keeps a finger-wide strip, as do the cards after the others', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    width = 600
    // Hearts come first: the first heart can be played.
    const heart = HAND.find((card) => card.suit === 'H')!
    const wrapper = mount(HandView, { props: { cards: HAND, singleRow: true, playable: [heart.id] } })
    await nextTick()

    const card = Number.parseFloat(cssVar(wrapper.get('.hand').element, '--card-max'))
    const shown = margins(wrapper).map((margin) => (margin === null ? null : margin + card))
    expect(shown[1]).toBeCloseTo(naturalStep(card))
    expect(shown[2]!).toBeLessThan(naturalStep(card))
    expect(shown[2]!).toBeGreaterThanOrEqual(floorStep(card))
    expect(wrapper.get(`button[data-card="${heart.id}"]`).attributes('disabled')).toBeUndefined()
  })

  test('unmeasured (no ResizeObserver), one row still, at the usual steps', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const wrapper = mount(HandView, { props: { cards: HAND, singleRow: true } })
    await nextTick()

    expect(wrapper.get('.hand').classes()).toContain('single-row')
    expect(cssVar(wrapper.get('.hand').element, '--card-max')).toBe('')
    expect(margins(wrapper).every((margin) => margin === null)).toBe(true)
  })

  test("a hand that may wrap isn't measured", () => {
    const observe = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe
        disconnect = vi.fn()
      },
    )
    const wrapper = mount(HandView, { props: { cards: HAND } })

    expect(wrapper.get('.hand').classes()).not.toContain('single-row')
    expect(cssVar(wrapper.get('.hand').element, '--card-step')).toBe('max(44px, calc(var(--card-w) * 0.46))')
    // useSteadyHeight's observer only: the row's width is never asked.
    expect(observe).toHaveBeenCalledTimes(1)
    expect(margins(wrapper).every((margin) => margin === null)).toBe(true)
  })
})

describe('BridgeTable', () => {
  const PLAYERS = {
    N: { id: 1, name: 'R', username: 'robot-1', description: null, is_robot: true },
    S: { id: 3, name: 'Cy', username: 'cy', description: null, is_robot: false },
  }

  test("lays dummy's cards across the top on one row", () => {
    const wrapper = mount(BridgeTable, {
      props: { players: PLAYERS, mySeat: 'S', board: null, turn: null, dummy: { seat: 'N', cards: HAND } },
    })

    expect(wrapper.get('.side-top .dummy-hand').classes()).toContain('single-row')
    expect(wrapper.getComponent(HandView).props('singleRow')).toBe(true)
  })

  test("and a robot declarer's, for its dummy", () => {
    const wrapper = mount(BridgeTable, {
      props: { players: PLAYERS, mySeat: 'S', board: null, turn: null, declarer: { seat: 'N', cards: HAND } },
    })

    expect(wrapper.get('.side-top .declarer-hand').classes()).toContain('single-row')
  })
})
