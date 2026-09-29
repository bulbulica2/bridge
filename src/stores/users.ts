import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as usersService from '@/services/users';
import type { PublicUser } from '@/services/users';
import { statusOf } from '@/utils/errors';

// Other players' public profiles, by id. Table payloads already embed one per
// seat, so views show that copy at once and ask for a fresh one here.
export const useUsersStore = defineStore('users', () => {
  const profiles = ref<Record<number, PublicUser>>({});

  // Refreshes one profile. A 404 means the account is gone, so its cached copy
  // is dropped before the error reaches the caller.
  async function load(id: number): Promise<PublicUser> {
    try {
      const user = await usersService.getUser(id);
      profiles.value[id] = user;
      return user;
    } catch (e) {
      if (statusOf(e) === 404) {
        delete profiles.value[id];
      }
      throw e;
    }
  }

  return { profiles, load };
});
