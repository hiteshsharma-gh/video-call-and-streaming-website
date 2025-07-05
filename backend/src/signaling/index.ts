import { Server } from 'http';
import { WebSocketServer } from 'ws';
import type { types as MediasoupTypes } from 'mediasoup';
import { Mediasoup } from '../mediasoup/index.js';
import { INCOMING_EVENT_NAMES, OUTGOING_EVENT_NAMES } from './constants.js';
import { v4 as uuid } from 'uuid';
import { ExtWebSocket } from './interface.js';
import fs from 'fs';

export class SignalingServer {
  wss: WebSocketServer;
  private clients: Map<
    string,
    {
      socket?: ExtWebSocket;
      roomId?: string;
      router?: MediasoupTypes.Router;
      ffmpegRtpPort?: number;
      consumers?: MediasoupTypes.Consumer[];
      producer?: MediasoupTypes.Producer;
      ffmpegConsumer?: MediasoupTypes.Consumer;
      consumerTransport?: MediasoupTypes.WebRtcTransport;
      producerTransport?: MediasoupTypes.WebRtcTransport;
      ffmpegPlainTransport?: MediasoupTypes.PlainTransport;
    }
  >;
  mediasoupClient: Mediasoup;

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer });
    this.clients = new Map();
    this.mediasoupClient = new Mediasoup();
  }

  async init() {
    try {
      this.wss.on('connection', (socket: ExtWebSocket) => {
        socket.id = uuid();
        this.clients.set(socket.id, { socket });

        socket.send(
          JSON.stringify({
            event: OUTGOING_EVENT_NAMES.CONNECTION_SUCCESS,
            data: {},
          }),
        );
        console.log('Signaling Server ---- Connection Successful, clientId: ', socket.id);

        socket.on('close', () => {
          console.log('client closed');
          const client = this.clients.get(socket.id);
          if (!client) {
            console.error('Signaling Server ---- client is undefined on socket close');
            return;
          }

          for (const user of this.clients.values()) {
            if (user.roomId === client.roomId) {
              if (!user.socket) {
                console.error('Signaling Server ---- user socket is undefined on socket close');
                return;
              }

              if (!user.producer) {
                console.error('Signaling Server ---- producer not found');
                return;
              }
              if (user.socket !== socket && user.socket.readyState === WebSocket.OPEN) {
                user.socket.send(
                  JSON.stringify({
                    event: OUTGOING_EVENT_NAMES.DISCONNECT,
                    data: {
                      userId: user.socket.id,
                      disconnectedClient: user.producer.id,
                    },
                  }),
                );
              }
            }
          }

          this.clients.delete(socket.id);
        });

        socket.on('message', async (message: string) => {
          const { event, data } = JSON.parse(message);
          console.log('Signaling Server ---- event recieved: ', event, socket.id);

          switch (event) {
            case INCOMING_EVENT_NAMES.JOIN_ROOM: {
              const { roomId } = data;

              const router = await this.mediasoupClient.createRouter(roomId);

              const client = this.clients.get(socket.id);
              if (!client) {
                console.error('Signaling Server ---- client not found');
                return;
              }

              client.router = router;
              client.roomId = roomId;

              if (!router) {
                console.error('Signaling Server ---- router not found');
                return;
              }

              socket.send(
                JSON.stringify({
                  event: OUTGOING_EVENT_NAMES.ROUTER_RTP_CAPABILITIES,
                  data: {
                    rtpCapabilities: router.rtpCapabilities,
                  },
                }),
              );

              break;
            }

            case INCOMING_EVENT_NAMES.CREATE_TRANSPORT: {
              const { sender } = data;
              const client = this.clients.get(socket.id);

              if (client?.router) {
                if (sender) {
                  const transport = await this.mediasoupClient.createWebRtcTransport(client.router);

                  client.producerTransport = transport;

                  socket.send(
                    JSON.stringify({
                      event: OUTGOING_EVENT_NAMES.TRANSPORT_CREATED,
                      data: {
                        params: {
                          id: transport.id,
                          iceParameters: transport.iceParameters,
                          iceCandidates: transport.iceCandidates,
                          dtlsParameters: transport.dtlsParameters,
                        },
                        sender: true,
                      },
                    }),
                  );
                } else {
                  const transport = await this.mediasoupClient.createWebRtcTransport(client.router);

                  client.consumerTransport = transport;

                  socket.send(
                    JSON.stringify({
                      event: OUTGOING_EVENT_NAMES.TRANSPORT_CREATED,
                      data: {
                        params: {
                          id: transport.id,
                          iceParameters: transport.iceParameters,
                          iceCandidates: transport.iceCandidates,
                          dtlsParameters: transport.dtlsParameters,
                        },
                        sender: false,
                      },
                    }),
                  );

                  const existingClients: string[] = [];
                  this.clients.forEach((_, key) => {
                    if (key !== socket.id) {
                      existingClients.push(key);
                    }
                  });

                  socket.send(
                    JSON.stringify({
                      event: OUTGOING_EVENT_NAMES.EXISTING_CLIENTS_LIST,
                      data: {
                        existingClients,
                      },
                    }),
                  );
                }
              } else {
                console.error('Signaling Server ---- connection not created yet');
              }
              break;
            }

            case INCOMING_EVENT_NAMES.CONNECT_TRANSPORT: {
              const { sender, dtlsParameters } = data;
              const client = this.clients.get(socket.id);

              if (sender) {
                if (!client?.producerTransport) {
                  console.error('Signaling Server ---- Transport not found');
                }

                await client?.producerTransport?.connect({ dtlsParameters });

                const roomId = this.clients.get(socket.id)?.roomId;

                if (!roomId) {
                  console.error('Signaling Server ---- roomId is undefined');
                }

                for (const user of this.clients.values()) {
                  if (user.roomId === roomId) {
                    if (!user.socket) {
                      console.error('user socket is undefined');
                      return;
                    }
                    if (user.socket !== socket && user.socket.readyState === WebSocket.OPEN) {
                      user.socket.send(
                        JSON.stringify({
                          event: OUTGOING_EVENT_NAMES.NEW_PRODUCER_TRANSPORT_CREATED,
                          data: {
                            newClientId: user.socket.id,
                          },
                        }),
                      );
                    }
                  }
                }
              } else {
                if (!client?.consumerTransport) {
                  console.error('Signaling Server ---- Transport not found');
                }

                await client?.consumerTransport?.connect({ dtlsParameters });
              }
              break;
            }

            case INCOMING_EVENT_NAMES.PRODUCE_MEDIA: {
              const { kind, rtpParameters } = data;
              const client = this.clients.get(socket.id);
              if (!client) {
                console.error('Signaling Server ---- client not found in produce media event');
                return;
              }

              if (!client.producerTransport) {
                console.error('Signaling Server ---- Producer transport not found');
                return;
              }
              const producer = await client.producerTransport?.produce({ kind, rtpParameters });

              const plainTransport = await client.router?.createPlainTransport({
                listenIp: { ip: '127.0.0.1' },
                rtcpMux: false,
                comedia: false,
              });

              await plainTransport?.connect({
                ip: '127.0.0.1',
                port: 5004,
                rtcpPort: 5005,
              });

              const consumer = await plainTransport?.consume({
                producerId: producer.id,
                rtpCapabilities: client.router!.rtpCapabilities!,
              });

              const FFMPEG_IP = '127.0.0.1'; // Or your server's IP
              const FFMPEG_VIDEO_PORT = 5004;

              let sdp = `v=0
o=- 0 0 IN IP4 ${FFMPEG_IP}
s=FFmpeg
c=IN IP4 ${FFMPEG_IP}
t=0 0
`;

              // Video Section
              if (consumer) {
                const vc = consumer.rtpParameters.codecs[0];
                sdp += `m=video ${FFMPEG_VIDEO_PORT} RTP/AVP ${vc.payloadType}\n`;
                sdp += `a=rtcp:${FFMPEG_VIDEO_PORT + 1}\n`;
                // This line is CRITICAL. It gets the real codec name and clock rate.
                sdp += `a=rtpmap:${vc.payloadType} ${vc.mimeType.split('/')[1]}/${vc.clockRate}\n`;
                // This line includes other important codec parameters like packetization-mode.
                if (vc.parameters) {
                  const params = Object.entries(vc.parameters)
                    .map(([key, value]) => `${key}=${value}`)
                    .join(';');
                  if (params) {
                    sdp += `a=fmtp:${vc.payloadType} ${params}\n`;
                  }
                }
              }

              fs.writeFileSync('./src/signaling/stream.sdp', sdp);

              await consumer?.requestKeyFrame();

              console.log('PlainTransport created and connected');

              if (!client.roomId) {
                console.error('Signaling Server ---- roomId not found');
                return;
              }
              if (!client.router) {
                console.error('Signaling Server ---- router not found');
                return;
              }

              producer?.on('transportclose', () => {
                if (!client.roomId) {
                  console.error('Signaling Server ---- roomId not found');
                  return;
                }

                producer.close();
              });

              if (client) {
                client.producer = producer;
              }

              socket.send(
                JSON.stringify({
                  event: OUTGOING_EVENT_NAMES.PRODUCING_MEDIA,
                  data: {
                    id: producer?.id,
                  },
                }),
              );

              break;
            }

            case INCOMING_EVENT_NAMES.CONSUME_MEDIA: {
              const { rtpCapabilities, producerId } = data;
              const producerClient = this.clients.get(producerId);
              const client = this.clients.get(socket.id);

              if (producerClient?.socket?.id == client?.socket?.id) {
                console.log('producer and client are same');
              }

              if (!producerClient) {
                console.error('producer client not found');
                return;
              }

              const { producer, router } = producerClient;
              console.error('producer not found');
              if (!producer) {
                return;
              }

              if (!router?.canConsume({ producerId: producer.id, rtpCapabilities })) {
                console.error('Signaling Server ---- cannot consume');
                return;
              }

              if (!client) {
                console.error('Signaling Server ---- Client not found');
                return;
              }

              const consumer = await client.consumerTransport?.consume({
                rtpCapabilities,
                producerId: producer.id,
              });

              if (!consumer) {
                console.error('Signaling Server ---- consumer not found');
                return;
              }

              consumer.on('producerclose', () => {
                consumer.close();
              });

              if (consumer) {
                client.consumers?.push(consumer);
              }

              socket.send(
                JSON.stringify({
                  event: OUTGOING_EVENT_NAMES.CONSUMING_MEDIA,
                  data: {
                    params: {
                      producerId: producer.id,
                      id: consumer?.id,
                      kind: consumer?.kind,
                      rtpParameters: consumer?.rtpParameters,
                    },
                  },
                }),
              );
              break;
            }

            case INCOMING_EVENT_NAMES.RESUME_CONSUME: {
              const client = this.clients.get(socket.id);

              client?.consumers?.forEach((consumer) => {
                consumer.resume();
              });

              break;
            }
          }
        });
      });
    } catch (error) {
      console.error(
        'Signaling Server ---- Error while connecting to the signaling server: ',
        error,
      );
    }
  }
}
