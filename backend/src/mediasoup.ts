import * as mediasoup from "mediasoup"

let worker: mediasoup.types.Worker<mediasoup.types.AppData>;
let router: mediasoup.types.Router<mediasoup.types.AppData>;

let producerTransport:
  | mediasoup.types.WebRtcTransport<mediasoup.types.AppData>
  | undefined;
let consumerTransport:
  | mediasoup.types.WebRtcTransport<mediasoup.types.AppData>
  | undefined;

let producer: mediasoup.types.Producer<mediasoup.types.AppData> | undefined;
let consumer: mediasoup.types.Consumer<mediasoup.types.AppData> | undefined;

export async function createWorker() {
  worker = await mediasoup.createWorker();

  console.log(`Mediasoup ---- Worker created process ID ${worker.pid}`);

  worker.on("died", () => {
    console.error("Mediasoup ---- mediasoup worker has died");
    setTimeout(() => {
      process.exit();
    }, 2000);
  });
};

const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

export async function createRouter() {
  router = await worker.createRouter({ mediaCodecs: mediaCodecs })
}

export function getRouterCapabilities() {
  return router.rtpCapabilities
}

export async function createTransport(sender: boolean) {
  if (sender) {
    producerTransport = await createWebRtcTransport()
    return producerTransport
  } else {
    consumerTransport = await createWebRtcTransport()
    return consumerTransport
  }
}

async function createWebRtcTransport() {
  try {
    const webRtcTransportOptions = {
      listenIps: [
        {
          ip: process.env.MEDIASOUP_IP || "127.0.0.1",
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    const transport = await router.createWebRtcTransport(
      webRtcTransportOptions
    );

    console.log(`Mediasoup ---- Transport created: ${transport.id}`);

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        transport.close();
      }
    });

    transport.on("@close", () => {
      console.log("Mediasoup ---- Transport closed");
    });

    return transport;
  } catch (error) {
    console.log("Mediasoup ---- error while creating transport: ", error);
  }
};

export async function connectProducerTransport({ dtlsParameters }: { dtlsParameters: mediasoup.types.DtlsParameters }) {
  await producerTransport?.connect({ dtlsParameters })
}

export async function transportProduce(
  { kind, rtpParameters }: { kind: mediasoup.types.MediaKind, rtpParameters: mediasoup.types.RtpParameters },
): Promise<mediasoup.types.Producer | undefined> {
  producer?.on('transportclose', () => {
    console.log("Mediasoup ---- Producer transport close")
    producer?.close()
  })

  return await producerTransport?.produce({ kind, rtpParameters })
}

export async function connectConsumerTransport({ dtlsParameters }: { dtlsParameters: mediasoup.types.DtlsParameters }) {
  await consumerTransport?.connect({ dtlsParameters })
}

export async function consumeMedia(
  { rtpCapabilities }: { rtpCapabilities: mediasoup.types.RtpCapabilities },
) {
  try {
    if (producer) {
      if (!router.canConsume({ producerId: producer?.id, rtpCapabilities })) {
        console.error("Mediasoup ---- Cannot consume");
        return;
      }
      console.log("Mediasoup ---- -------> consume");

      consumer?.on("transportclose", () => {
        console.log("Mediasoup ---- Consumer transport closed");
        consumer?.close();
      });

      consumer?.on("producerclose", () => {
        console.log("Mediasoup ---- Producer closed");
        consumer?.close();
      });

      return await consumerTransport?.consume({
        producerId: producer?.id,
        rtpCapabilities,
        paused: producer?.kind === "video",
      });

    }
  } catch (error) {
    console.error("Mediasoup ---- Error consuming: ", error);
  }
}
