import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { IonSegment, IonSegmentButton } from '@ionic/vue'
import { pickSegment } from './ionEvents'
import AccountPage from '@/views/AccountPage.vue'
import DummyColumns from '@/components/DummyColumns.vue'
import HandView from '@/components/HandView.vue'
import LeadAnalysis from '@/components/LeadAnalysis.vue'
import PlayingCard from '@/components/PlayingCard.vue'
import TrickArea from '@/components/TrickArea.vue'
import type { Card } from '@/services/game'
import {
  CARD_SIZES,
  CARD_SIZE_KEY,
  DEFAULT_CARD_SIZE,
  MIN_TARGET_PX,
  cardSize,
  cardTextSize,
  cardWidthCss,
  readCardSize,
  setCardSize,
} from '@/utils/cardSize'

vi.mock('@/services/auth', () => ({ logout: vi.fn(), fetchUser: vi.fn(), updateProfile: vi.fn() }))
vi.mock('@/router/loading', () => ({ navigateAndSettle: vi.fn() }))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn(), showWelcomeToast: vi.fn() }))
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  useIonRouter: () => ({ navigate: vi.fn() }),
}))

const aceOfSpades: Card = { id: 1, suit: 'S', rank: 15, rank_name: 'Ace' }

function hand(count: number): Card[] {
  const suits = ['S', 'H', 'D', 'C'] as const
  return Array.from({ length: count }, (_, i) => ({
    id: 100 + i,
    suit: suits[i % 4],
    rank: 2 + Math.floor(i / 4),
    rank_name: 'x',
  }))
}

function cssVar(element: Element, name: string) {
  return (element as HTMLElement).style.getPropertyValue(name)
}

beforeEach(() => {
  localStorage.clear()
  cardSize.value = DEFAULT_CARD_SIZE
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the card size setting', () => {
  test('is Large on a first visit', () => {
    expect(DEFAULT_CARD_SIZE).toBe('large')
    expect(readCardSize()).toBe('large')
  })

  test('offers Normal (the old 48px card), Large (twice it) and Extra large', () => {
    expect(CARD_SIZES.map((size) => [size.value, size.label, size.width])).toEqual([
      ['normal', 'Normal', 48],
      ['large', 'Large', 96],
      ['xlarge', 'Extra large', 120],
    ])
  })

  test('is kept in storage and read back', () => {
    setCardSize('xlarge')

    expect(cardSize.value).toBe('xlarge')
    expect(localStorage.getItem(CARD_SIZE_KEY)).toBe('xlarge')
    expect(readCardSize()).toBe('xlarge')
  })

  test('reads anything else kept under its key as Large', () => {
    localStorage.setItem(CARD_SIZE_KEY, 'huge')

    expect(readCardSize()).toBe('large')
  })

  test('is Large when storage refuses to be read', () => {
    localStorage.setItem(CARD_SIZE_KEY, 'normal')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('denied')
    })

    expect(readCardSize()).toBe('large')
  })

  test('a pick storage refuses still holds until the reload', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota')
    })

    setCardSize('normal')

    expect(setItem).toHaveBeenCalled()
    expect(cardSize.value).toBe('normal')
  })

  test('gives the card width as CSS, capped by the room around it', () => {
    expect(cardWidthCss.value).toBe('min(96px, var(--card-max, 96px))')
    expect(cardTextSize.value).toBe('1.15rem')

    setCardSize('normal')

    expect(cardWidthCss.value).toBe('min(48px, var(--card-max, 48px))')
    expect(cardTextSize.value).toBe('0.9rem')
  })
})

describe('cards drawn at the set size', () => {
  test('PlayingCard takes its width from the setting, and follows a change', async () => {
    const wrapper = mount(PlayingCard, { props: { card: aceOfSpades } })
    const card = wrapper.find('.playing-card').element
    expect(cssVar(card, '--card-w')).toBe('min(96px, var(--card-max, 96px))')

    setCardSize('xlarge')
    await flushPromises()

    expect(cssVar(card, '--card-w')).toBe('min(120px, var(--card-max, 120px))')
  })

  test("HandView's overlap leaves every card at least 44px to tap", () => {
    const wrapper = mount(HandView, { props: { cards: hand(13), playable: [100] } })
    const root = wrapper.find('.hand').element

    expect(MIN_TARGET_PX).toBe(44)
    expect(cssVar(root, '--card-w')).toBe(cardWidthCss.value)
    expect(cssVar(root, '--card-step')).toBe('max(44px, calc(var(--card-w) * 0.46))')
  })

  test('the trick and the opening lead analysis use the same width', () => {
    const trick = mount(TrickArea, { props: { cards: [], mySeat: 'S' } })
    const leads = mount(LeadAnalysis, {
      props: { leads: [{ card: aceOfSpades, tricks: 9 }], leader: 'W', lead: null, mySeat: 'S' },
    })

    expect(cssVar(trick.find('.trick').element, '--card-w')).toBe(cardWidthCss.value)
    expect(cssVar(leads.find('.leads').element, '--card-w')).toBe(cardWidthCss.value)
    expect(cssVar(leads.find('.leads').element, '--card-step')).toBe(
      'max(44px, calc(var(--card-w) * 0.46))',
    )
  })

  test("DummyColumns' ranks follow the setting", async () => {
    const wrapper = mount(DummyColumns, { props: { cards: hand(5) } })
    const columns = wrapper.find('.dummy-columns').element
    expect(cssVar(columns, '--hand-text')).toBe('1.15rem')

    setCardSize('xlarge')
    await flushPromises()

    expect(cssVar(columns, '--hand-text')).toBe('1.35rem')
  })
})

