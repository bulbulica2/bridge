import { toastController } from '@ionic/vue';

/**
 * A short bottom toast. It lives in the app's overlay layer, not in the page,
 * so it survives a navigation: present it after navigating and it shows on
 * the page the user lands on.
 */
export async function showToast(message: string, color: 'success' | 'warning' | 'danger') {
  const toast = await toastController.create({
    message,
    duration: 4000,
    color,
    position: 'bottom',
  });
  await toast.present();
}
