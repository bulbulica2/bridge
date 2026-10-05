import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import AuctionHistory from '@/components/AuctionHistory.vue'
import BoardChat from '@/components/BoardChat.vue'
import BoardReview from '@/components/BoardReview.vue'
import ChatMessageList from '@/components/ChatMessageList.vue'
import { useMediaQuery } from '@/composables/useMediaQuery'
import * as chatService from '@/services/chat'
import type { BoardMessage, BoardMessageSentEvent } from '@/services/chat'
import * as echo from '@/services/echo'
import type { AuctionCall, Bid, Playing } from '@/services/game'
import type { PlayingReview } from '@/services/history'
import type { Seat } from '@/services/tables'
import type { PublicUser } from '@/services/users'
import { useAuthStore } from '@/stores/auth'
import { CHAT_SEEN_KEY, useChatStore } from '@/stores/chat'
import { useGameStore } from '@/stores/game'
import {
  aboutCall,
  asksAboutMyCall,
  chatLines,
  chatQuestionText,
  chatRecipients,
  chatTime,
  mergeMessages,
  senderName,
} from '@/utils/chat'
import { CHAT_MAX } from '@/utils/limits'
import { showToast } from '@/utils/toast'

vi.mock('@/services/chat', () => ({ getMessages: vi.fn(), sendMessage: vi.fn() }))
vi.mock('@/services/game', () => ({ getPlaying: vi.fn() }))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))
vi.mock('@/utils/toast', () => ({ showToast: vi.fn() }))

// The board chat (bridge_backend docs/API.md, Chat): the store, the game
// store's part (the user channel's BoardMessageSent), the helpers, the panel
// and the finished board's chat in the review. The play page's side is in
// chatAtTable.spec.ts.

function user(id: number, username: string): PublicUser {
  return { id, name: username.toUpperCase(), username, description: null, is_robot: false }
}

const PLAYERS: Record<Seat, PublicUser> = { N: user(1, 'ann'), E: user(2, 'bob'), S: user(3, 'cy'), W: user(4, 'di') }

const bid = (id: number, call: string, level: number | null = null): Bid => ({
  id,
  call,
  level,
  strain: level ? (call.slice(1) as Bid['strain']) : null,
  special: level === null,
})
const ONE_NT = bid(10, '1NT', 1)
const TWO_HEARTS = bid(13, '2H', 2)
const PASS = bid(1, 'P')

// North opens 1NT, East passes, South (the user, id 3) transfers with 2♥.
const AUCTION: AuctionCall[] = [
  { seat: 'N', bid: ONE_NT },
  { seat: 'E', bid: PASS },
  { seat: 'S', bid: TWO_HEARTS },
]

function message(id: number, overrides: Partial<BoardMessage> = {}): BoardMessage {
  return {
    id,
    seat: 'E',
    user_id: 2,
    to: 'opponents',
    call_index: null,
    body: `Message ${id}`,
    created_at: new Date(2026, 9, 5, 12, id).toISOString(),
    ...overrides,
  }
}

function sent(msg: BoardMessage, playingId = 42, tableId = 5): BoardMessageSentEvent {
  return { table_id: tableId, playing_id: playingId, message: msg }
}

function playing(overrides: Partial<Playing> = {}): Playing {
  return {
    phase: 'auction',
    playing_id: 42,
    set: null,
    board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
    players: PLAYERS,
    turn: 'W',
    acting_user_id: 4,
    auction: AUCTION,
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
})

