import { alertController } from '@ionic/vue';
import type { Phase } from '@/services/game';
import { UNATTENDED_MINUTES } from '@/services/tables';
import type { Table } from '@/services/tables';

function tableLabel(table: Pick<Table, 'id' | 'name'>) {
  return table.name || `table #${table.id}`;
}

/**
 * Who still sits at `table` once `userId` has gone: nobody (it is deleted),
 * only robots (it is kept, unattended, for UNATTENDED_MINUTES; the robots
 * wait and nobody manages it), or other people.
 */
export function whoIsLeft(table: Table, userId: number): 'nobody' | 'robots' | 'people' {
  const others = table.seats.filter((s) => s.user_id !== userId);
  if (others.length === 0) {
    return 'nobody';
  }
  return others.every((s) => s.user.is_robot) ? 'robots' : 'people';
}

/**
 * The second half of a Leave confirmation: what becomes of the table. Without
 * the table at hand it can only say what may happen.
 */
export function leaveNote(table: Table | null, userId: number | null): string {
  const left = table && userId !== null ? whoIsLeft(table, userId) : null;
  if (left === 'nobody') {
    return 'Your seat will be freed. Nobody else sits here, so the table is deleted.';
  }
  if (left === 'robots') {
    return `Your seat will be freed. Only robots are left: the table waits ${UNATTENDED_MINUTES} minutes for somebody to take it over, then it is deleted.`;
  }
  if (left === 'people') {
    return 'Your seat will be freed.';
  }
  return 'Your seat will be freed. If nobody is left, the table is deleted.';
}

/**
 * What moving off `from` costs, one sentence each: taking a seat at another
 * table frees the old one with every consequence of leaving it
 * (bridge_backend docs/API.md, POST /tables/{table}/seats). `phase` is that
 * table's board, when known: a finished one isn't abandoned.
 */
export function moveConsequences(from: Table, userId: number, phase: Phase | null = null): string[] {
  const label = tableLabel(from);
  const mySeat = from.seats.find((s) => s.user_id === userId)?.seat;
  const lines = [`You give up ${mySeat ? `seat ${mySeat} at ` : 'your seat at '}${label} for good.`];
  const left = whoIsLeft(from, userId);
  if (left === 'nobody') {
    lines.push(`Nobody else sits there, so ${label} will be deleted.`);
  } else if (left === 'robots') {
    lines.push(
      `Only robots are left there: ${label} waits ${UNATTENDED_MINUTES} minutes for somebody to take it over, then it is deleted.`,
    );
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
 * (bridge_backend docs/API.md, POST /tables/{table}/playing/next). Empty
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
