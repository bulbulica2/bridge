import { VueWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import TablePlayPage from '@/views/TablePlayPage.vue'
import AuctionHistory from '@/components/AuctionHistory.vue'
import BoardChat from '@/components/BoardChat.vue'
import * as chatService from '@/services/chat'
import type { BoardMessage } from '@/services/chat'
import * as gameService from '@/services/game'
import * as tablesService from '@/services/tables'
import type { Bid, Playing, Seat } from '@/services/game'
import type { Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { CHAT_OPEN_KEY, useChatStore } from '@/stores/chat'
import { useGameStore } from '@/stores/game'
import { showToast } from '@/utils/toast'

// The board chat on the play page: the header's Chat button and its unread
// badge, the panel (a sheet on a phone, beside the table on a wide screen,
// on show there until collapsed), sending and its refusals, and Ask in the
// chat from an opponent's call.
vi.mock('@/services/chat', () => ({ getMessages: vi.fn(), sendMessage: vi.fn() }))
vi.mock('@/services/game', () => ({ getPlaying: vi.fn(), getBids: vi.fn() }))
vi.mock('@/services/history', () => ({ getMyPlayings: vi.fn(), getSet: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/services/tables', async (importOriginal) => ({
  ...(await importOriginal<typeof tablesService>()),
  getTable: vi.fn(),
  sendHeartbeat: vi.fn(),
}))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn() }))
const { navigate, enterHooks, leaveHooks } = vi.hoisted(() => ({
  navigate: vi.fn(),
  enterHooks: [] as (() => void)[],
  leaveHooks: [] as (() => void)[],
}))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ params: { id: '5' } }),
}))
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate }),
    onIonViewWillEnter: (hook: () => void) => {
      enterHooks.push(hook)
      onMounted(hook)
    },
    onIonViewWillLeave: (hook: () => void) => leaveHooks.push(hook),
  }
})

function axiosError(status: number, message = 'Refused.'): AxiosError {
  const config = { headers: new AxiosHeaders() }
  const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config)
  error.response = { status, data: { message }, statusText: '', headers: {}, config }
  return error
}

const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null, is_robot: false },
  E: { id: 2, name: 'Bob', username: 'bob', description: null, is_robot: false },
  S: { id: 3, name: 'Cy', username: 'cy', description: null, is_robot: false },
  W: { id: 4, name: 'Di', username: 'di', description: null, is_robot: false },
}

function makeTable(): Table {
  const seats: Seat[] = ['N', 'E', 'S', 'W']
  return {
    id: 5,
    name: 'Club',
    created_by: 1,
    moderated_by: 1,
    board_id: 7,
    unattended_since: null,
    created_at: '',
    updated_at: '',
    seats: seats.map((seat, i) => ({
      id: i + 1,
      table_id: 5,
      user_id: PLAYERS[seat].id,
      seat,
      ready: false,
      user: PLAYERS[seat],
    })),
    free_seats: [],
    set: null,
    can_manage: false,
  }
}

const pass = { id: 1, call: 'P', level: null, strain: null, special: true } as Bid
const oneHeart = { id: 6, call: '1H', level: 1, strain: 'H', special: false } as Bid

// The user is South (Cy); East opened 1♥ and it is South's call.
function auction(overrides: Partial<Playing> = {}): Playing {
  return {
    phase: 'auction',
    playing_id: 42,
    set: null,
    board: { id: 7, number: 7, dealer: 'E', vulnerable: '' },
    players: PLAYERS,
    turn: 'S',
    acting_user_id: 3,
    auction: [{ seat: 'E', bid: oneHeart }],
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    claim: null,
    result: null,
    deal: null,
    ready: null,
    next_board_at: null,
    my_seat: 'S',
    hand: [],
    declarer_hand: null,
    ...overrides,
  }
}

function message(id: number, overrides: Partial<BoardMessage> = {}): BoardMessage {
  return {
    id,
    seat: 'E',
    user_id: 2,
    to: 'opponents',
    call_index: null,
    body: `Message ${id}`,
    created_at: '2026-10-05T12:00:00.000000Z',
    ...overrides,
  }
}

const modalStub = { template: '<div><slot /></div>' }

async function mountPage(playing: Playing = auction(), messages: BoardMessage[] = []) {
  vi.mocked(tablesService.getTable).mockResolvedValue(makeTable())
  vi.mocked(gameService.getPlaying).mockResolvedValue(playing)
  vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: playing.playing_id, messages })
  const wrapper = mount(TablePlayPage, {
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub, 'router-link': true } },
  })
  await flushPromises()
  return wrapper
}

async function openChat(wrapper: VueWrapper) {
  await wrapper.get('.chat-toggle').trigger('click')
  await flushPromises()
}

