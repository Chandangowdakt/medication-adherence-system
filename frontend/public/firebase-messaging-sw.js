importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCbc88HmBFUNfEjg8tFYhXYsg24Ux9W8",
  authDomain: "med-adherence-new.firebaseapp.com",
  projectId: "med-adherence-new",
  messagingSenderId: "64859146202",
  appId: "1:64859146202:web:961f53d0be03f39b1362e3",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  const title = payload?.notification?.title || "💊 Medicine Reminder";
  const body = payload?.notification?.body || "Time to take your medicine!";
  self.registration.showNotification(title, {
    body,
    icon: "/favicon.svg",
  });
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
