/**
 * Notifications des alertes (Web Push). À la première activation du canal Notification :
 * demande de permission, puis abonnement de l'appareil auprès du serveur. La notification
 * elle-même est affichée par le service worker (`public/push-sw.js`).
 */
import { api } from './api';

export type PushOutcome =
  /** L'appareil est abonné. */
  | 'enabled'
  /** iPhone ou iPad hors appli installée : les notifications demandent l'appli sur l'écran d'accueil. */
  | 'install'
  /** La permission a été refusée, ici ou dans les réglages du navigateur. */
  | 'denied'
  /** Ce navigateur ne sait pas recevoir de notifications, ou le service worker n'est pas là (serveur de dev). */
  | 'unsupported';

const isIos = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = (): boolean => (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

/** Sur iPhone, les notifications web n'arrivent qu'à l'appli installée sur l'écran d'accueil (iOS 16.4 et plus). */
export const needsInstall = (): boolean => isIos() && !isStandalone();

const supported = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Le service worker de l'appli, s'il est enregistré. Il n'existe pas avec le serveur de dev. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return navigator.serviceWorker.ready;
}

/** La clé VAPID publique, de base64url vers les octets que demande `pushManager.subscribe`. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Active les notifications sur cet appareil : permission, abonnement Web Push, envoi au serveur. */
export async function enablePush(): Promise<PushOutcome> {
  if (needsInstall()) return 'install';
  const reg = await registration();
  if (!reg) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const { key } = await api<{ key: string }>('/api/push/key');
  const subscription = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api('/api/push/subscriptions', { json: subscription.toJSON() });
  return 'enabled';
}

/** L'appareil est-il déjà autorisé à recevoir des notifications ? */
export const pushGranted = (): boolean => supported() && !needsInstall() && Notification.permission === 'granted';

/**
 * À chaque ouverture connectée : si l'appareil est déjà abonné, son abonnement est renvoyé
 * au serveur. Le navigateur peut le renouveler sans prévenir, et il suit le compte connecté.
 */
export async function refreshPush(): Promise<void> {
  try {
    if (!pushGranted()) return;
    const subscription = await (await registration())?.pushManager.getSubscription();
    if (subscription) await api('/api/push/subscriptions', { json: subscription.toJSON() });
  } catch {
    // Rien à faire : l'abonnement repartira à la prochaine ouverture.
  }
}

/** À la déconnexion : cet appareil ne doit plus recevoir les alertes du compte. */
export async function forgetPush(): Promise<void> {
  try {
    const subscription = await (await registration())?.pushManager.getSubscription();
    if (subscription) await api('/api/push/subscriptions', { method: 'DELETE', json: { endpoint: subscription.endpoint } });
  } catch {
    // Le serveur supprimera l'abonnement quand le service de notification le refusera.
  }
}