// A screen wide enough for the chat beside the table.
function wide() {
  window.matchMedia = vi.fn(
    () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
  )
}

// Another page pushed on top, then back to the table.
async function leaveView() {
  leaveHooks.forEach((hook) => hook())
  await flushPromises()
}

async function returnToView() {
  enterHooks.forEach((hook) => hook())
  await flushPromises()
}

async function write(wrapper: VueWrapper, text: string) {
  await wrapper.get('.chat-input').setValue(text)
  await wrapper.get('.chat-send').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  enterHooks.length = 0
  leaveHooks.length = 0
  localStorage.clear()
  useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
  vi.mocked(gameService.getBids).mockResolvedValue([pass, oneHeart])
})

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('the Chat button', () => {
  test('no chat before the first deal', async () => {
    const wrapper = await mountPage(auction({ phase: 'waiting', playing_id: null, auction: null, players: null }))

    expect(wrapper.find('.chat-toggle').exists()).toBe(false)
    expect(chatService.getMessages).toHaveBeenCalledWith(5)
  })

  test('the board’s chat is read on entry, and the others’ messages show as a badge', async () => {
    const wrapper = await mountPage(auction(), [message(1), message(2, { seat: 'S', user_id: 3 }), message(3)])
    const button = wrapper.get('.chat-toggle')

    expect(chatService.getMessages).toHaveBeenCalledWith(5)
    expect(button.get('.chat-badge').text()).toBe('2')
    expect(button.attributes('aria-label')).toBe('Chat, 2 new')
    expect(wrapper.find('.board-chat').exists()).toBe(false)

    await openChat(wrapper)
    expect(wrapper.find('.chat-badge').exists()).toBe(false)
    expect(wrapper.get('.chat-toggle').attributes('aria-label')).toBe('Chat')
    expect(wrapper.get('.play').classes()).toContain('with-chat-sheet')
    // The room beside the table is only for the chat at its side.
    expect(wrapper.get('.play').classes()).not.toContain('with-chat-side')
    expect(wrapper.findAll('.board-chat .chat-message')).toHaveLength(3)

    await openChat(wrapper)
    expect(wrapper.find('.board-chat').exists()).toBe(false)
  })

  test('a message arriving while it is closed bumps the badge', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('.chat-badge').exists()).toBe(false)

    useGameStore().applyBoardMessage({ table_id: 5, playing_id: 42, message: message(4) })
    await flushPromises()
    expect(wrapper.get('.chat-badge').text()).toBe('1')
  })

  test('a finished board’s chat is read again: partner’s messages are public now', async () => {
    await mountPage()
    expect(chatService.getMessages).toHaveBeenCalledTimes(1)

    useGameStore().adopt(5, auction({ phase: 'finished', turn: null, acting_user_id: null }))
    await flushPromises()
    expect(chatService.getMessages).toHaveBeenCalledTimes(2)
  })
})

