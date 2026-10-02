import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import type { ChannelAuthorizationCallback } from 'pusher-js';
import http from './http';
import type { Ban } from './auth';
import type { HandDealtEvent, PublicPlaying } from './game';
import type { BroadcastTable } from './tables';

// Live updates come over Laravel Reverb, which speaks the Pusher protocol.
// See bridge_backend docs/AUTH.md (Websocket channels) and API.md (Realtime).

// What `TableUpdated` carries on `private-table.{id}`: the whole table, in the
// same shape as GET /tables/{id} less `can_manage`.
export interface TableUpdatedEvent {
  table: BroadcastTable;
}

// What `PlayingUpdated` carries on the same channel: the public part of the
// game state, never anybody's hand.
export interface PlayingUpdatedEvent {
  playing: PublicPlaying;
}

let echo: Echo<'reverb'> | null = null;
let stopWatchingConnection: (() => void) | null = null;
const reconnectListeners = new Set<() => void>();

// Created on first use rather than at import time, so nobody opens a socket
// before they sit down (and a guest never does).
export function getEcho(): Echo<'reverb'> {
  if (!echo) {
    echo = new Echo({
      broadcaster: 'reverb',
      Pusher,
      key: import.meta.env.VITE_REVERB_APP_KEY,
      wsHost: import.meta.env.VITE_REVERB_HOST,
      wsPort: Number(import.meta.env.VITE_REVERB_PORT),
      wssPort: Number(import.meta.env.VITE_REVERB_PORT),
      forceTLS: import.meta.env.VITE_REVERB_SCHEME === 'https',
      enabledTransports: ['ws', 'wss'],
      // Echo's own authorizer doesn't send X-XSRF-TOKEN, so sign private
      // channels through the shared axios instance, which does.
      authorizer: (channel: { name: string }) => ({
        authorize: (socketId: string, callback: ChannelAuthorizationCallback) => {
          http
            .get('/sanctum/csrf-cookie')
            .then(() =>
              http.post('/broadcasting/auth', { socket_id: socketId, channel_name: channel.name }),
            )
            .then((response) => callback(null, response.data))
            .catch((error) => callback(error, null));
        },
      }),
    });

    // Pusher resubscribes by itself after a dropped connection, but whatever
    // was broadcast while it was down is lost; tell the listeners so they can
    // refetch. The first "connected" is the initial connection, not a reconnect.
    let everConnected = false;
    let lastStatus: string | null = null;
    stopWatchingConnection = echo.connector.onConnectionChange((status) => {
      if (status === 'connected' && lastStatus !== 'connected') {
        if (everConnected) {
          reconnectListeners.forEach((listener) => listener());
        }
        everConnected = true;
      }
      lastStatus = status;
    });
  }
  return echo;
}

// Called after the socket comes back from a drop. Returns an unsubscribe.
export function onReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

export function listenToTable(
  tableId: number,
  onUpdate: (table: BroadcastTable) => void,
  onPlaying: (playing: PublicPlaying) => void,
) {
  getEcho()
    .private(`table.${tableId}`)
    .listen('TableUpdated', (event: TableUpdatedEvent) => onUpdate(event.table))
    .listen('PlayingUpdated', (event: PlayingUpdatedEvent) => onPlaying(event.playing));
}

// The user's own channel carries what only they may see: their cards
// (`HandDealt`) each time a board is dealt at their table, and `UserBanned`
// when an admin bans them (their session is already gone by then).
export function listenToUser(
  userId: number,
  onHandDealt: (event: HandDealtEvent) => void,
  onBanned: (ban: Ban) => void,
) {
  getEcho()
    .private(`App.Models.User.${userId}`)
    .listen('HandDealt', onHandDealt)
    .listen('UserBanned', onBanned);
}

export function leaveUser(userId: number) {
  echo?.leave(`App.Models.User.${userId}`);
}

// The server never ends a subscription itself, even once the user has left.
export function leaveTable(tableId: number) {
  echo?.leave(`table.${tableId}`);
}

// On logout: close the socket; the next login gets a fresh one.
export function disconnectEcho() {
  stopWatchingConnection?.();
  stopWatchingConnection = null;
  echo?.disconnect();
  echo = null;
}