describe('chat helpers', () => {
  test('who a message may go to, by phase', () => {
    expect(chatRecipients('auction')).toEqual(['table', 'opponents'])
    expect(chatRecipients('play')).toEqual(['table', 'opponents'])
    expect(chatRecipients('finished')).toEqual(['table', 'opponents'])
    expect(chatRecipients('waiting')).toEqual([])
    expect(chatRecipients(null)).toEqual([])
  })

  test('two lists merge into one, each message once, oldest first', () => {
    const merged = mergeMessages([message(3), message(1)], [message(2), { ...message(3), body: 'again' }])
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3])
    expect(merged[2].body).toBe('again')
  })

  test('the local time a message was sent', () => {
    expect(chatTime(new Date(2026, 9, 5, 9, 7).toISOString())).toBe('09:07')
    expect(chatTime('not a date')).toBe('')
  })

  test('who wrote it: you, their username, or the seat', () => {
    expect(senderName(message(1, { user_id: 3, seat: 'S' }), PLAYERS, 3)).toBe('You')
    expect(senderName(message(1), PLAYERS, 3)).toBe('bob')
    expect(senderName(message(1), { E: null }, null)).toBe('East')
    expect(senderName(message(1), null, 3)).toBe('East')
  })

  test('the call a message is about', () => {
    expect(aboutCall(message(1, { call_index: 2 }), AUCTION)).toBe(AUCTION[2])
    expect(aboutCall(message(1, { call_index: 9 }), AUCTION)).toBeNull()
    expect(aboutCall(message(1, { call_index: 0 }), null)).toBeNull()
    expect(aboutCall(message(1), AUCTION)).toBeNull()
  })

  test('an opponent asking about one of our calls', () => {
    const asks = message(1, { call_index: 2 })
    expect(asksAboutMyCall(asks, AUCTION, 'S', 3)).toBe(true)
    // Our own message, partner's, a call that isn't ours, no call at all.
    expect(asksAboutMyCall({ ...asks, user_id: 3, seat: 'S' }, AUCTION, 'S', 3)).toBe(false)
    expect(asksAboutMyCall({ ...asks, user_id: 1, seat: 'N' }, AUCTION, 'S', 3)).toBe(false)
    expect(asksAboutMyCall({ ...asks, call_index: 0 }, AUCTION, 'S', 3)).toBe(false)
    expect(asksAboutMyCall(message(1), AUCTION, 'S', 3)).toBe(false)
    expect(chatQuestionText({ ...asks, body: 'Transfer?' }, AUCTION[2])).toBe('East asks about your 2♥: Transfer?')
  })

  test('the chat as export lines', () => {
    expect(
      chatLines(
        [message(5, { call_index: 2, body: 'What is it?' }), message(6, { seat: 'S', to: 'table', created_at: '' })],
        { E: PLAYERS.E, S: null },
        AUCTION,
      ),
    ).toEqual(['12:05 East (bob) to opponents, about 2♥: What is it?', 'South to table: Message 6'])
    expect(chatLines([message(1)], null, null)).toEqual(['12:01 East to opponents: Message 1'])
  })
})

