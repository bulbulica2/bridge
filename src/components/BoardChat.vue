<template>
  <!-- The board's chat at the table: its messages, then a line to write.
       From the first deal a message goes to the whole table (the default)
       or to the opponents only, never partner; a call attached (Ask)
       switches it to the opponents. The play page shows it beside the table on a wide screen, in a bottom
       sheet on a phone, and owns the draft and the sending. -->
  <section class="board-chat" aria-label="Board chat">
    <header class="chat-head">
      <h2 class="chat-title">Chat</h2>
      <ion-button fill="clear" size="small" class="chat-close" aria-label="Close the chat" @click="emit('close')">
        <ion-icon slot="icon-only" :icon="closeOutline" />
      </ion-button>
    </header>

    <div ref="scroller" class="chat-scroll">
      <ChatMessageList
        :messages="messages"
        :players="players"
        :auction="auction"
        :me="me"
        empty="No messages yet. Say hello to the table, or ask the opponents about their calls."
      />
    </div>

    <p v-if="recipients.length === 0" class="chat-closed">The chat opens with the first deal.</p>
    <div v-else class="chat-compose">
      <div class="chat-to-row">
        <button
          v-for="option in recipients"
          :key="option"
          type="button"
          class="chat-to-option"
          :aria-pressed="to === option"
          @click="picked = option"
        >
          {{ option === 'table' ? 'Table' : 'Opponents' }}
        </button>
        <span class="chat-to-note">{{ toNote }}</span>
      </div>
      <p v-if="aboutBid" class="chat-about">
        <span>About <CallLabel :bid="aboutBid" />:</span>
        <button type="button" class="chat-about-clear" aria-label="Not about this call" @click="emit('clear-about')">
          ×
        </button>
      </p>
      <div class="chat-input-row">
        <textarea
          ref="input"
          :value="draft"
          class="chat-input"
          rows="2"
          :maxlength="CHAT_MAX"
          placeholder="Write a message…"
          aria-label="Your message"
          :disabled="busy"
          @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
          @keydown.enter.exact.prevent="send"
        />
        <ion-button class="chat-send" :disabled="busy || draft.trim() === ''" @click="send">
          <ion-spinner v-if="busy" name="crescent" />
          <span v-else>Send</span>
        </ion-button>
      </div>
      <p class="chat-count">{{ draft.length }}/{{ CHAT_MAX }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { IonButton, IonIcon, IonSpinner } from '@ionic/vue';
import { closeOutline } from 'ionicons/icons';
import CallLabel from '@/components/CallLabel.vue';
import ChatMessageList from '@/components/ChatMessageList.vue';
import type { BoardMessage, ChatTo } from '@/services/chat';
import type { AuctionCall, Phase } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { chatRecipients } from '@/utils/chat';
import { CHAT_MAX } from '@/utils/limits';

const props = withDefaults(
  defineProps<{
    messages: BoardMessage[];
    players?: Partial<Record<Seat, PublicUser | null>> | null;
    auction?: AuctionCall[] | null;
    phase: Phase | null;
    me?: number | null;
    // What is typed so far: kept by the page, so a refused message keeps it.
    draft: string;
    // The call (its index in the auction) the message is about.
    about?: number | null;
    // A message is on its way.
    busy?: boolean;
  }>(),
  { players: null, auction: null, me: null, about: null, busy: false },
);

const emit = defineEmits<{
  send: [to: ChatTo];
  close: [];
  'clear-about': [];
  'update:draft': [draft: string];
}>();

const scroller = ref<HTMLElement | null>(null);
const input = ref<HTMLTextAreaElement | null>(null);

const recipients = computed(() => chatRecipients(props.phase));

// The user's pick while the phase allows it, else the phase's default (the
// table). Only shown, and sent, once there is a board.
const picked = ref<ChatTo | null>(null);
const to = computed<ChatTo>(() =>
  picked.value !== null && recipients.value.includes(picked.value) ? picked.value : (recipients.value[0] ?? 'table'),
);

const toNote = computed(() =>
  to.value === 'table' ? 'Everyone at the table sees this.' : 'Only the opponents see this, not your partner.',
);

const aboutBid = computed(() =>
  props.about === null ? null : (props.auction?.[props.about]?.bid ?? null),
);

// A call attached (Ask in a call's pop-up): a question for the opponents,
// straight to the typing.
watch(
  () => props.about,
  (index) => {
    if (index !== null) {
      picked.value = 'opponents';
      nextTick(() => input.value?.focus());
    }
  },
  { immediate: true },
);

// The newest message in view as messages come.
watch(
  () => props.messages.length,
  () =>
    nextTick(() => {
      if (scroller.value) {
        scroller.value.scrollTop = scroller.value.scrollHeight;
      }
    }),
  { immediate: true },
);

function send() {
  if (!props.busy && props.draft.trim() !== '') {
    emit('send', to.value);
  }
}
</script>

<style scoped>
.board-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chat-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}

.chat-scroll {
  flex: 1;
  min-height: 80px;
  overflow-y: auto;
  padding: 4px 0 8px;
}

.chat-closed {
  text-align: center;
  color: var(--ion-color-medium);
}

.chat-compose {
  border-top: 1px solid var(--ion-color-step-150, #e0e0e0);
  padding-top: 8px;
}

.chat-to-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  font-size: 0.8rem;
}

.chat-to-option {
  padding: 2px 10px;
  border: 1px solid var(--ion-color-primary, #3880ff);
  border-radius: 999px;
  background: transparent;
  color: var(--ion-color-primary, #3880ff);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.chat-to-option[aria-pressed='true'] {
  background: var(--ion-color-primary, #3880ff);
  color: var(--ion-color-primary-contrast, #fff);
}

.chat-to-note {
  color: var(--ion-color-medium);
}

.chat-about {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0;
  font-size: 0.85rem;
  font-weight: 600;
}

.chat-about-clear {
  padding: 0 6px;
  border: none;
  border-radius: 50%;
  background: var(--ion-color-step-150, #e0e0e0);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.chat-input-row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  margin-top: 6px;
}

.chat-input {
  flex: 1;
  box-sizing: border-box;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--ion-color-step-300, #b3b3b3);
  border-radius: 8px;
  background: var(--ion-background-color, #fff);
  color: var(--ion-text-color, #1a1a1a);
  font: inherit;
  resize: none;
}

.chat-count {
  margin: 2px 0 0;
  font-size: 0.7rem;
  text-align: right;
  color: var(--ion-color-medium);
}
</style>
