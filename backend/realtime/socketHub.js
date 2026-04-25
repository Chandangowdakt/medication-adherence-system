import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

let io = null;

/**
 * Attach Socket.io to the same HTTP server as Express. CORS must match the web app.
 */
export function initSocket(httpServer, { corsOrigins = [] } = {}) {
  const origin =
    typeof corsOrigins === 'string'
      ? corsOrigins
      : Array.isArray(corsOrigins) && corsOrigins.length > 0
        ? corsOrigins
        : true;

  io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || typeof token !== 'string' || !token.trim()) {
        return next(new Error('unauthorized'));
      }
      const secret = process.env.JWT_SECRET;
      if (!secret) return next(new Error('server_misconfig'));
      const decoded = jwt.verify(token.trim(), secret);
      const userId = decoded?.userId;
      if (!userId) return next(new Error('unauthorized'));
      socket.userId = String(userId);
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.userId;
    if (uid) {
      socket.join(`user:${uid}`);
    }
  });

  return io;
}

/**
 * Notify one user that their dashboard-related data changed (dose, med, side effect, etc.).
 */
export function emitUserDataChanged(userId) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit('data:changed', {
    scope: 'dashboard',
    at: new Date().toISOString(),
  });
}

export function isSocketReady() {
  return io != null;
}