describe('chat store', () => {
  test('load reads the board’s chat and keeps what the channel brought meanwhile', async () => {
    const answer = deferred<chatService.BoardChat>()
    vi.mocked(chatService.getMessages).mockReturnValue(answer.promise)
    const chat = useChatStore()

    const first = chat.load(5)
    // One request per table at a time.
    const second = chat.load(5)
    expect(chatService.getMessages).toHaveBeenCalledTimes(1)
    chat.receive(sent(message(3)))
    answer.resolve({ playing_id: 42, messages: [message(1), message(2)] })
    await Promise.all([first, second])

    expect(chat.tableId).toBe(5)
    expect(chat.playingId).toBe(42)
    expect(chat.messages.map((m) => m.id)).toEqual([1, 2, 3])
  })

  test('another table starts again, and an answer for a table left is dropped', async () => {
    const answer = deferred<chatService.BoardChat>()
    vi.mocked(chatService.getMessages).mockReturnValueOnce(answer.promise)
    vi.mocked(chatService.getMessages).mockResolvedValueOnce({ playing_id: 50, messages: [message(9)] })
    const chat = useChatStore()

    const stale = chat.load(5)
    await chat.load(6)
    answer.resolve({ playing_id: 42, messages: [message(1)] })
    await stale

    expect(chat.tableId).toBe(6)
    expect(chat.messages.map((m) => m.id)).toEqual([9])
  })

  test('a table with no board has no chat, and an older board’s answer is dropped', async () => {
    const chat = useChatStore()
    vi.mocked(chatService.getMessages).mockResolvedValueOnce({ playing_id: null, messages: [] })
    await chat.load(5)
    expect(chat.playingId).toBeNull()

    chat.receive(sent(message(5), 43))
    vi.mocked(chatService.getMessages).mockResolvedValueOnce({ playing_id: 42, messages: [message(1)] })
    await chat.load(5)
    expect(chat.playingId).toBe(43)
    expect(chat.messages.map((m) => m.id)).toEqual([5])
  })

  test('follow: the first sight reads, a new board empties it, a finished board is read once more', async () => {
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: 42, messages: [message(1)] })
    const chat = useChatStore()

    chat.follow(5, 42, 'auction')
    await flushPromises()
    expect(chat.messages).toHaveLength(1)

    chat.follow(5, 42, 'play')
    chat.follow(5, null, 'waiting')
    expect(chatService.getMessages).toHaveBeenCalledTimes(1)

    vi.mocked(chatService.getMessages).mockResolvedValue({
      playing_id: 42,
      messages: [message(1), message(2, { seat: 'N', user_id: 1 })],
    })
    chat.follow(5, 42, 'finished')
    chat.follow(5, 42, 'finished')
    await flushPromises()
    expect(chatService.getMessages).toHaveBeenCalledTimes(2)
    expect(chat.messages).toHaveLength(2)

    chat.askAbout(1)
    chat.follow(5, 43, 'auction')
    expect(chat.playingId).toBe(43)
    expect(chat.messages).toEqual([])
    expect(chat.about).toBeNull()
    expect(chatService.getMessages).toHaveBeenCalledTimes(2)
  })

  test('follow: entering on a finished board reads it once, and a failed read is quiet', async () => {
    vi.mocked(chatService.getMessages).mockRejectedValue(new Error('down'))
    const chat = useChatStore()

    chat.follow(5, 42, 'finished')
    await flushPromises()
    chat.follow(5, 42, 'finished')
    await flushPromises()

    expect(chatService.getMessages).toHaveBeenCalledTimes(1)
    expect(chat.tableId).toBe(5)
  })

  test('receive: only the table followed, its board or a newer one, each message once', async () => {
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: 42, messages: [message(1)] })
    const chat = useChatStore()
    await chat.load(5)

    chat.receive(sent(message(2), 42, 6))
    chat.receive(sent(message(3), 41))
    chat.receive(sent(message(1)))
    expect(chat.messages.map((m) => m.id)).toEqual([1])

    chat.receive(sent(message(4), 43))
    expect(chat.playingId).toBe(43)
    expect(chat.messages.map((m) => m.id)).toEqual([4])
  })

  test('unread: the others’ messages since the user last looked, kept across a reload', async () => {
    vi.mocked(chatService.getMessages).mockResolvedValue({
      playing_id: 42,
      messages: [message(1), message(2, { seat: 'S', user_id: 3 })],
    })
    const chat = useChatStore()
    await chat.load(5)
    expect(chat.unread).toBe(1)

    chat.setOpen(true)
    expect(chat.unread).toBe(0)
    expect(localStorage.getItem(CHAT_SEEN_KEY)).toBe('2')

    // While open, what arrives is read at once; closing counts it as seen.
    chat.receive(sent(message(3)))
    chat.setOpen(false)
    expect(chat.unread).toBe(0)
    chat.receive(sent(message(4)))
    expect(chat.unread).toBe(1)

    setActivePinia(createPinia())
    useAuthStore().user = { id: 3, name: 'Cy', username: 'cy', email: 'cy@example.com' }
    const again = useChatStore()
    await again.load(5)
    expect(again.unread).toBe(0)
  })

  test('a load while the panel is open is read at once', async () => {
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: 42, messages: [message(7)] })
    const chat = useChatStore()
    chat.setOpen(true)
    await chat.load(5)
    chat.setOpen(false)
    expect(chat.unread).toBe(0)
  })

  test('storage that refuses only forgets what was seen', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: 42, messages: [message(1)] })
    const chat = useChatStore()
    await chat.load(5)
    expect(chat.unread).toBe(1)
    expect(() => chat.setOpen(true)).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })

  test('send: our message about the call attached, into the chat', async () => {
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: 42, messages: [] })
    const mine = message(8, { seat: 'S', user_id: 3, call_index: 0 })
    vi.mocked(chatService.sendMessage).mockResolvedValue(mine)
    const chat = useChatStore()
    await chat.load(5)
    chat.askAbout(0)
    expect(chat.open).toBe(true)

    await expect(chat.send('What is 1NT?', 'opponents')).resolves.toEqual(mine)

    expect(chatService.sendMessage).toHaveBeenCalledWith(5, { body: 'What is 1NT?', to: 'opponents', call_index: 0 })
    expect(chat.messages).toEqual([mine])
    expect(chat.about).toBeNull()
  })

  test('send keeps a call attached meanwhile, and a board gone meanwhile keeps nothing', async () => {
    const answer = deferred<BoardMessage>()
    vi.mocked(chatService.sendMessage).mockReturnValue(answer.promise)
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: 42, messages: [] })
    const chat = useChatStore()
    await chat.load(5)
    chat.askAbout(0)

    const sending = chat.send('Hi', 'opponents')
    chat.askAbout(2)
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: null, messages: [] })
    chat.clear()
    chat.tableId = 5
    chat.about = 2
    answer.resolve(message(9))
    await sending

    expect(chat.messages).toEqual([])
    expect(chat.about).toBe(2)
  })

  test('send without a chat is refused', async () => {
    await expect(useChatStore().send('Hi', 'table')).rejects.toThrow('No chat is loaded.')
  })

  test('closing forgets the call attached; clear forgets everything', async () => {
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: 42, messages: [message(1)] })
    const chat = useChatStore()
    await chat.load(5)
    chat.askAbout(2)
    chat.setOpen(false)
    expect(chat.about).toBeNull()

    chat.setOpen(true)
    chat.clear()
    expect(chat.tableId).toBeNull()
    expect(chat.playingId).toBeNull()
    expect(chat.messages).toEqual([])
    expect(chat.open).toBe(false)
  })

  test('after a reconnect the table’s chat is read again', async () => {
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: 42, messages: [] })
    const chat = useChatStore()
    const [reconnected] = vi.mocked(echo.onReconnect).mock.calls[0]

    reconnected()
    expect(chatService.getMessages).not.toHaveBeenCalled()

    await chat.load(5)
    vi.mocked(chatService.getMessages).mockRejectedValue(new Error('down'))
    reconnected()
    await flushPromises()
    expect(chatService.getMessages).toHaveBeenCalledTimes(2)
  })
})

