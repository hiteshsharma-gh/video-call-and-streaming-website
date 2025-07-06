import express from 'express';
import { Server } from 'http';
import { SignalingServer } from './signaling/index';
import 'dotenv/config';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

const httpServer = new Server(app);

new SignalingServer(httpServer).init();

const HLS_OUTPUT_DIR = path.join(__dirname, 'public/hls');

app.use('/watch', express.static(HLS_OUTPUT_DIR));

httpServer.listen(process.env.PORT, () => {
  console.log('Server is running on port ', process.env.PORT);
});
