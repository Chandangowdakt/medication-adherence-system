/* global importScripts, firebase */
/**
 * FCM background handler. Must match the web app Firebase config (same as VITE_FIREBASE_* in .env).
 * Replace firebaseConfig below with values from Firebase Console → Project settings → Your web app.
 * Version pins should match the firebase package in package.json when possible.
 */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

firebase.initializeApp(firebaseConfig);
firebase.messaging();
