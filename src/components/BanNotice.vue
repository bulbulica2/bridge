<template>
  <!-- The ban that has just thrown the user out (UserBanned): it stays up
       until dismissed, unlike a toast. Plain text, not an ion-alert, whose
       message is HTML and the reason is whatever the admin typed. -->
  <ion-modal :is-open="ban !== null" :backdrop-dismiss="false" class="ban-notice">
    <div v-if="ban" class="ban-notice-body" role="alertdialog" aria-labelledby="ban-notice-title">
      <h2 id="ban-notice-title">You have been banned</h2>
      <p class="ban-until">You can't play until {{ banDate(ban.until) }}.</p>
      <p class="ban-reason">{{ ban.reason }}</p>
      <p class="ban-hint">You can still log in to see your boards and profile.</p>
      <ion-button expand="block" @click="auth.dismissBanNotice()">OK</ion-button>
    </div>
  </ion-modal>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { IonButton, IonModal, useIonRouter } from '@ionic/vue';
import { useAuthStore } from '@/stores/auth';
import { banDate } from '@/utils/ban';

const auth = useAuthStore();
const ionRouter = useIonRouter();

const ban = computed(() => auth.banNotice);

// The store has already ended the session; whatever page was up (a table, the
// game) needs a session, so go to the login page under the notice.
watch(ban, (now, before) => {
  if (now && !before) {
    ionRouter.navigate('/login', 'root', 'replace');
  }
});
</script>

<style scoped>
.ban-notice {
  --width: min(92vw, 420px);
  --height: fit-content;
}

.ban-notice-body {
  padding: 24px;
}

.ban-notice-body h2 {
  margin: 0 0 12px;
  font-size: 1.3rem;
  font-weight: 600;
}

.ban-until {
  margin: 0 0 12px;
  font-weight: 600;
}

.ban-reason {
  margin: 0 0 16px;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.ban-hint {
  margin: 0 0 16px;
  font-size: 0.9rem;
  color: var(--ion-color-medium);
}
</style>
