import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as usersService from '@/services/users';
import type { BanRequest, PublicUser, UserBan, UserStats } from '@/services/users';
import { statusOf } from '@/utils/errors';

// Other players' public profiles, by id. Table payloads already embed one per
// seat, so views show that copy at once and ask for a fresh one here.
export const useUsersStore = defineStore('users', () => {
  const profiles = ref<Record<number, PublicUser>>({});
  // Players' stats by user id, the logged-in user's own included. They change
  // after every board, so each page that shows them reads them again.
  const stats = ref<Record<number, UserStats>>({});

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

  // An admin's ban or lift answers with the ban itself: put it on the cached
  // profile (the ban in force, and its row in the history) so the page shows
  // it without another GET.
  function recordBan(id: number, ban: UserBan) {
    const profile = profiles.value[id];
    if (!profile) {
      return;
    }
    const bans = profile.bans ?? [];
    if (ban.active) {
      // A new ban also closes the one in force; the history shows that from
      // the next read on.
      profile.ban = ban;
      profile.bans = [ban, ...bans.filter((b) => b.id !== ban.id)];
    } else {
      profile.ban = null;
      profile.bans = bans.map((b) => (b.id === ban.id ? ban : b));
    }
  }

  // Admins only (see banUser): resolves with the ban and the backend's
  // "User banned until …" message.
  async function ban(id: number, request: BanRequest) {
    const result = await usersService.banUser(id, request);
    recordBan(id, result.ban);
    return result;
  }

  // Admins only: lifts the ban in force. A 404 means it had already ended or
  // been lifted, so the cached one goes too before the error reaches the caller.
  async function liftBan(id: number): Promise<UserBan> {
    try {
      const lifted = await usersService.liftBan(id);
      recordBan(id, lifted);
      return lifted;
    } catch (e) {
      if (statusOf(e) === 404 && profiles.value[id]) {
        profiles.value[id].ban = null;
      }
      throw e;
    }
  }

  // One player's stats, or (null) the logged-in user's own, kept under the
  // id the answer names. A 404 means the account is gone: its cached stats
  // are dropped before the error reaches the caller.
  async function loadStats(id: number | null): Promise<UserStats> {
    try {
      const fresh = id === null ? await usersService.getMyStats() : await usersService.getUserStats(id);
      stats.value[fresh.user_id] = fresh;
      return fresh;
    } catch (e) {
      if (id !== null && statusOf(e) === 404) {
        delete stats.value[id];
      }
      throw e;
    }
  }

  // Logout: nothing read for one user is kept for the next.
  function clear() {
    profiles.value = {};
    stats.value = {};
  }

  return { profiles, stats, load, loadStats, ban, liftBan, clear };
});
