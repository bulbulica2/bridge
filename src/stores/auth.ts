import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import * as authService from '@/services/auth';
import { disconnectEcho } from '@/services/echo';
import { useGameStore } from '@/stores/game';
import { useHistoryStore } from '@/stores/history';
import { useTablesStore } from '@/stores/tables';
import type {
  Ban,
  LoginCredentials,
  PasswordResetData,
  PasswordResetRequest,
  ProfileUpdate,
  RegistrationData,
  User,
} from '@/services/auth';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const isAuthenticated = computed(() => user.value !== null);
  // The ban in force on the logged-in user (GET /api/user's `ban`): every
  // page shows it (AppHeader's BanBanner) and the game is closed to them.
  // It ends by itself at `until`; the next reload finds it gone.
  const ban = computed(() => user.value?.ban ?? null);
  const isBanned = computed(() => ban.value !== null);
  // A ban that has just thrown the user out (UserBanned), shown until dismissed.
  const banNotice = ref<Ban | null>(null);

  // The store lives in memory, but the Sanctum session lives in a cookie, so on
  // a page reload we have to ask the backend who we are before the router guard
  // can decide anything. Kept as a single in-flight promise so concurrent
  // navigations only trigger one request.
  let sessionCheck: Promise<void> | null = null;

  async function login(credentials: LoginCredentials) {
    await authService.login(credentials);
    user.value = await authService.fetchUser();
    banNotice.value = null;
    useGameStore().watchUser(user.value.id);
    sessionCheck = Promise.resolve();
  }

  async function register(data: RegistrationData) {
    await authService.register(data);
    user.value = await authService.fetchUser();
    useGameStore().watchUser(user.value.id);
    sessionCheck = Promise.resolve();
  }

  async function logout() {
    try {
      await authService.logout();
    } finally {
      endSession();
    }
  }

  // This client is done with the session, and with the table and user
  // channels it could only hold while logged in.
  function endSession() {
    useTablesStore().unwatchTable();
    useTablesStore().dismissLostSet();
    useGameStore().unwatchUser();
    useHistoryStore().clear();
    disconnectEcho();
    user.value = null;
    sessionCheck = Promise.resolve();
  }

  // UserBanned on our own channel (the game store's watchUser listens): the
  // backend has already freed our seat and deleted the session, so there is
  // no POST /logout, only the local half of it. The ban stays in `banNotice`
  // until the user dismisses it (BanNotice.vue, which also goes to /login).
  function applyBan(ban: Ban) {
    if (!user.value) {
      return;
    }
    banNotice.value = ban;
    endSession();
  }

  function dismissBanNotice() {
    banNotice.value = null;
  }

  // Resolves once we know whether there is a live session. Safe to await on
  // every navigation: the lookup happens at most once per page load.
  function loadSession(): Promise<void> {
    if (!sessionCheck) {
      sessionCheck = authService
        .fetchUser()
        .then((u) => {
          user.value = u;
        })
        .catch(() => {
          // 401 (or an unreachable backend) simply means "not logged in".
          user.value = null;
        })
        .then(() => {
          // Our own channel (HandDealt) is followed for the whole session.
          if (user.value) {
            useGameStore().watchUser(user.value.id);
          }
        });
    }
    return sessionCheck;
  }

  // Password reset is a guest flow: neither call authenticates anyone, so the
  // user stays untouched. Both return the backend's human-readable status.
  async function requestPasswordReset(data: PasswordResetRequest) {
    return authService.requestPasswordReset(data);
  }

  async function resetPassword(data: PasswordResetData) {
    return authService.resetPassword(data);
  }

  // The backend answers with the full own record, so it replaces `user`
  // wholesale; the header and menu pick up a new name straight away. On a
  // failure (422, 401, offline) the user stays as it was.
  async function updateProfile(data: ProfileUpdate) {
    user.value = await authService.updateProfile(data);
  }

  return {
    user,
    isAuthenticated,
    ban,
    isBanned,
    banNotice,
    login,
    register,
    logout,
    loadSession,
    requestPasswordReset,
    resetPassword,
    updateProfile,
    applyBan,
    dismissBanNotice,
  };
});
