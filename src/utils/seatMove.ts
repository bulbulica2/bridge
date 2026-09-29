import { alertController } from '@ionic/vue';
import type { Phase } from '@/services/game';
import type { Table } from '@/services/tables';

function tableLabel(table: Pick<Table, 'id' | 'name'>) {
  return table.name || `table #${table.id}`;
}

/**
 * What moving off `from` costs, one sentence each: taking a seat at another
 * table frees the old one with every consequence of leaving it
 * (bridge_docs/backend/API.md, POST /tables/{table}/seats). `phase` is that
 * table's board, when known: a finished one isn't abandoned.
 */
export function moveConsequences(from: Table, userId: number, phase: Phase | null = null): string[] {
  const label = tableLabel(from);
  const mySeat = from.seats.find((s) => s.user_id === userId)?.seat;
  const lines = [`You give up ${mySeat ? `seat ${mySeat} at ` : 'your seat at '}${label} for good.`];
  if (from.seats.every((s) => s.user_id === userId)) {
    lines.push(`Nobody else sits there, so ${label} will be deleted.`);
  } else {
    if (from.moderated_by === userId) {
      lines.push(`You manage ${label}; that role passes to another player.`);
    }
    if (from.board_id !== null && phase !== 'finished') {
      lines.push(`The board in progress there will be abandoned for the other three players.`);
    }
  }
  return lines;
}

/** Asks before a seat request that moves the user off another table. */
export async function confirmMove(
  from: Table,
  to: Pick<Table, 'id' | 'name'>,
  userId: number,
  phase: Phase | null = null,
) {
  const alert = await alertController.create({
    header: `Move to ${tableLabel(to)}?`,
    message: moveConsequences(from, userId, phase).join(' '),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Move', role: 'confirm' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role === 'confirm';
}

/**
 * What leaving costs, by the phase of the table's board: during one it is
 * abandoned for the other three, between boards (`finished`) nothing is lost
 * (bridge_docs/backend/API.md, POST /tables/{table}/playing/next). Empty
 * when there is no board or its phase is unknown.
 */
export function leaveWarning(phase: Phase | null, boardNumber: number | null = null): string {
  const board = boardNumber ? `Board ${boardNumber}` : 'The board';
  if (phase === 'auction' || phase === 'play') {
    return `${board} is in progress: leaving abandons it for the other three players.`;
  }
  if (phase === 'finished') {
    return `${board} is over, so leaving abandons nothing: its score is kept.`;
  }
  return '';
}
