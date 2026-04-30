import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '../utils/authStorage.js';

/**
 * Subscribes to server push-over-WebSocket (Socket.io) for dashboard invalidation.
 * Connects to the same host as the API by default; override with VITE_SOCKET_URL.
 */
export function useAppSocket(onDataChanged) {
  const cb = useRef(onDataChanged);
  cb.current = onDataChanged;

  useEffect(() => {
    const token = getToken();
    if (!token) return undefined;

    const url = (import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || '').trim();
    if (!url) return undefined;
    const socket = io(url, {
      path: '/socket.io',
      auth: { token },
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
      transports: ['websocket', 'polling'],
    });

    const handler = () => cb.current?.();
    socket.on('data:changed', handler);

    return () => {
      socket.off('data:changed', handler);
      socket.close();
    };
  }, []);
}