describe('the chat on the user channel', () => {
  async function seated() {
    vi.mocked(chatService.getMessages).mockResolvedValue({ playing_id: 42, messages: [] })
    const game = useGameStore()
    game.adopt(5, playing())
    await useChatStore().load(5)
    return game
  }

  test('watchUser hands BoardMessageSent to the chat', async () => {
    useGameStore().watchUser(3)
    await seated()
    const onMessage = vi.mocked(echo.listenToUser).mock.calls[0][6]

    onMessage(sent(message(1)))
    expect(useChatStore().messages.map((m) => m.id)).toEqual([1])
  })

  test('an opponent asking about our call is told at the top, once, and not with the chat open', async () => {
    const game = await seated()
    const chat = useChatStore()

    game.applyBoardMessage(sent(message(1, { call_index: 2, body: 'Transfer?' })))
    expect(showToast).toHaveBeenCalledWith('East asks about your 2♥: Transfer?', 'warning', 'top')

    // The Ask button's question comes twice (its event and its chat line).
    game.applyCallQuestioned({ table_id: 5, playing_id: 42, index: 2, asked_by: 'E' })
    expect(showToast).toHaveBeenCalledTimes(1)

    chat.setOpen(true)
    game.applyBoardMessage(sent(message(2, { seat: 'W', user_id: 4, call_index: 2 })))
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(chat.messages).toHaveLength(2)
  })

  test('nothing is told for partner, a plain message, or another board', async () => {
    const game = await seated()

    game.applyBoardMessage(sent(message(1, { seat: 'N', user_id: 1, call_index: 2 })))
    game.applyBoardMessage(sent(message(2)))
    game.applyBoardMessage(sent(message(3, { call_index: 2 }), 41))
    expect(showToast).not.toHaveBeenCalled()
  })

  test('the same question is told again after a while', async () => {
    vi.useFakeTimers()
    try {
      const game = await seated()
      game.applyBoardMessage(sent(message(1, { call_index: 2 })))
      vi.advanceTimersByTime(11_000)
      game.applyBoardMessage(sent(message(2, { call_index: 2 })))
      expect(showToast).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  test('leaving the board (game.clear) clears the chat', async () => {
    const game = await seated()
    game.clear()
    expect(useChatStore().tableId).toBeNull()
  })
})

describe('ChatMessageList', () => {
  test('each message: who, their seat, who reads it, when, the call, the text as typed', () => {
    const wrapper = mount(ChatMessageList, {
      props: {
        messages: [
          message(1, { call_index: 2, body: '<b>What</b> is it? https://x.example' }),
          message(2, { seat: 'S', user_id: 3, to: 'table', body: 'Good game' }),
        ],
        players: PLAYERS,
        auction: AUCTION,
        me: 3,
      },
    })
    const [theirs, mine] = wrapper.findAll('.chat-message')

    expect(theirs.get('.chat-sender').text()).toBe('bob')
    expect(theirs.get('.chat-seat').text()).toBe('East')
    expect(theirs.get('.chat-to').text()).toBe('to opponents')
    expect(theirs.get('.chat-time').text()).toBe('12:01')
    expect(theirs.get('.chat-call').text()).toBe('2♥')
    // Plain text: no markup, no link.
    expect(theirs.find('b').exists()).toBe(false)
    expect(theirs.find('a').exists()).toBe(false)
    expect(theirs.get('.chat-body').text()).toContain('<b>What</b> is it? https://x.example')

    expect(mine.classes()).toEqual(expect.arrayContaining(['mine', 'to-table']))
    expect(mine.get('.chat-sender').text()).toBe('You')
    expect(mine.find('.chat-call').exists()).toBe(false)
  })

  test('an empty chat says so', () => {
    expect(mount(ChatMessageList, { props: { messages: [] } }).get('.chat-empty').text()).toBe('No messages yet.')
  })
})

describe('BoardChat', () => {
  function mountChat(props: Partial<InstanceType<typeof BoardChat>['$props']> = {}) {
    return mount(BoardChat, {
      props: { messages: [message(1)], players: PLAYERS, auction: AUCTION, phase: 'auction', me: 3, draft: '', ...props },
      attachTo: document.body,
    })
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('mid-board it goes to the table or the opponents, the table first', async () => {
    const wrapper = mountChat({ draft: 'Good luck' })
    const options = wrapper.findAll('.chat-to-option')

    expect(options.map((o) => o.text())).toEqual(['Table', 'Opponents'])
    expect(options[0].attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.chat-to-note').text()).toBe('Everyone at the table sees this.')
    expect(wrapper.get('.chat-message').text()).toContain('Message 1')
    await wrapper.get('.chat-send').trigger('click')
    expect(wrapper.emitted('send')).toEqual([['table']])

    await options[1].trigger('click')
    expect(options[1].attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.chat-to-note').text()).toBe('Only the opponents see this, not your partner.')
    await wrapper.get('.chat-send').trigger('click')
    expect(wrapper.emitted('send')![1]).toEqual(['opponents'])

    // The pick holds as the board goes on, and into the next one.
    await wrapper.setProps({ phase: 'play' })
    await wrapper.setProps({ phase: 'finished' })
    await wrapper.setProps({ phase: 'auction' })
    await wrapper.get('.chat-send').trigger('click')
    expect(wrapper.emitted('send')![2]).toEqual(['opponents'])
  })

  test('between boards the same, the table first', async () => {
    const wrapper = mountChat({ phase: 'finished', draft: 'Thanks' })
    const options = wrapper.findAll('.chat-to-option')

    expect(options.map((o) => o.text())).toEqual(['Table', 'Opponents'])
    expect(options[0].attributes('aria-pressed')).toBe('true')
    await wrapper.get('.chat-send').trigger('click')
    expect(wrapper.emitted('send')).toEqual([['table']])
  })

  test('no chat before the first deal; the first deal opens it on the table', async () => {
    const wrapper = mountChat({ phase: 'waiting', draft: 'Hi' })
    expect(wrapper.find('.chat-to-option').exists()).toBe(false)

    await wrapper.setProps({ phase: 'auction' })
    expect(wrapper.findAll('.chat-to-option')[0].attributes('aria-pressed')).toBe('true')
    await wrapper.get('.chat-send').trigger('click')
    expect(wrapper.emitted('send')).toEqual([['table']])
  })

  test('the empty chat invites both', () => {
    const wrapper = mountChat({ messages: [] })
    expect(wrapper.get('.chat-empty').text()).toBe(
      'No messages yet. Say hello to the table, or ask the opponents about their calls.',
    )
  })

  test('before the first deal there is nothing to write on', () => {
    const wrapper = mountChat({ phase: 'waiting' })
    expect(wrapper.get('.chat-closed').text()).toBe('The chat opens with the first deal.')
    expect(wrapper.find('.chat-input').exists()).toBe(false)
  })

  test('typing, Enter to send, Shift+Enter for a new line, and nothing to send when blank or busy', async () => {
    const wrapper = mountChat()
    const input = wrapper.get('.chat-input')

    expect(input.attributes('maxlength')).toBe(String(CHAT_MAX))
    await input.setValue('Hello')
    expect(wrapper.emitted('update:draft')).toEqual([['Hello']])

    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')).toBeUndefined()

    await wrapper.setProps({ draft: 'Hello' })
    expect(wrapper.get('.chat-count').text()).toBe(`5/${CHAT_MAX}`)
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('send')).toBeUndefined()
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')).toEqual([['table']])

    await wrapper.setProps({ busy: true })
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  test('a call attached shows as “About 2♥:”, asks the opponents, focuses the input and can be taken off', async () => {
    const wrapper = mountChat({ draft: 'What is it?' })
    expect(wrapper.find('.chat-about').exists()).toBe(false)
    expect(wrapper.get('.chat-to-note').text()).toBe('Everyone at the table sees this.')

    await wrapper.setProps({ about: 2 })
    await flushPromises()
    expect(wrapper.get('.chat-about').text()).toContain('About 2♥:')
    expect(document.activeElement).toBe(wrapper.get('.chat-input').element)
    expect(wrapper.findAll('.chat-to-option')[1].attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.chat-to-note').text()).toBe('Only the opponents see this, not your partner.')
    await wrapper.get('.chat-send').trigger('click')
    expect(wrapper.emitted('send')).toEqual([['opponents']])

    await wrapper.get('.chat-about-clear').trigger('click')
    expect(wrapper.emitted('clear-about')).toHaveLength(1)

    await wrapper.setProps({ about: 9 })
    expect(wrapper.find('.chat-about').exists()).toBe(false)
  })

  test('the newest message comes into view, and Close closes', async () => {
    const wrapper = mountChat()
    const scroller = wrapper.get('.chat-scroll').element
    Object.defineProperty(scroller, 'scrollHeight', { value: 300 })

    await wrapper.setProps({ messages: [message(1), message(2)] })
    await flushPromises()
    expect(scroller.scrollTop).toBe(300)

    await wrapper.get('.chat-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('Ask in the chat', () => {
  test('an opponent’s call offers it while the board is on, and names the call', async () => {
    const wrapper = mount(AuctionHistory, {
      props: {
        auction: AUCTION,
        board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
        mySeat: 'S',
        live: true,
      },
    })
    // Only East's pass is the opponents' (North is partner, 2♥ ours).
    const buttons = wrapper.findAll('.call-button')
    expect(buttons.map((b) => b.text())).toEqual(['Pass'])

    await buttons[0].trigger('click')
    await wrapper.get('.popup-action.ask-in-chat').trigger('click')

    expect(wrapper.emitted('chat')).toEqual([[1]])
    expect(wrapper.find('.call-popup').exists()).toBe(false)
  })

  test('not once the board is over', async () => {
    const wrapper = mount(AuctionHistory, {
      props: {
        auction: [AUCTION[0], { ...AUCTION[1], alert: { explanation: 'Nothing to say' } }, AUCTION[2]],
        board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
        mySeat: 'S',
      },
    })
    await wrapper.get('.call-button').trigger('click')
    expect(wrapper.get('.alert-text').text()).toBe('Nothing to say')
    expect(wrapper.find('.ask-in-chat').exists()).toBe(false)
  })
})

describe('useMediaQuery', () => {
  const Probe = defineComponent({
    setup() {
      const wide = useMediaQuery('(min-width: 1100px)')
      return () => h('p', wide.value ? 'wide' : 'narrow')
    },
  })

  afterEach(() => {
    // jsdom has no matchMedia of its own.
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  test('narrow where matchMedia is missing', () => {
    expect(mount(Probe).text()).toBe('narrow')
  })

  test('follows the query as the window changes, until unmounted', async () => {
    let listener: ((event: MediaQueryListEvent) => void) | null = null
    const list = {
      matches: true,
      addEventListener: vi.fn((_: string, l: (event: MediaQueryListEvent) => void) => (listener = l)),
      removeEventListener: vi.fn(),
    }
    window.matchMedia = vi.fn(() => list as unknown as MediaQueryList)

    const wrapper = mount(Probe)
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 1100px)')
    expect(wrapper.text()).toBe('wide')

    listener!({ matches: false } as MediaQueryListEvent)
    await flushPromises()
    expect(wrapper.text()).toBe('narrow')

    wrapper.unmount()
    expect(list.removeEventListener).toHaveBeenCalledWith('change', listener)
  })
})

describe('the review’s chat', () => {
  function review(messages?: BoardMessage[]): PlayingReview {
    return {
      phase: 'finished',
      playing_id: 42,
      board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
      players: PLAYERS,
      turn: null,
      acting_user_id: null,
      auction: [...AUCTION, { seat: 'W', bid: PASS }, { seat: 'N', bid: bid(15, '2S', 2) }],
      contract: null,
      tricks: null,
      current_trick: null,
      tricks_won: null,
      dummy_hand: null,
      claim: null,
      result: null,
      deal: null,
      messages,
    }
  }

  test('the whole chat under the auction, partner’s opponents-only messages too', () => {
    const wrapper = mount(BoardReview, {
      props: {
        review: review([
          message(1, { call_index: 2, body: 'Transfer?' }),
          message(2, { seat: 'N', user_id: 1, body: 'Yes, to spades.' }),
        ]),
      },
    })
    const chat = wrapper.get('.review-chat')

    expect(chat.get('.review-chat-title').text()).toBe('Chat')
    expect(chat.findAll('.chat-message')).toHaveLength(2)
    expect(chat.text()).toContain('Yes, to spades.')
    expect(chat.get('.chat-call').text()).toBe('2♥')
  })

  test('no chat section when nobody wrote', () => {
    expect(mount(BoardReview, { props: { review: review([]) } }).find('.review-chat').exists()).toBe(false)
    expect(mount(BoardReview, { props: { review: review() } }).find('.review-chat').exists()).toBe(false)
  })
})
