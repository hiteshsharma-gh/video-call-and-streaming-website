import express from 'express';
import { Server } from 'http';
import { SignalingServer } from './signaling/index.js';
import { config } from 'dotenv';
import cors from 'cors';

config();

const app = express();
app.use(cors());

const httpServer = new Server(app);

new SignalingServer(httpServer).init();

httpServer.listen(process.env.PORT, () => {
  console.log('Server is running on port ', process.env.PORT);
});
