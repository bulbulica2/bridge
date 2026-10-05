<template>
  <!-- An admin banning a player (POST /users/{id}/ban): how many days and
       why. The reason is what the player is shown. -->
  <form class="ban-form" novalidate @submit.prevent="submit">
    <h3 class="ban-form-title">Ban @{{ user.username }}</h3>

    <div class="quick-days" role="group" aria-label="Quick picks">
      <ion-button
        v-for="n in BAN_QUICK_DAYS"
        :key="n"
        size="small"
        :fill="days === n ? 'solid' : 'outline'"
        :disabled="sending"
        @click="daysText = String(n)"
      >
        {{ dayCount(n) }}
      </ion-button>
    </div>

    <ion-list>
      <ion-item>
        <ion-input
          v-model="daysText"
          type="number"
          inputmode="numeric"
          :min="1"
          :max="MAX_BAN_DAYS"
          label="Days (1–365)"
          label-placement="stacked"
          :disabled="sending"
        />
      </ion-item>
      <ion-text v-if="shownErrors.days" color="danger">
        <p class="field-error">{{ shownErrors.days }}</p>
      </ion-text>
      <ion-item>
        <ion-textarea
          v-model="reason"
          label="Reason (shown to the player)"
          label-placement="stacked"
          :auto-grow="true"
          :maxlength="MAX_BAN_REASON"
          placeholder="Playing two accounts at once."
          :disabled="sending"
        />
      </ion-item>
      <ion-text v-if="shownErrors.reason" color="danger">
        <p class="field-error">{{ shownErrors.reason }}</p>
      </ion-text>
    </ion-list>

    <ion-text v-if="sendError" color="danger">
      <p class="field-error">{{ sendError }}</p>
    </ion-text>

    <p class="ban-form-hint">
      They are taken off their table at once (mid-set a robot takes their seat) and logged out.
    </p>

    <div class="ban-form-actions">
      <ion-button fill="outline" :disabled="sending" @click="emit('cancel')">Cancel</ion-button>
      <ion-button type="submit" color="danger" :disabled="sending">
        <ion-spinner v-if="sending" name="crescent" />
        <span v-else>Ban for {{ validDays ? dayCount(days) : '…' }}</span>
      </ion-button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { IonButton, IonInput, IonItem, IonList, IonSpinner, IonText, IonTextarea } from '@ionic/vue';
import { useUsersStore } from '@/stores/users';
import type { PublicUser, UserBan } from '@/services/users';
import { BAN_QUICK_DAYS, MAX_BAN_DAYS, MAX_BAN_REASON, banDate, banFormErrors } from '@/utils/ban';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { showToast } from '@/utils/toast';

const props = defineProps<{ user: PublicUser }>();
const emit = defineEmits<{ banned: [ban: UserBan]; cancel: [] }>();

const store = useUsersStore();

// ion-input hands back text, so the number is read from it.
const daysText = ref('7');
const reason = ref('');
const sending = ref(false);
const sendError = ref('');
// The form's own errors show once it has been sent; the backend's 422 replaces them.
const tried = ref(false);
const serverErrors = ref<Record<string, string>>({});

const days = computed(() => Number(daysText.value));
const errors = computed(() => banFormErrors({ days: days.value, reason: reason.value }));
const validDays = computed(() => !errors.value.days);
const shownErrors = computed(() => ({
  days: serverErrors.value.days ?? (tried.value ? errors.value.days : undefined),
  reason: serverErrors.value.reason ?? (tried.value ? errors.value.reason : undefined),
}));

function dayCount(n: number) {
  return n === 1 ? '1 day' : `${n} days`;
}

async function submit() {
  tried.value = true;
  serverErrors.value = {};
  sendError.value = '';
  if (Object.keys(errors.value).length > 0) {
    return;
  }
  sending.value = true;
  try {
    const { ban, message } = await store.ban(props.user.id, { days: days.value, reason: reason.value.trim() });
    emit('banned', ban);
    // "User banned until 12 Oct 2026."
    await showToast(message || `Banned until ${banDate(ban.until)}.`, 'success');
  } catch (e) {
    serverErrors.value = fieldErrors(e);
    if (Object.keys(serverErrors.value).length === 0) {
      // 403: not an admin any more, or a target that can't be banned.
      sendError.value = errorMessage(e, 'Could not ban this player. Please try again.');
    }
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.ban-form {
  text-align: left;
}

.ban-form-title {
  margin: 0 0 8px;
  font-size: 1.1rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.quick-days {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.field-error {
  margin: 4px 16px 8px;
  font-size: 0.85rem;
}

.ban-form-hint {
  margin: 8px 0;
  font-size: 0.85rem;
  color: var(--ion-color-medium);
}

.ban-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
