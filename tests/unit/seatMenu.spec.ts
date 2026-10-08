import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import SeatMenu from '@/components/SeatMenu.vue'
import BridgeTable from '@/components/BridgeTable.vue'
import type { Seat } from '@/services/tables'
import type { ScreenSide } from '@/utils/cards'
import { SEAT_MENU_EDGE, SEAT_MENU_GAP, placeSeatMenu, seatMenuPlacement } from '@/utils/seatMenu'

// An empty seat's menu at its plate (#192).

const SCREEN = { width: 390, height: 844 }
const LAYER = { left: 0, top: 0 }

describe('placeSeatMenu', () => {
  const menu = { width: 180, height: 140 }

  test('each side opens on the table side of its plate', () => {
    expect((['top', 'bottom', 'left', 'right'] as ScreenSide[]).map(seatMenuPlacement)).toEqual([
      'below',
      'above',
      'right',
      'left',
    ])
  })

  test('below the top seat, centred on it, its arrow on the plate', () => {
    const at = placeSeatMenu({ left: 145, top: 100, width: 100, height: 44 }, menu, 'top', LAYER, SCREEN)

    expect(at).toEqual({ placement: 'below', left: 105, top: 144 + SEAT_MENU_GAP, arrow: 90 })
  })

  test('above the bottom seat, measured from the layer', () => {
    const at = placeSeatMenu({ left: 145, top: 500, width: 100, height: 44 }, menu, 'bottom', { left: 10, top: 300 }, SCREEN)

    expect(at).toEqual({ placement: 'above', left: 95, top: 500 - SEAT_MENU_GAP - 140 - 300, arrow: 90 })
  })

  test('to the right of West and the left of East, centred on the plate', () => {
    const west = placeSeatMenu({ left: 12, top: 300, width: 76, height: 60 }, menu, 'left', LAYER, SCREEN)
    expect(west).toEqual({ placement: 'right', left: 88 + SEAT_MENU_GAP, top: 260, arrow: 70 })

    const east = placeSeatMenu({ left: 302, top: 300, width: 76, height: 60 }, menu, 'right', LAYER, SCREEN)
    expect(east).toEqual({ placement: 'left', left: 302 - SEAT_MENU_GAP - 180, top: 260, arrow: 70 })
  })

  test('kept on screen, the arrow still on the plate as far as the corners allow', () => {
    // A plate at the screen's left edge: the menu stops at the edge.
    const left = placeSeatMenu({ left: 0, top: 100, width: 40, height: 44 }, menu, 'top', LAYER, SCREEN)
    expect(left.left).toBe(SEAT_MENU_EDGE)
    expect(left.arrow).toBe(16)

    const right = placeSeatMenu({ left: 360, top: 100, width: 30, height: 44 }, menu, 'bottom', LAYER, SCREEN)
    expect(right.left).toBe(390 - SEAT_MENU_EDGE - 180)
    expect(right.arrow).toBe(180 - 16)

    // A side plate near the screen's top or bottom.
    const high = placeSeatMenu({ left: 12, top: 0, width: 76, height: 40 }, menu, 'left', LAYER, SCREEN)
    expect(high.top).toBe(SEAT_MENU_EDGE)
    expect(high.arrow).toBe(16)
    const low = placeSeatMenu({ left: 12, top: 820, width: 76, height: 24 }, menu, 'left', LAYER, SCREEN)
    expect(low.top).toBe(844 - SEAT_MENU_EDGE - 140)
    expect(low.arrow).toBe(140 - 16)
  })

  test('a side seat with no room beside it opens below it', () => {
    const wide = { width: 300, height: 140 }

    expect(placeSeatMenu({ left: 12, top: 300, width: 76, height: 60 }, wide, 'left', LAYER, SCREEN).placement).toBe('below')
    expect(placeSeatMenu({ left: 302, top: 300, width: 76, height: 60 }, wide, 'right', LAYER, SCREEN).placement).toBe('below')
  })
})

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

