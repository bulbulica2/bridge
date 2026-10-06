import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as chatService from '@/services/chat';
import type { BoardMessage, BoardMessageSentEvent, ChatTo } from '@/services/chat';
import type { Phase } from '@/services/game';
import { onReconnect } from '@/services/echo';
import { useAuthStore } from '@/stores/auth';
import { mergeMessages } from '@/utils/chat';

// The last message id the user has seen in the chat, kept per browser so a
// reload doesn't show the board's whole chat as unread again. Message ids
// only grow, across boards too, so one number covers every board.
export const CHAT_SEEN_KEY = 'bridge.chatSeen';

function readSeen(): number {
  try {
    return Number(localStorage.getItem(CHAT_SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeSeen(id: number) {
  try {
    localStorage.setItem(CHAT_SEEN_KEY, String(id));
  } catch {
    // Not kept: after a reload the board's chat shows as unread again.
  }
}

// Whether the player wants the chat on show beside the table (a wide
// screen's; a phone's sheet starts closed every time): open until they
// collapse it, and kept per browser so the next board, page or reload
// shows it as they left it.
export const CHAT_OPEN_KEY = 'bridge.chatOpen';

function readKeepOpen(): boolean {
  try {
    return localStorage.getItem(CHAT_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeKeepOpen(value: boolean) {
  try {
    localStorage.setItem(CHAT_OPEN_KEY, value ? '1' : '0');
  } catch {
    // Not kept: after a reload the chat is on show again.
  }
}

// The chat of the board the play page shows (bridge_backend docs/API.md,
// Chat): its messages the user may read, whether the panel is open, and the
// call a message about to be written is about.
export const useChatStore = defineStore('chat', () => {
  const tableId = ref<number | null>(null);
  // The board the messages belong to: null before the first deal.
  const playingId = ref<number | null>(null);
  const messages = ref<BoardMessage[]>([]);
  // On show now (the play page sets it): unread counts only while it isn't.
  const open = ref(false);
  // The player's choice beside the table (CHAT_OPEN_KEY).
  const keepOpen = ref(readKeepOpen());
  // The call of the auction (its index) the next message is about: Ask in
  // a call's pop-up attaches it.
  const about = ref<number | null>(null);
  const seenUpTo = ref(readSeen());
  // The finished board whose whole chat has been read: partner's earlier
  // messages aren't pushed when it ends, so it is read once then.
  let finishedRead: number | null = null;
  let request: { id: number; promise: Promise<void> } | null = null;

  const auth = useAuthStore();

  // The others' messages since the user last looked (never while open).
  const unread = computed(() =>
    open.value
      ? 0
      : messages.value.filter((m) => m.id > seenUpTo.value && m.user_id !== auth.user?.id)
          .length,
  );

  function markRead() {
    const last = messages.value.at(-1)?.id ?? 0;
    if (last > seenUpTo.value) {
      seenUpTo.value = last;
      writeSeen(last);
    }
  }

  // A board `id` the chat is on now: a newer one starts an empty chat (and
  // forgets the call a draft was about); an older one is left alone.
  function onBoard(id: number | null): boolean {
    if (id === playingId.value) {
      return true;
    }
    if (id !== null && playingId.value !== null && id < playingId.value) {
      return false;
    }
    playingId.value = id;
    messages.value = [];
    about.value = null;
    return true;
  }

  // GET /tables/{id}/messages, merged with what the channel has brought
  // meanwhile. One request per table at a time.
  function load(id: number): Promise<void> {
    if (request?.id === id) {
      return request.promise;
    }
    if (tableId.value !== id) {
      reset();
      tableId.value = id;
    }
    const promise = chatService
      .getMessages(id)
      .then((chat) => {
        if (tableId.value === id && onBoard(chat.playing_id)) {
          messages.value = mergeMessages(messages.value, chat.messages);
          if (open.value) {
            markRead();
          }
        }
      })
      .finally(() => {
        if (request?.promise === promise) {
          request = null;
        }
      });
    request = { id, promise };
    return promise;
  }

  // The play page's board, whenever it changes: the first sight of a table
  // reads its chat; a new board dealt starts an empty one (the channel
  // brings what is written on it); a board just finished is read again,
  // since its every message is public now. Errors are left to the next
  // read: the chat is never what keeps the board from showing.
  function follow(id: number, boardId: number | null, phase: Phase | null) {
    const quiet = () => load(id).catch(() => undefined);
    if (tableId.value !== id) {
      quiet();
      finishedRead = phase === 'finished' ? boardId : null;
      return;
    }
    if (boardId === null) {
      return;
    }
    onBoard(boardId);
    if (phase === 'finished' && finishedRead !== boardId) {
      finishedRead = boardId;
      quiet();
    }
  }

  // `BoardMessageSent`: a message on the table the chat follows, for the
  // board it is on (a newer board's first message starts its chat).
  function receive(event: BoardMessageSentEvent) {
    if (event.table_id !== tableId.value || !onBoard(event.playing_id)) {
      return;
    }
    messages.value = mergeMessages(messages.value, [event.message]);
    if (open.value) {
      markRead();
    }
  }

  // Our message: the answer is the message itself (its event may come too).
  async function send(body: string, to: ChatTo): Promise<BoardMessage> {
    const id = tableId.value;
    if (id === null) {
      throw new Error('No chat is loaded.');
    }
    const callIndex = about.value;
    const message = await chatService.sendMessage(id, { body, to, call_index: callIndex });
    if (tableId.value === id && playingId.value !== null) {
      messages.value = mergeMessages(messages.value, [message]);
      markRead();
    }
    if (about.value === callIndex) {
      about.value = null;
    }
    return message;
  }

  // Open (marking it all read) or close the panel; closing counts what was
  // on show as seen.
  function setOpen(value: boolean) {
    open.value = value;
    markRead();
    if (!value) {
      about.value = null;
    }
  }

  // The Chat button (or Close) beside the table: the choice sticks.
  function setKeepOpen(value: boolean) {
    keepOpen.value = value;
    writeKeepOpen(value);
  }

  // Open the chat with a call attached: "About 2♥:".
  function askAbout(index: number) {
    about.value = index;
    setOpen(true);
  }

  function reset() {
    playingId.value = null;
    messages.value = [];
    about.value = null;
    finishedRead = null;
  }

  // We left the table, were kicked or logged out.
  function clear() {
    reset();
    tableId.value = null;
    open.value = false;
    request = null;
  }

  // Whatever was sent while the socket was down is lost: read it again.
  onReconnect(() => {
    if (tableId.value !== null) {
      load(tableId.value).catch(() => undefined);
    }
  });

  return {
    tableId,
    playingId,
    messages,
    open,
    keepOpen,
    about,
    unread,
    load,
    follow,
    receive,
    send,
    setOpen,
    setKeepOpen,
    askAbout,
    clear,
  };
});
