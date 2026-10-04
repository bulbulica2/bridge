<template>
  <!-- A board's chat, oldest first: who wrote each message (name and seat),
       when, who reads it, the call it is about, and the text. Plain text
       only: a message is whatever its sender typed, so it is never read as
       HTML and its links aren't links. -->
  <ol v-if="messages.length > 0" class="chat-list">
    <li
      v-for="message in messages"
      :key="message.id"
      class="chat-message"
      :class="{ mine: me !== null && message.user_id === me, 'to-table': message.to === 'table' }"
    >
      <p class="chat-meta">
        <span class="chat-sender">{{ senderName(message, players, me) }}</span>
        <span class="chat-seat">{{ SEAT_NAMES[message.seat] }}</span>
        <span class="chat-to">{{ RECIPIENT_LABELS[message.to] }}</span>
        <time class="chat-time" :datetime="message.created_at">{{ chatTime(message.created_at) }}</time>
      </p>
      <p class="chat-body">
        <span v-if="aboutCall(message, auction)" class="chat-call">
          <CallLabel :bid="aboutCall(message, auction)!.bid" />
        </span>{{ message.body }}
      </p>
    </li>
  </ol>
  <p v-else class="chat-empty">{{ empty }}</p>
</template>

<script setup lang="ts">
import CallLabel from '@/components/CallLabel.vue';
import type { BoardMessage } from '@/services/chat';
import type { AuctionCall } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { SEAT_NAMES } from '@/utils/auction';
import { RECIPIENT_LABELS, aboutCall, chatTime, senderName } from '@/utils/chat';

withDefaults(
  defineProps<{
    messages: BoardMessage[];
    players?: Partial<Record<Seat, PublicUser | null>> | null;
    // The board's auction, to show the call a message is about.
    auction?: AuctionCall[] | null;
    // The viewer's user id: their own messages say "You".
    me?: number | null;
    empty?: string;
  }>(),
  { players: null, auction: null, me: null, empty: 'No messages yet.' },
);
</script>

<style scoped>
.chat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat-message {
  max-width: 92%;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--ion-color-step-100, #e6e6e6);
}

.chat-message.mine {
  align-self: flex-end;
  background: rgba(var(--ion-color-primary-rgb, 56, 128, 255), 0.15);
}

.chat-message.to-table {
  border-left: 3px solid var(--ion-color-success, #2dd36f);
}

.chat-message p {
  margin: 0;
}

.chat-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  font-size: 0.72rem;
  color: var(--ion-color-medium);
}

.chat-sender {
  font-weight: 700;
  color: var(--ion-text-color, #1a1a1a);
}

.chat-to {
  font-style: italic;
}

.chat-time {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

/* Line breaks as typed; a long word or link wraps rather than overflows. */
.chat-body {
  margin-top: 2px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-call {
  display: inline-flex;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ion-background-color, #fff);
  font-size: 0.8rem;
  font-weight: 600;
}

.chat-empty {
  margin: 8px 0;
  text-align: center;
  color: var(--ion-color-medium);
}
</style>
