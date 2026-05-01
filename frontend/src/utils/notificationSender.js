import { LocalNotifications } from '@capacitor/local-notifications';

export function sendMedicationNotification() {
  console.log('🔥 sendNotification CALLED');

  const title = '💊 Medicine Reminder';
  const body = 'Time to take your medicine!';

  if (window.Capacitor?.isNativePlatform?.()) {
    try {
      LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now(),
            title,
            body,
            schedule: { at: new Date(Date.now() + 100) },
            sound: 'alert.mp3',
            vibration: true,
          },
        ],
      });
    } catch (e) {
      console.error('Notification error:', e);
    }
    return;
  }

  if ('Notification' in window) {
    const playAlertEffects = () => {
      try {
        const audio = new Audio('/alert.mp3');
        audio.play().catch(() => {});
      } catch {}
      navigator.vibrate?.([300, 200, 300]);
    };

    if (Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/favicon.svg',
      });
      playAlertEffects();
      alert(body);
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          new Notification(title, { body, icon: '/favicon.svg' });
          playAlertEffects();
          alert(body);
        } else {
          playAlertEffects();
          alert('Time to take your medicine!');
        }
      });
    } else {
      playAlertEffects();
      alert('Time to take your medicine!');
    }
  } else {
    navigator.vibrate?.([300, 200, 300]);
    alert('Time to take your medicine!');
  }
}
