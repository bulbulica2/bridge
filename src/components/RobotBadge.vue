<template>
  <!-- Marks a seated robot (PublicUser.is_robot) next to its name, wherever a
       seat is drawn. Ionicons has no robot, so a chip stands in for one. -->
  <span class="robot-badge" title="Robot player">
    <ion-icon :icon="hardwareChipOutline" aria-hidden="true" />
    <span>robot</span>
  </span>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { hardwareChipOutline } from 'ionicons/icons';
</script>

<style scoped>
.robot-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--bridge-redouble-bg, #e1ebfd);
  color: var(--bridge-redouble-text, #1e4fc2);
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1.5;
  text-transform: uppercase;
  white-space: nowrap;
}

.robot-badge ion-icon {
  font-size: 0.85rem;
}
</style>
