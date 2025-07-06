import * as mediasoup from 'mediasoup';
import type { types as MediasoupTypes } from 'mediasoup';
import { MAX_NUMBER_OF_MEDIASOUP_WORKERS } from './constants';

export class Mediasoup {
  static workers: MediasoupTypes.Worker[] = [];
  static indexOfNextWorker: number = 0;
  static routers: Map<string, MediasoupTypes.Router> = new Map();

  static async getWorker() {
    if (this.workers.length < MAX_NUMBER_OF_MEDIASOUP_WORKERS) {
      const worker = await mediasoup.createWorker();
      this.workers.push(worker);

      console.log('Mediasoup ---- Worker Created: ', worker.pid);

      return worker;
    }

    const worker = this.workers[this.indexOfNextWorker];
    this.indexOfNextWorker = (this.indexOfNextWorker + 1) % MAX_NUMBER_OF_MEDIASOUP_WORKERS;
    console.log('Mediasoup ---- Worker Created: ', worker.pid);

    worker.on('died', () => {
      console.log('Mediasoup ---- Worker died: ', worker.pid);
      setInterval(() => process.exit(1), 1000);
    });

    return worker;
  }

  async createRouter(roomId: string) {
    if (Mediasoup.routers.has(roomId)) return Mediasoup.routers.get(roomId);

    const worker = await Mediasoup.getWorker();

    const router = await worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
      ],
    });

    Mediasoup.routers.set(roomId, router);
    console.log('Mediasoup ----- Router created, roomId: ', roomId);

    return router;
  }

  async createWebRtcTransport(router: MediasoupTypes.Router) {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: '127.0.0.1' }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    return transport;
  }

  async createPlainTransport(router: MediasoupTypes.Router) {
    const transport = await router.createPlainTransport({
      listenIp: { ip: '0.0.0.0', announcedIp: '127.0.0.1' },
      rtcpMux: false,
      comedia: true,
    });

    return transport;
  }
}
