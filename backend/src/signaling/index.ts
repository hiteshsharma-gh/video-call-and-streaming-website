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
                            newClientId: socket.id,
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

              if (!client?.producerTransport) {
                console.error('Signaling Server ---- Producer transport not found');
              }

              const producer = await client?.producerTransport?.produce({ kind, rtpParameters });

              producer?.on('transportclose', () => {
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

              if (!producerClient) {
                console.error('producer client not found');
                return;
              }

              const { producer, router } = producerClient;
              if (!producer) {
                console.error('producer not found');
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

            case INCOMING_EVENT_NAMES.DISCONNECT: {
              this.clients.delete(socket.id);
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