describe('the chat panel', () => {
  test('sends to the table mid-board, and clears the text once sent', async () => {
    const mine = message(5, { seat: 'S', user_id: 3, to: 'table', body: 'Hello' })
    vi.mocked(chatService.sendMessage).mockResolvedValue(mine)
    const wrapper = await mountPage()
    await openChat(wrapper)

    expect(wrapper.get('.chat-to-note').text()).toBe('Everyone at the table sees this.')
    await write(wrapper, '  Hello ')

    expect(chatService.sendMessage).toHaveBeenCalledWith(5, { body: 'Hello', to: 'table', call_index: null })
    expect((wrapper.get('.chat-input').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.get('.board-chat .chat-message.mine').text()).toContain('Hello')
  })

  test('or to the opponents only, picked on the switch', async () => {
    vi.mocked(chatService.sendMessage).mockResolvedValue(message(5, { seat: 'S', user_id: 3, body: 'Hi' }))
    const wrapper = await mountPage()
    await openChat(wrapper)

    await wrapper.findAll('.chat-to-option')[1].trigger('click')
    expect(wrapper.get('.chat-to-note').text()).toBe('Only the opponents see this, not your partner.')
    await write(wrapper, 'Hi')
    expect(chatService.sendMessage).toHaveBeenCalledWith(5, { body: 'Hi', to: 'opponents', call_index: null })
  })

  test('a refused message is told at the top and keeps its text', async () => {
    vi.mocked(chatService.sendMessage).mockRejectedValue(axiosError(429, 'Too Many Attempts.'))
    const wrapper = await mountPage()
    await openChat(wrapper)

    await write(wrapper, 'Hello')

    expect(showToast).toHaveBeenCalledWith('Too Many Attempts.', 'danger', 'top')
    expect((wrapper.get('.chat-input').element as HTMLTextAreaElement).value).toBe('Hello')
    expect(wrapper.get('.chat-send').attributes('disabled')).toBeUndefined()
  })

  test('a 401 goes to log in', async () => {
    vi.mocked(chatService.sendMessage).mockRejectedValue(axiosError(401))
    const wrapper = await mountPage()
    await openChat(wrapper)

    await write(wrapper, 'Hello')
    expect(navigate).toHaveBeenCalledWith('/login', 'root', 'replace')
  })

  test('one message at a time, and nothing blank', async () => {
    let answer!: (m: BoardMessage) => void
    vi.mocked(chatService.sendMessage).mockReturnValue(new Promise((r) => (answer = r)))
    const wrapper = await mountPage()
    await openChat(wrapper)
    const chatPanel = wrapper.findComponent(BoardChat)

    chatPanel.vm.$emit('send', 'opponents')
    await flushPromises()
    expect(chatService.sendMessage).not.toHaveBeenCalled()

    await wrapper.get('.chat-input').setValue('Hi')
    chatPanel.vm.$emit('send', 'opponents')
    chatPanel.vm.$emit('send', 'opponents')
    await flushPromises()
    expect(chatService.sendMessage).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.chat-input').attributes('disabled')).toBeDefined()

    answer(message(6, { user_id: 3, seat: 'S' }))
    await flushPromises()
    expect(wrapper.get('.chat-input').attributes('disabled')).toBeUndefined()
  })

  test('Close, and the sheet pulled down, close it; so does leaving the page', async () => {
    const wrapper = await mountPage()
    const chat = useChatStore()

    await openChat(wrapper)
    await wrapper.get('.chat-close').trigger('click')
    expect(chat.open).toBe(false)

    await openChat(wrapper)
    await wrapper.get('.chat-sheet').trigger('did-dismiss')
    expect(chat.open).toBe(false)

    await openChat(wrapper)
    await leaveView()
    expect(chat.open).toBe(false)
    // The sheet's choice is the phone's alone: beside the table it is open.
    expect(localStorage.getItem(CHAT_OPEN_KEY)).toBeNull()
  })

  test('a sheet left open is back open when the player comes back', async () => {
    const wrapper = await mountPage()
    const chat = useChatStore()
    await openChat(wrapper)

    await leaveView()
    expect(chat.open).toBe(false)
    expect(wrapper.find('.board-chat').exists()).toBe(false)

    await returnToView()
    expect(chat.open).toBe(true)
    expect(wrapper.find('.chat-sheet .board-chat').exists()).toBe(true)
  })

  test('on a phone it starts closed, whatever was chosen beside the table', async () => {
    localStorage.setItem(CHAT_OPEN_KEY, '1')
    const wrapper = await mountPage()

    expect(useChatStore().open).toBe(false)
    expect(wrapper.find('.board-chat').exists()).toBe(false)
  })
})

describe('beside the table on a wide screen', () => {
  beforeEach(wide)

  test('on show without pressing anything, the table making room for it', async () => {
    const wrapper = await mountPage(auction(), [message(1)])

    expect(useChatStore().open).toBe(true)
    expect(wrapper.find('.chat-sheet').exists()).toBe(false)
    expect(wrapper.get('.chat-side').find('.board-chat').exists()).toBe(true)
    expect(wrapper.get('.chat-side').attributes()).toHaveProperty('data-right-edge')
    expect(wrapper.get('.play').classes()).toContain('with-chat-side')
    expect(wrapper.get('.play').classes()).not.toContain('with-chat-sheet')
    expect(wrapper.get('.chat-toggle').attributes('aria-expanded')).toBe('true')
    // On show: nothing counts as unread.
    expect(wrapper.find('.chat-badge').exists()).toBe(false)
  })

  test('but not before the first deal: there is no chat yet', async () => {
    const wrapper = await mountPage(auction({ phase: 'waiting', playing_id: null, auction: null, players: null }))

    expect(useChatStore().open).toBe(false)
    expect(wrapper.find('.chat-side').exists()).toBe(false)
  })

  test('Chat collapses it and brings it back, and the choice is kept', async () => {
    const wrapper = await mountPage()

    await openChat(wrapper)
    expect(wrapper.find('.chat-side').exists()).toBe(false)
    expect(wrapper.get('.play').classes()).not.toContain('with-chat-side')
    expect(useChatStore().open).toBe(false)
    expect(localStorage.getItem(CHAT_OPEN_KEY)).toBe('0')

    await openChat(wrapper)
    expect(wrapper.get('.chat-side').find('.board-chat').exists()).toBe(true)
    expect(wrapper.get('.play').classes()).toContain('with-chat-side')
    expect(localStorage.getItem(CHAT_OPEN_KEY)).toBe('1')
  })

  test('Close collapses it too, for good', async () => {
    const wrapper = await mountPage()

    await wrapper.get('.chat-close').trigger('click')
    expect(wrapper.find('.chat-side').exists()).toBe(false)
    expect(localStorage.getItem(CHAT_OPEN_KEY)).toBe('0')
  })

  test('collapsed before, it stays collapsed, and messages count as unread', async () => {
    localStorage.setItem(CHAT_OPEN_KEY, '0')
    const wrapper = await mountPage(auction(), [message(1)])

    expect(wrapper.find('.chat-side').exists()).toBe(false)
    expect(wrapper.get('.chat-badge').text()).toBe('1')

    useGameStore().applyBoardMessage({ table_id: 5, playing_id: 42, message: message(2) })
    await flushPromises()
    expect(wrapper.get('.chat-badge').text()).toBe('2')
  })

  test('the next board keeps whichever was chosen', async () => {
    const wrapper = await mountPage()
    await openChat(wrapper)

    useGameStore().adopt(5, auction({ playing_id: 43, board: { id: 8, number: 8, dealer: 'S', vulnerable: '' } }))
    await flushPromises()
    expect(wrapper.find('.chat-side').exists()).toBe(false)
  })

  test('leaving the view hides it, coming back shows it as it was left', async () => {
    const wrapper = await mountPage()
    const chat = useChatStore()

    await leaveView()
    expect(chat.open).toBe(false)
    expect(wrapper.find('.chat-side').exists()).toBe(false)
    await returnToView()
    expect(chat.open).toBe(true)
    expect(wrapper.find('.chat-side').exists()).toBe(true)

    await openChat(wrapper)
    await leaveView()
    await returnToView()
    expect(chat.open).toBe(false)
    expect(wrapper.find('.chat-side').exists()).toBe(false)
  })

  test('closed under it by anything else, it shows again while the choice is open', async () => {
    const wrapper = await mountPage()
    const chat = useChatStore()

    chat.setOpen(false)
    await flushPromises()
    expect(chat.open).toBe(true)
    expect(wrapper.find('.chat-side').exists()).toBe(true)
  })

  test('Ask in the chat brings a collapsed chat back', async () => {
    localStorage.setItem(CHAT_OPEN_KEY, '0')
    const wrapper = await mountPage()

    wrapper.findComponent(AuctionHistory).vm.$emit('chat', 0)
    await flushPromises()
    expect(wrapper.get('.chat-side .chat-about').text()).toContain('About 1♥:')
    expect(localStorage.getItem(CHAT_OPEN_KEY)).toBe('1')
  })
})

describe('Ask in the chat', () => {
  test('opens the chat with the opponent’s call attached, and the question goes with it', async () => {
    vi.mocked(chatService.sendMessage).mockResolvedValue(
      message(7, { seat: 'S', user_id: 3, call_index: 0, body: 'What does it show?' }),
    )
    const wrapper = await mountPage()

    wrapper.findComponent(AuctionHistory).vm.$emit('chat', 0)
    await flushPromises()

    expect(wrapper.get('.chat-about').text()).toContain('About 1♥:')
    expect(wrapper.get('.chat-to-note').text()).toBe('Only the opponents see this, not your partner.')
    await write(wrapper, 'What does it show?')
    expect(chatService.sendMessage).toHaveBeenCalledWith(5, {
      body: 'What does it show?',
      to: 'opponents',
      call_index: 0,
    })
    expect(wrapper.find('.chat-about').exists()).toBe(false)
  })

  test('the call can be taken off before sending', async () => {
    const wrapper = await mountPage()
    wrapper.findComponent(AuctionHistory).vm.$emit('chat', 0)
    await flushPromises()

    await wrapper.get('.chat-about-clear').trigger('click')
    expect(wrapper.find('.chat-about').exists()).toBe(false)
  })

  test('from the auction below the hand during the play too', async () => {
    const wrapper = await mountPage(
      auction({
        phase: 'play',
        turn: 'W',
        acting_user_id: 4,
        auction: [
          { seat: 'E', bid: oneHeart },
          { seat: 'S', bid: pass },
          { seat: 'W', bid: pass },
          { seat: 'N', bid: pass },
        ],
        contract: { bid: oneHeart, doubled: 0, declarer: 'E', dummy: 'W' },
        tricks: [],
        current_trick: [],
        tricks_won: { ns: 0, ew: 0 },
      }),
    )

    wrapper.findComponent(AuctionHistory).vm.$emit('chat', 0)
    await flushPromises()
    expect(useChatStore().about).toBe(0)
    expect(wrapper.find('.board-chat').exists()).toBe(true)
  })
})