describe("the hand's steady height", () => {
  let observed: (() => void) | null
  let disconnect: ReturnType<typeof vi.fn>
  let box: { width: number; height: number }

  beforeEach(() => {
    observed = null
    disconnect = vi.fn()
    box = { width: 500, height: 300 }
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observed = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: box.width, height: box.height }) as DOMRect,
    )
  })

  function mountHand(cards: Card[]) {
    return mount(HandView, { props: { cards }, attachTo: document.body })
  }

  function minHeight(wrapper: ReturnType<typeof mountHand>) {
    return (wrapper.find('.hand').element as HTMLElement).style.minHeight
  }

  test('holds the tallest it has been while cards are played', async () => {
    const wrapper = mountHand(hand(13))
    observed!()
    expect(minHeight(wrapper)).toBe('300px')

    box.height = 200
    await wrapper.setProps({ cards: hand(12) })
    observed!()

    expect(minHeight(wrapper)).toBe('300px')
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  test('measures afresh for a new deal', async () => {
    const wrapper = mountHand(hand(5))
    observed!()
    box.height = 120
    await wrapper.setProps({ cards: hand(4) })
    expect(minHeight(wrapper)).toBe('300px')

    await wrapper.setProps({ cards: hand(13) })

    expect(minHeight(wrapper)).toBe('120px')
    wrapper.unmount()
  })

  test('measures afresh for another card size', async () => {
    const wrapper = mountHand(hand(13))
    observed!()
    box.height = 180

    setCardSize('normal')
    await flushPromises()

    expect(minHeight(wrapper)).toBe('180px')
    wrapper.unmount()
  })

  test('measures afresh when its width changes', () => {
    const wrapper = mountHand(hand(13))
    observed!()

    box = { width: 340, height: 250 }
    observed!()

    expect(minHeight(wrapper)).toBe('250px')
    wrapper.unmount()
  })

  test('does nothing without ResizeObserver', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', undefined)
    const wrapper = mountHand(hand(13))

    await wrapper.setProps({ cards: hand(13).concat(hand(1)) })

    expect(minHeight(wrapper)).toBe('')
    wrapper.unmount()
  })
})

describe('the Account page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('offers the three sizes, Large picked, with a preview', () => {
    const wrapper = mount(AccountPage)

    expect(wrapper.find('.card-size-title').text()).toBe('Card size')
    expect(wrapper.findAllComponents(IonSegmentButton).map((b) => b.text())).toEqual([
      'Normal',
      'Large',
      'Extra large',
    ])
    expect(wrapper.findComponent(IonSegment).props('modelValue')).toBe('large')
    expect(wrapper.find('.card-size-preview').findAllComponents(PlayingCard)).toHaveLength(2)
  })

  test('a pick switches every card at once and is kept', async () => {
    const wrapper = mount(AccountPage)

    await pickSegment(wrapper, 'xlarge')

    expect(cardSize.value).toBe('xlarge')
    expect(localStorage.getItem(CARD_SIZE_KEY)).toBe('xlarge')
    expect(wrapper.findComponent(IonSegment).props('modelValue')).toBe('xlarge')
    expect(cssVar(wrapper.find('.card-size-preview .playing-card').element, '--card-w')).toBe(
      'min(120px, var(--card-max, 120px))',
    )
  })

  test('ignores a change without a size', async () => {
    const wrapper = mount(AccountPage)

    wrapper.findComponent(IonSegment).vm.$emit('update:modelValue', undefined)
    await flushPromises()

    expect(cardSize.value).toBe('large')
    expect(localStorage.getItem(CARD_SIZE_KEY)).toBeNull()
  })
})
