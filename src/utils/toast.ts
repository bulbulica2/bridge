import { toastController } from '@ionic/vue';
import { handLeftOutline } from 'ionicons/icons';

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

/**
 * The greeting after login or sign-up: top of the screen, a waving hand, and
 * a pop-in (styled by `.welcome-toast` in src/theme/toasts.css).
 */
export async function showWelcomeToast(message: string) {
  const toast = await toastController.create({
    message,
    duration: 3000,
    color: 'primary',
    position: 'top',
    icon: handLeftOutline,
    cssClass: 'welcome-toast',
  });
  await toast.present();
}
