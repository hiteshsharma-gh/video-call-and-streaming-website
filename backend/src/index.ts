import express from 'express';
import { Server } from 'http';
import { Mediasoup } from './mediasoup/index';
import { SignalingServer } from './signaling/index';
import { config } from 'dotenv';

config();

const app = express();
const httpServer = new Server(app);

Mediasoup.getWorker();
new SignalingServer(httpServer).init();

httpServer.listen(process.env.PORT, () => {
  console.log('Server is running on port ', process.env.PORT);
});
