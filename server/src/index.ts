import http from 'node:http';
import express from 'express';
import { attachMultiplayerServer } from './app.ts';

function startServer(): void {
  const app = express();
  const httpServer = http.createServer(app);

  attachMultiplayerServer(app, httpServer, { exposeRootHealth: true });

  const port = Number(process.env.PORT || 3001);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`PUNO Socket.IO server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
