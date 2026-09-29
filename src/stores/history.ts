import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as historyService from '@/services/history';
import type { BoardResults, PlayingHistoryEntry, PlayingReview } from '@/services/history';
import { statusOf } from '@/utils/errors';

// One player's finished boards, as far as they have been paged in.
export interface HistoryList {
  entries: PlayingHistoryEntry[];
  // The last page read, and how many there are (Laravel's paginator).
  page: number;
  lastPage: number;
  total: number;
}

// `null` is the logged-in user (GET /api/user/playings), a number anyone
// else (GET /users/{id}/playings).
export type HistoryOwner = number | null;

function keyOf(owner: HistoryOwner): string {
  return owner === null ? 'me' : `user:${owner}`;
}

// Finished boards after the fact: players' histories (paged in for an
// infinite scroll), boards' results at every table and single playings to
// review. All come from the playings' seat snapshots, so none loses anything
// when a table goes.
export const useHistoryStore = defineStore('history', () => {
  const lists = ref<Record<string, HistoryList>>({});
  const results = ref<Record<number, BoardResults>>({});
  const reviews = ref<Record<number, PlayingReview>>({});

  function listOf(owner: HistoryOwner): HistoryList | null {
    return lists.value[keyOf(owner)] ?? null;
  }

  function hasMore(owner: HistoryOwner): boolean {
    const list = listOf(owner);
    return !!list && list.page < list.lastPage;
  }

  // The first page, replacing whatever was paged in (a reload or a refresh).
  // The newest boards come first, so an older copy can't just be extended.
  async function loadHistory(owner: HistoryOwner): Promise<HistoryList> {
    const page = await fetchPage(owner, 1);
    const list: HistoryList = {
      entries: page.data,
      page: page.current_page,
      lastPage: page.last_page,
      total: page.total,
    };
    lists.value[keyOf(owner)] = list;
    return list;
  }

  // The next page, appended. Boards finished since the first page push rows
  // down a page, so a row already shown can come round again: skip it.
  async function loadMore(owner: HistoryOwner): Promise<HistoryList> {
    const current = listOf(owner);
    if (!current) {
      return loadHistory(owner);
    }
    if (current.page >= current.lastPage) {
      return current;
    }
    const page = await fetchPage(owner, current.page + 1);
    const seen = new Set(current.entries.map((e) => e.playing_id));
    const list: HistoryList = {
      entries: [...current.entries, ...page.data.filter((e) => !seen.has(e.playing_id))],
      page: page.current_page,
      lastPage: page.last_page,
      total: page.total,
    };
    lists.value[keyOf(owner)] = list;
    return list;
  }

  function fetchPage(owner: HistoryOwner, page: number) {
    return owner === null
      ? historyService.getMyPlayings(page)
      : historyService.getUserPlayings(owner, page);
  }

  // A board's results at every table. They change as more tables finish it,
  // so every read replaces them. A 403 (not finished it yourself) or 404
  // drops a cached copy before the error reaches the caller.
  async function loadResults(boardId: number): Promise<BoardResults> {
    try {
      const board = await historyService.getBoardResults(boardId);
      results.value[boardId] = board;
      return board;
    } catch (e) {
      const status = statusOf(e);
      if (status === 403 || status === 404) {
        delete results.value[boardId];
      }
      throw e;
    }
  }

  // One finished playing, by its id. Unlike a board's results it never
  // changes once finished, so a cached copy is served without asking again.
  async function loadReview(playingId: number): Promise<PlayingReview> {
    const cached = reviews.value[playingId];
    if (cached) {
      return cached;
    }
    const review = await historyService.getPlayingReview(playingId);
    reviews.value[playingId] = review;
    return review;
  }

  // Everything here belongs to whoever was logged in.
  function clear() {
    lists.value = {};
    results.value = {};
    reviews.value = {};
  }

  return {
    lists,
    results,
    reviews,
    listOf,
    hasMore,
    loadHistory,
    loadMore,
    loadResults,
    loadReview,
    clear,
  };
});
