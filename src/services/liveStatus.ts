import { reactive, readonly } from 'vue';

// Whether live updates reach the page: `echo.ts` writes it as the socket and
// the table channel change, `useLiveStatus()` reads it. Kept apart from
// `echo.ts` so the pages read it without opening a socket.

// Echo's connection status: connecting, connected, failed or disconnected
// ('initialized' until a socket exists).
const state = reactive({
  connection: 'initialized',
  // The table whose private channel Pusher last confirmed (subscription_succeeded).
  subscribedTable: null as number | null,
});

export const liveStatus = readonly(state);

export function setConnection(status: string) {
  state.connection = status;
  // Pusher resubscribes by itself once the socket is back and confirms it
  // again; until then the channel isn't live.
  if (status !== 'connected') {
    state.subscribedTable = null;
  }
}

export function setSubscribed(tableId: number) {
  state.subscribedTable = tableId;
}

// A refused subscription or leaving the channel.
export function clearSubscribed(tableId: number) {
  if (state.subscribedTable === tableId) {
    state.subscribedTable = null;
  }
}

// On logout: no socket any more.
export function resetLiveStatus() {
  state.connection = 'initialized';
  state.subscribedTable = null;
}

// Live = the socket is connected and this table's channel is subscribed.
export function isLive(tableId: number): boolean {
  return state.connection === 'connected' && state.subscribedTable === tableId;
}