// A 390 px screen: the menu 180 × 140, the table's layer 50 px down, the
// plate where `plate` says.
function layOut(plate: (element: HTMLElement) => DOMRect) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(390)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('seat-menu')) {
      return rect(0, 0, 180, 140)
    }
    if (this.classList.contains('seat-menu-layer')) {
      return rect(0, 50, 390, 600)
    }
    return plate(this)
  })
}

let wrapper: VueWrapper | null = null
let anchor: HTMLButtonElement

async function mountMenu(props: { canManage?: boolean; moveHere?: boolean; side?: ScreenSide; seat?: Seat } = {}) {
  anchor = document.createElement('button')
  anchor.textContent = 'Empty · North'
  document.body.appendChild(anchor)
  wrapper = mount(SeatMenu, {
    props: { seat: null, anchor: null, side: props.side ?? 'top', canManage: props.canManage, moveHere: props.moveHere },
    attachTo: document.body,
  })
  await wrapper.setProps({ seat: props.seat ?? 'N', anchor })
  await flushPromises()
  return wrapper
}

function items(menu: VueWrapper) {
  return menu.findAll('[role="menuitem"]')
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('SeatMenu', () => {
  test('closed, nothing but its layer', () => {
    wrapper = mount(SeatMenu, { props: { seat: null, anchor: null, side: 'top' } })

    expect(wrapper.find('.seat-menu-layer').exists()).toBe(true)
    expect(wrapper.find('.seat-menu').exists()).toBe(false)
  })

  test('a player: the seat is free, Sit here; focus on it', async () => {
    const menu = await mountMenu()

    const title = menu.get('.seat-menu-title')
    expect(title.text()).toBe('North is free')
    const list = menu.get('[role="menu"]')
    expect(list.attributes('aria-labelledby')).toBe(title.attributes('id'))
    expect(items(menu).map((b) => b.text())).toEqual(['Sit here'])
    expect(document.activeElement).toBe(items(menu)[0].element)
    expect(menu.get('.seat-menu').classes()).toEqual(expect.arrayContaining(['seat-menu-below', 'is-placed']))
  })

  test('a manager sitting here already: Move here, Seat a player…, Add robot', async () => {
    // East's plate on the right: its menu opens to its left.
    layOut(() => rect(302, 300, 76, 60))
    const menu = await mountMenu({ canManage: true, moveHere: true, seat: 'E', side: 'right' })

    expect(menu.get('.seat-menu-title').text()).toBe('East is free')
    expect(items(menu).map((b) => b.text())).toEqual(['Move here', 'Seat a player…', 'Add robot'])
    expect(menu.get('.seat-menu').classes()).toContain('seat-menu-left')
  })

  test.each([
    [0, 'sit'],
    [1, 'player'],
    [2, 'robot'],
  ] as const)('option %i emits %s with the seat, closes and gives the focus back to the plate', async (index, event) => {
    const menu = await mountMenu({ canManage: true, seat: 'W', side: 'left' })

    await items(menu)[index].trigger('click')

    expect(menu.emitted(event)).toEqual([['W']])
    expect(menu.emitted('close')).toHaveLength(1)
    expect(document.activeElement).toBe(anchor)
  })

  test('a plate gone meanwhile keeps no focus', async () => {
    const menu = await mountMenu()
    anchor.remove()

    await items(menu)[0].trigger('click')

    expect(menu.emitted('close')).toHaveLength(1)
    expect(document.activeElement).not.toBe(anchor)
  })

  test('Escape closes it, the focus back on the plate', async () => {
    const menu = await mountMenu()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(menu.emitted('close')).toBeUndefined()
    await items(menu)[0].trigger('keydown', { key: 'Escape' })

    expect(menu.emitted('close')).toHaveLength(1)
    expect(document.activeElement).toBe(anchor)
  })

  test('a tap outside closes it; a tap in it or on its own plate does not', async () => {
    const menu = await mountMenu()

    items(menu)[0].element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    anchor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu.emitted('close')).toBeUndefined()

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu.emitted('close')).toHaveLength(1)
    // A tap outside leaves the focus where it went.
    expect(document.activeElement).not.toBe(anchor)
  })

  test('up, down, Home and End go round the options; Tab leaves and closes it', async () => {
    const menu = await mountMenu({ canManage: true })
    const [sit, player, robot] = items(menu).map((b) => b.element)

    await menu.get('.seat-menu').trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(player)
    await menu.get('.seat-menu').trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(robot)
    await menu.get('.seat-menu').trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(sit)
    await menu.get('.seat-menu').trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(robot)
    await menu.get('.seat-menu').trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(sit)
    await menu.get('.seat-menu').trigger('keydown', { key: 'a' })
    expect(menu.emitted('close')).toBeUndefined()

    await menu.get('.seat-menu').trigger('keydown', { key: 'Tab' })
    expect(menu.emitted('close')).toHaveLength(1)
    expect(document.activeElement).toBe(sit)
  })

  test('placed at its plate, again when the screen resizes', async () => {
    layOut((plate) => rect(plate.dataset.moved ? 45 : 145, 100, 100, 44))
    const menu = await mountMenu()

    const style = () => menu.get('.seat-menu').attributes('style')
    expect(style()).toContain('left: 105px')
    expect(style()).toContain(`top: ${144 + SEAT_MENU_GAP - 50}px`)
    expect(style()).toContain('--arrow: 90px')

    anchor.dataset.moved = '1'
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(style()).toContain('left: 8px')
  })

  test('moved to another seat: placed and focused there', async () => {
    const menu = await mountMenu()
    const other = document.createElement('button')
    document.body.appendChild(other)

    await menu.setProps({ seat: 'S', anchor: other, side: 'bottom' })
    await flushPromises()

    expect(menu.get('.seat-menu-title').text()).toBe('South is free')
    expect(menu.get('.seat-menu').classes()).toContain('seat-menu-above')
    expect(document.activeElement).toBe(items(menu)[0].element)
  })

  test('closed by its page: it stops listening', async () => {
    const menu = await mountMenu()

    await menu.setProps({ seat: null, anchor: null })
    await flushPromises()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(menu.find('.seat-menu').exists()).toBe(false)
    expect(menu.emitted('close')).toBeUndefined()
  })

  test('without a plate it stays hidden until it has one', async () => {
    wrapper = mount(SeatMenu, { props: { seat: null, anchor: null, side: 'top' }, attachTo: document.body })

    await wrapper.setProps({ seat: 'N' })
    await flushPromises()

    expect(wrapper.get('.seat-menu').classes()).not.toContain('is-placed')
  })
})

describe('BridgeTable empty seats', () => {
  test('a seat to fill says it opens a menu, and passes its plate and side along', async () => {
    const table = mount(BridgeTable, {
      props: { players: { S: null }, mySeat: 'S', board: null, turn: null, seatable: true, menuSeat: 'W' },
      slots: { menu: '<div class="menu-slot" />' },
    })

    const west = table.get('[data-seat="W"] .seat-empty-button')
    expect(west.attributes('aria-haspopup')).toBe('menu')
    expect(west.attributes('aria-expanded')).toBe('true')
    expect(table.get('[data-seat="N"] .seat-empty-button').attributes('aria-expanded')).toBe('false')
    // The menu's layer lies over the whole table.
    expect(table.find('.bridge-table > .menu-slot').exists()).toBe(true)

    await west.trigger('click')
    await table.get('[data-seat="N"] .seat-empty-button').trigger('click')

    expect(table.emitted('empty')).toEqual([
      ['W', west.element, 'left'],
      ['N', table.get('[data-seat="N"] .seat-empty-button').element, 'top'],
    ])
  })
})
