import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { RoomManager } from './rooms/RoomManager.js';
import { attachSocketHandlers } from './socket/handlers.js';
import { logger } from './utils/logger.js';

const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const allowedOrigins = CLIENT_URL.split(',').map((s) => s.trim());

const app = express();
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const roomManager = new RoomManager();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: roomManager.roomCount(), uptime: process.uptime() });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e6,
});

attachSocketHandlers(io, roomManager);

httpServer.listen(PORT, () => {
  logger.info(`SyncCanvas server listening on :${PORT}`);
  logger.info(`Accepting client origin(s): ${allowedOrigins.join(', ')}`);
});
