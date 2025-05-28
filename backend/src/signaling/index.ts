import { Server } from 'http';
import { WebSocketServer } from 'ws';
import type { types as MediasoupTypes } from 'mediasoup';
import { Mediasoup } from '../mediasoup/index.js';
import { INCOMING_EVENT_NAMES, OUTGOING_EVENT_NAMES } from './constants.js';
import { v4 as uuid } from 'uuid';
import { ExtWebSocket } from './interface.js';

export class SignalingServer {
  wss: WebSocketServer;
  private clients: Map<
    string,
    {
      socket?: ExtWebSocket;
      roomId?: string;
      router?: MediasoupTypes.Router;
      consumers?: MediasoupTypes.Consumer[];
      producer?: MediasoupTypes.Producer;
      consumerTransport?: MediasoupTypes.WebRtcTransport;
      producerTransport?: MediasoupTypes.WebRtcTransport;
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

        socket.send(
          JSON.stringify({
            event: OUTGOING_EVENT_NAMES.CONNECTION_SUCCESS,
            data: {},
          }),
        );
        console.log('Signaling Server ---- Connection Successful, clientId: ', socket.id);

        socket.on('close', () => {
          console.log('client closed');
          this.clients.delete(socket.id);
        });

        socket.on('message', async (message: string) => {
          const { event, data } = JSON.parse(message);

          switch (event) {
            case INCOMING_EVENT_NAMES.JOIN_ROOM: {
              const { roomId } = data;

              const router = await this.mediasoupClient.createRouter(roomId);

              console.log('Signaling Server ---- room joined: ', roomId);

              this.clients.set(socket.id, {
                router,
                roomId,
              });

              if (!router) {
                console.log('Signaling Server ---- router not found');
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

              console.log('Signaling Server ---- router rtp capabilities sent');

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
                  console.log('Signaling Server ---- Producer Transport created: ', socket.id);
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
                  console.log('Signaling Server ---- Consumer Transport created: ', socket.id);

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

                  console.log('Signaling Server ---- Existing clients list: ', existingClients);
                }
              } else {
                console.log('Signaling Server ---- connection not created yet');
              }
              break;
            }

            case INCOMING_EVENT_NAMES.CONNECT_TRANSPORT: {
              const { sender, dtlsParameters } = data;
              const client = this.clients.get(socket.id);

              if (sender) {
                if (!client?.producerTransport) {
                  console.log('Signaling Server ---- Transport not found');
                }

                await client?.producerTransport?.connect({ dtlsParameters });

                console.log('Signaling Server ---- Producer Transport connected');

                const roomId = this.clients.get(socket.id)?.roomId;

                for (const client of this.clients.values()) {
                  if (client.roomId === roomId) {
                    if (client.socket !== socket && client.socket?.readyState === WebSocket.OPEN) {
                      client.socket.send(
                        JSON.stringify({
                          event: OUTGOING_EVENT_NAMES.NEW_PRODUCER_TRANSPORT_CREATED,
                          data: {
                            newClientId: socket.id,
                          },
                        }),
                      );
                      console.log(
                        'Signaling Server ---- new producer transport created event sent',
                      );
                    }
                  }
                }
              } else {
                if (!client?.consumerTransport) {
                  console.log('Signaling Server ---- Transport not found');
                }

                await client?.consumerTransport?.connect({ dtlsParameters });

                console.log('Signaling Server ---- Consumer Transport connected');
              }
              break;
            }

            case INCOMING_EVENT_NAMES.PRODUCE_MEDIA: {
              const { kind, rtpParameters } = data;
              const client = this.clients.get(socket.id);

              if (!client?.producerTransport) {
                console.log('Signaling Server ---- Producer transport not found');
              }

              const producer = await client?.producerTransport?.produce({ kind, rtpParameters });

              producer?.on('transportclose', () => {
                console.log('Signaling Server ---- Producer Transport close');
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
              console.log('Signaling Server ---- Producing media');

              break;
            }

            case INCOMING_EVENT_NAMES.CONSUME_MEDIA: {
              const { rtpCapabilities, producerId } = data;
              const producerClient = this.clients.get(producerId);
              const client = this.clients.get(socket.id);

              if (producerClient) {
                const { producer, router } = producerClient;

                if (producer) {
                  if (!router?.canConsume({ producerId: producer.id, rtpCapabilities })) {
                    console.error('Signaling Server ---- cannot consume');
                    return;
                  }

                  if (!client) {
                    console.log('Signaling Server ---- Client not found');
                    return;
                  }

                  const consumer = await client.consumerTransport?.consume({
                    rtpCapabilities,
                    producerId: producer.id,
                  });

                  consumer?.on('producerclose', () => {
                    console.log('Signaling Server ---- Producer closed');
                    consumer.close();
                  });

                  if (consumer) {
                    client?.consumers?.push(consumer);
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
                  console.log('Signaling Server ---- Consuming media');
                }
              }
              break;
            }

            case INCOMING_EVENT_NAMES.RESUME_CONSUME: {
              const client = this.clients.get(socket.id);

              client?.consumers?.forEach((consumer) => {
                consumer.resume();
              });
              console.log('Signaling Server ---- resuming consume');

              break;
            }

            case INCOMING_EVENT_NAMES.DISCONNECT: {
              this.clients.delete(socket.id);
              console.log('Signaling Server ---- User got disconnected: ', socket.id);
            }
          }
        });
      });
    } catch (error) {
      console.log('Signaling Server ---- Error while connecting to the signaling server: ', error);
    }
  }
}
