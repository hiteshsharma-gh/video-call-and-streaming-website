/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import {
  createRef,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Consumer,
  Device,
  DtlsParameters,
  MediaKind,
  RtpCapabilities,
  RtpParameters,
  Transport,
} from 'mediasoup-client/types';
import { INCOMING_EVENT_NAMES, OUTGOING_EVENT_NAMES } from './constants';

export function useSignalingServer(roomId: string) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [videoRefs, setVideoRefs] = useState<RefObject<HTMLVideoElement | null>[]>([]);

  const client = useRef<{
    params: {
      encoding?: {
        rid: string;
        maxBitrate: number;
        scalabilityMode: string;
      }[];
      codecOptions?: {
        videoGoogleStartBitrate: number;
      };
      track?: MediaStreamTrack;
    };
    socket?: WebSocket;
    device?: Device;
    rtpCapabilities?: RtpCapabilities
    consumerTransport?: Transport;
    producerTransport?: Transport;
  }>({
    params: {
      encoding: [
        { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' },
        { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' },
        { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' },
      ],
      codecOptions: {
        videoGoogleStartBitrate: 1000,
      },
    },
  });

  const [consumerList, setConsumerList] = useState<Record<string, Consumer>>({});
  const [isProducerTransportConnected, setIsProducerTransportConnected] = useState<boolean>(false)

  const startCamera = useCallback(async () => {
    try {
      const videoStream = await navigator.mediaDevices?.getUserMedia({
        video: true,
      });
      if (localVideoRef?.current) {
        localVideoRef.current.srcObject = videoStream;
        const track = videoStream?.getVideoTracks()[0];
        client.current.params = { ...client.current.params, track }
      }
    } catch (error) {
      console.error('Error in starting camera: ', error);
    }
  }, []);

  async function createDevice(rtpCapabilities: RtpCapabilities): Promise<Device | undefined> {
    try {
      if (!rtpCapabilities) {
        console.error('RTP Capabilities are undefined');
        return undefined
      }

      const newDevice = new Device();

      await newDevice.load({
        routerRtpCapabilities: rtpCapabilities,
      });

      client.current.device = newDevice
      return newDevice;
    } catch (error) {
      console.error('Error while creating Mediasoup Device: ', error);
      return undefined;
    }
  }

  async function connectSendTransport() {
    const producer = await client.current.producerTransport?.produce(client.current.params);

    producer?.on('trackended', () => {
      console.log('trackended');
    });

    producer?.on('transportclose', () => {
      console.log('transportclose');
    });
  }

  useEffect(() => {
    let triggerCallbackFromOutside: ((data: unknown) => void) | null = null;

    if (!client.current.socket) {
      const newSocket = new WebSocket('ws://localhost:8000');
      client.current.socket = newSocket

      newSocket.onopen = (event) => {
        console.log('socket open: ', event);
      };

      newSocket.onmessage = async (message) => {
        try {
          const { event, data } = JSON.parse(message.data);
          console.log('Received event:', event);

          switch (event) {
            case INCOMING_EVENT_NAMES.CONNECTION_SUCCESS: {
              console.log('connection successful');
              if (newSocket.readyState === WebSocket.OPEN) {
                newSocket.send(
                  JSON.stringify({
                    event: OUTGOING_EVENT_NAMES.JOIN_ROOM,
                    data: { roomId },
                  })
                );

                console.log('Join room signal sent');
                startCamera();
              } else {
                console.log("socket is not ready")
              }

              break;
            }

            case INCOMING_EVENT_NAMES.ROUTER_RTP_CAPABILITIES: {
              console.log('router rtp capabilities: ', data.rtpCapabilities);
              client.current.rtpCapabilities = data.rtpCapabilities
              createDevice(data.rtpCapabilities)

              if (newSocket.readyState === WebSocket.OPEN) {
                newSocket.send(
                  JSON.stringify({
                    event: OUTGOING_EVENT_NAMES.CREATE_TRANSPORT,
                    data: {
                      sender: true,
                    },
                  })
                );

                newSocket.send(
                  JSON.stringify({
                    event: OUTGOING_EVENT_NAMES.CREATE_TRANSPORT,
                    data: {
                      sender: false,
                    },
                  })
                );
              } else {
                console.log("socket is not ready yet")
              }

              break;
            }

            case INCOMING_EVENT_NAMES.TRANSPORT_CREATED: {
              console.log("transport created in server")
              if (data.sender) {
                let currentDevice = client.current.device;
                if (!currentDevice) {
                  console.log("router rtp capabilities: ", client.current.rtpCapabilities)
                  if (client.current.rtpCapabilities) {
                    currentDevice = await createDevice(client.current.rtpCapabilities)
                  } else {
                    console.error("rtpCapabilities undefined")
                  }
                }

                const transport = currentDevice?.createSendTransport({
                  id: data.id,
                  iceParameters: data.iceParameters,
                  iceCandidates: data.iceCandidates,
                  dtlsParameters: data.dtlsParameters,
                });

                console.log(
                  'producer transport created --------------> ',
                  transport,
                  currentDevice
                );

                transport?.on(
                  'connect',
                  async (
                    { dtlsParameters }: { dtlsParameters: DtlsParameters },
                    callback: () => void,
                    errback: (e: Error) => void
                  ) => {
                    try {
                      console.log('Producer transport has connected');

                      if (newSocket.readyState === WebSocket.OPEN) {

                        newSocket.send(
                          JSON.stringify({
                            event: OUTGOING_EVENT_NAMES.CONNECT_TRANSPORT,
                            data: {
                              dtlsParameters,
                              sender: true,
                            },
                          })
                        );

                        callback();
                      } else {
                        console.log("socket is not ready yet")
                      }
                    } catch (error) {
                      errback(error as Error);
                    }
                  }
                );

                transport?.on(
                  'produce',
                  async (
                    { kind, rtpParameters }: { kind: MediaKind; rtpParameters: RtpParameters },
                    callback: ({ id }: { id: string }) => void,
                    errback: (e: Error) => void
                  ) => {
                    try {
                      console.log('producing media');

                      newSocket.send(
                        JSON.stringify({
                          event: OUTGOING_EVENT_NAMES.PRODUCE_MEDIA,
                          data: {
                            kind,
                            rtpParameters,
                          },
                        })
                      );

                      triggerCallbackFromOutside = callback as (data: unknown) =>
                        void;
                    } catch (error) {
                      errback(error as Error);
                    }
                  }
                );

                client.current.producerTransport = transport
              } else {
                let currentDevice = client.current.device;
                if (!currentDevice) {
                  if (client.current.rtpCapabilities) {
                    currentDevice = await createDevice(client.current.rtpCapabilities)
                  } else {
                    console.error("rtpCapabilities undefined")
                  }
                }

                const transport = currentDevice?.createRecvTransport({
                  id: data.id,
                  iceParameters: data.iceParameters,
                  iceCandidates: data.iceCandidates,
                  dtlsParameters: data.dtlsParameters,
                });

                client.current.consumerTransport = transport

                transport?.on(
                  'connect',
                  async (
                    { dtlsParameters }: { dtlsParameters: DtlsParameters },
                    callback: () => void,
                    errback: (e: Error) => void
                  ) => {
                    try {
                      newSocket.send(
                        JSON.stringify({
                          event: OUTGOING_EVENT_NAMES.CONNECT_TRANSPORT,
                          data: {
                            sender: false,
                            dtlsParameters,
                          },
                        })
                      );

                      callback();

                      console.log('consumer tansport has connected');
                    } catch (error) {
                      errback(error as Error);
                    }
                  }
                );
              }
              break;
            }

            case INCOMING_EVENT_NAMES.PRODUCING_MEDIA: {
              if (triggerCallbackFromOutside) {
                triggerCallbackFromOutside({ id: data.id });
              }

              break;
            }

            case INCOMING_EVENT_NAMES.NEW_PRODUCER_TRANSPORT_CREATED: {
              console.log('connecting to new client joined');
              newSocket.send(
                JSON.stringify({
                  event: OUTGOING_EVENT_NAMES.CONSUME_MEDIA,
                  data: {
                    rtpCapabilities: client.current.rtpCapabilities,
                    producerId: data.id,
                  },
                })
              );

              break;
            }

            case INCOMING_EVENT_NAMES.EXISTING_CLIENTS_LIST: {
              console.log('existing clients list: ', data.existingClients);

              for (const Client of data.existingClients) {
                newSocket.send(
                  JSON.stringify({
                    event: OUTGOING_EVENT_NAMES.CONSUME_MEDIA,
                    data: {
                      rtpCapabilities: client.current.rtpCapabilities,
                      producerId: Client,
                    },
                  })
                );
              }

              break;
            }

            case INCOMING_EVENT_NAMES.CONSUMING_MEDIA: {
              const consumer = await client.current.consumerTransport?.consume({
                id: data.id,
                kind: data.kind,
                rtpParameters: data.rtpParameters,
                producerId: data.producerId,
              });

              if (consumer) {
                const { track } = consumer;

                console.log('track ------------> ', track);
                setConsumerList((prev) => {
                  return { ...prev, [data.id]: consumer };
                });
              }

              newSocket.send(
                JSON.stringify({
                  event: OUTGOING_EVENT_NAMES.RESUME_CONSUME,
                  data: {},
                })
              );

              console.log('consumer transport  has resumed');
              break;
            }

            default:
              console.warn('Unhandled event:', event);
          }
        } catch (error) {
          console.error('Error in signaling server: ', error);
        }
      };

      newSocket.onerror = (error) => {
        console.error('WebSocket error: ', error);
      };

      newSocket.onclose = () => {
        console.log('WebSocket connection closed');
        client.current.socket = undefined

      };

      return () => {
      };
    }
  }, []);

  useEffect(() => {
    const newRefs: typeof videoRefs = []
    Object.keys(consumerList).forEach((key, index) => {
      if (!videoRefs[index]) {
        newRefs[index] = createRef<HTMLVideoElement>()

        const { track } = consumerList[key]
        if (newRefs[index].current) {
          newRefs[index].current.srcObject = new MediaStream([track])
        }
      } else {
        newRefs[index] = videoRefs[index]
      }
    });

    setVideoRefs(newRefs)
  }, [consumerList]);

  useEffect(() => {
    console.log('producerTransport===', client.current.producerTransport);
    if (
      client.current.device &&
      client.current.producerTransport &&
      client.current.params?.track &&
      !isProducerTransportConnected
    ) {
      setIsProducerTransportConnected(true);
      connectSendTransport();
    }
  }, [isProducerTransportConnected]);

  return {
    localVideoRef,
    videoRefs,
    consumerList,
  };
}
