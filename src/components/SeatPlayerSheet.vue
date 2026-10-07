<template>
  <!-- A manager's search for somebody to put in a free seat. The parent owns
       which seat is open, seats the pick and clears the seat on close. -->
  <ion-modal
    :is-open="seat !== null"
    :initial-breakpoint="0.9"
    :breakpoints="[0, 0.9]"
    @did-present="focusSearch"
    @did-dismiss="close"
  >
    <ion-content class="ion-padding">
      <div class="seat-player">
        <h2 class="title">Seat a player at {{ seat }}</h2>

        <ion-searchbar
          ref="searchbar"
          v-model="query"
          :debounce="0"
          placeholder="Name or username"
          aria-label="Search players by name or username"
        />

        <p v-if="tooShort" class="hint">
          Type at least {{ SEARCH_MIN_LENGTH }} characters of a name or username.
        </p>

        <ion-text v-else-if="error" color="danger">
          <p class="hint">{{ error }}</p>
        </ion-text>

        <div v-else-if="searching && results.length === 0" class="searching" aria-busy="true">
          <ion-spinner name="crescent" />
          <span>Searching…</span>
        </div>

        <p v-else-if="searched !== null && results.length === 0" class="hint">
          No players match “{{ searched }}”.
        </p>

        <ion-list v-if="!tooShort && !error && results.length > 0" lines="full">
          <ion-item
            v-for="user in results"
            :key="user.id"
            :button="!user.seated"
            :disabled="user.seated"
            :detail="false"
            @click="pick(user)"
          >
            <PlayerAvatar slot="start" :user="user" class="result-avatar" />
            <ion-label>
              <h3>{{ user.username }}</h3>
              <p>{{ user.name }}</p>
            </ion-label>
            <ion-note v-if="user.seated" slot="end">already at a table</ion-note>
          </ion-item>
        </ion-list>

        <p v-if="searching && results.length > 0" class="hint">Searching…</p>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  IonModal,
  IonContent,
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonNote,
  IonSpinner,
  IonText,
} from '@ionic/vue';
import PlayerAvatar from '@/components/PlayerAvatar.vue';
import { SEARCH_MIN_LENGTH, useUserSearch } from '@/composables/useUserSearch';
import type { Seat } from '@/services/tables';
import type { SearchedUser } from '@/services/users';

defineProps<{ seat: Seat | null }>();
const emit = defineEmits<{ select: [user: SearchedUser]; close: [] }>();

const { query, results, searching, error, searched, tooShort, reset } = useUserSearch();
const searchbar = ref<InstanceType<typeof IonSearchbar> | null>(null);

function focusSearch() {
  (searchbar.value?.$el as HTMLIonSearchbarElement | undefined)?.setFocus();
}

// A seated user would only 409, so their row stays greyed out.
function pick(user: SearchedUser) {
  if (!user.seated) {
    emit('select', user);
  }
}

// Every opening starts from an empty box.
function close() {
  reset();
  emit('close');
}
</script>

<style scoped>
.seat-player {
  max-width: 520px;
  margin: 0 auto;
}

.title {
  margin: 8px 0 4px;
  font-size: 1.2rem;
  font-weight: 700;
  text-align: center;
}

/* A result: the plate's navy avatar, a row of 56 px to tap. */
ion-item {
  --min-height: 56px;
}

.result-avatar {
  background: var(--bridge-plate);
  color: var(--bridge-on-plate);
}

ion-searchbar {
  padding-inline: 0;
}

.hint {
  margin: 8px 0;
  font-size: 0.9rem;
  color: var(--bridge-muted);
  text-align: center;
}

ion-text .hint {
  color: inherit;
}

.searching {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 0;
  color: var(--bridge-muted);
  font-size: 0.9rem;
}

.searching ion-spinner {
  width: 18px;
  height: 18px;
}

ion-label h3 {
  overflow-wrap: anywhere;
}
</style>
