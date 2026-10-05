import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { usePopover } from '@/composables/usePopover'

// A button and its pop-up, wired as LastTrickPopover and AuctionCallCell do.
const Popover = defineComponent({
  setup() {
    const popover = usePopover()
    return { ...popover }
  },
  render() {
    return h('span', { ref: 'root' }, [
      h('button', { ref: 'button', onClick: this.toggle }, 'Open'),
      this.open ? h('div', { ref: 'popup', class: 'popup' }, 'Pop-up') : null,
    ])
  },
})

// A screen `screen` px wide, and the pop-up's box as it would first be laid
// out, centred under the button.
function layOut(left: number, width: number, screen = 400) {
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(screen)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 0,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

async function opened() {
  const wrapper = mount(Popover)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  return wrapper
}

describe('usePopover keeps the pop-up on screen', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('centred when it fits', async () => {
    layOut(100, 200)

    expect((await opened()).vm.nudge).toBe(0)
  })

  test('moved right off the left edge', async () => {
    layOut(-30, 200)

    expect((await opened()).vm.nudge).toBe(38)
  })

  test('moved left off the right edge', async () => {
    layOut(250, 200)

    expect((await opened()).vm.nudge).toBe(-58)
  })

  test('wider than the screen: its left edge stays in sight', async () => {
    layOut(20, 400, 300)

    expect((await opened()).vm.nudge).toBe(-12)
  })

  test('moved left off a panel pinned on the right, such as the chat', async () => {
    const panel = document.createElement('aside')
    panel.setAttribute('data-right-edge', '')
    document.body.appendChild(panel)
    layOut(100, 200, 1000)
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 280, width: 320 } as DOMRect)

    try {
      expect((await opened()).vm.nudge).toBe(-28)
    } finally {
      panel.remove()
    }
  })

  test('a panel not laid out counts for nothing', async () => {
    const panel = document.createElement('aside')
    panel.setAttribute('data-right-edge', '')
    document.body.appendChild(panel)
    layOut(250, 200)
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 0 } as DOMRect)

    try {
      expect((await opened()).vm.nudge).toBe(-58)
    } finally {
      panel.remove()
    }
  })

  test('nothing laid out yet: left where it is', async () => {
    layOut(-30, 0)

    expect((await opened()).vm.nudge).toBe(0)
  })
})
