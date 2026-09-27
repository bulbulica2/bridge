import { alertController } from '@ionic/vue';
import type { Table } from '@/services/tables';

function tableLabel(table: Pick<Table, 'id' | 'name'>) {
  return table.name || `table #${table.id}`;
}

/**
 * What moving off `from` costs, one sentence each: taking a seat at another
 * table frees the old one with every consequence of leaving it
 * (bridge_docs/backend/API.md, POST /tables/{table}/seats).
 */
export function moveConsequences(from: Table, userId: number): string[] {
  const label = tableLabel(from);
  const mySeat = from.seats.find((s) => s.user_id === userId)?.seat;
  const lines = [`You give up ${mySeat ? `seat ${mySeat} at ` : 'your seat at '}${label} for good.`];
  if (from.seats.every((s) => s.user_id === userId)) {
    lines.push(`Nobody else sits there, so ${label} will be deleted.`);
  } else {
    if (from.moderated_by === userId) {
      lines.push(`You manage ${label}; that role passes to another player.`);
    }
    if (from.board_id !== null) {
      lines.push(`The board in progress there will be abandoned for the other three players.`);
    }
  }
  return lines;
}

/** Asks before a seat request that moves the user off another table. */
export async function confirmMove(from: Table, to: Pick<Table, 'id' | 'name'>, userId: number) {
  const alert = await alertController.create({
    header: `Move to ${tableLabel(to)}?`,
    message: moveConsequences(from, userId).join(' '),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Move', role: 'confirm' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role === 'confirm';
}
