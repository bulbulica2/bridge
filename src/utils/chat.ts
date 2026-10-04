import type { AuctionCall, Phase } from '@/services/game';
import type { BoardMessage, ChatTo } from '@/services/chat';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { isOpponent } from '@/utils/alerts';
import { SEAT_NAMES, callLabel } from '@/utils/auction';

// The board chat (bridge_backend docs/API.md, Chat; GAME-RULES.md, table
// talk): while the board is bid or played only the opponents may be told
// anything, so partners can't talk; once it is finished, the whole table.

// Who a message may go to in `phase`, the default first: nothing before the
// first deal (the chat opens with it), the opponents during the board, and
// the table or the opponents once it is finished.
export function chatRecipients(phase: Phase | null): ChatTo[] {
  if (phase === 'auction' || phase === 'play') {
    return ['opponents'];
  }
  return phase === 'finished' ? ['table', 'opponents'] : [];
}

export const RECIPIENT_LABELS: Record<ChatTo, string> = {
  opponents: 'to opponents',
  table: 'to table',
};

// Both lists as one, each message once, oldest first (ids only grow): a
// message can come over HTTP and over the user channel alike.
export function mergeMessages(a: BoardMessage[], b: BoardMessage[]): BoardMessage[] {
  const byId = new Map<number, BoardMessage>();
  [...a, ...b].forEach((message) => byId.set(message.id, message));
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

// "12:05", the local time a message was sent; empty for a bad timestamp.
export function chatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Who wrote it: "You", or the player's username, else the seat's name.
export function senderName(
  message: BoardMessage,
  players: Partial<Record<Seat, PublicUser | null>> | null,
  me: number | null,
): string {
  if (me !== null && message.user_id === me) {
    return 'You';
  }
  return players?.[message.seat]?.username ?? SEAT_NAMES[message.seat];
}

// The call a message is about, if it names one the auction has.
export function aboutCall(
  message: Pick<BoardMessage, 'call_index'>,
  auction: AuctionCall[] | null | undefined,
): AuctionCall | null {
  return message.call_index === null ? null : (auction?.[message.call_index] ?? null);
}

// An opponent asks about one of our own calls: worth a toast when the chat
// is closed. Our own messages and partner's never are.
export function asksAboutMyCall(
  message: BoardMessage,
  auction: AuctionCall[] | null | undefined,
  mySeat: Seat | null,
  me: number | null,
): boolean {
  const call = aboutCall(message, auction);
  return (
    !!call &&
    message.user_id !== me &&
    call.seat === mySeat &&
    isOpponent(message.seat, mySeat)
  );
}

// "East asks about your 2♥: what does it show?"
export function chatQuestionText(message: BoardMessage, call: AuctionCall): string {
  return `${SEAT_NAMES[message.seat]} asks about your ${callLabel(call.bid)}: ${message.body}`;
}

// The chat as lines for the text export, oldest first:
// "12:05 East (bob) to opponents, about 2♥: What does it show?"
export function chatLines(
  messages: BoardMessage[],
  players: Partial<Record<Seat, PublicUser | null>> | null,
  auction: AuctionCall[] | null | undefined,
): string[] {
  return messages.map((message) => {
    const user = players?.[message.seat];
    const who = user ? `${SEAT_NAMES[message.seat]} (${user.username})` : SEAT_NAMES[message.seat];
    const call = aboutCall(message, auction);
    const about = call ? `, about ${callLabel(call.bid)}` : '';
    const time = chatTime(message.created_at);
    return `${time ? `${time} ` : ''}${who} ${RECIPIENT_LABELS[message.to]}${about}: ${message.body}`;
  });
}
