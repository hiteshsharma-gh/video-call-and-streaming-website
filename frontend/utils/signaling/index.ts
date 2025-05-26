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

type Params = {
  encoding: {
    rid: string;
    maxBitrate: number;
    scalabilityMode: string;
  }[];
  codecOptions: {
    videoGoogleStartBitrate: number;
  };
  track?: MediaStreamTrack;
};

export function useSignalingServer(roomId: string) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [videoRefs, setVideoRefs] = useState<RefObject<HTMLVideoElement | null>[]>([]);

  const [params, setParams] = useState<Params>({
    encoding: [
      { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' }, // Lowest quality layer
      { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' }, // Middle quality layer
      { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' }, // Highest quality layer
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 }, // Initial bitrate
    track: undefined,
  });

  const [socket, setSocket] = useState<WebSocket | undefined>(undefined);
  const [device, setDevice] = useState<Device | undefined>(undefined);
  const rtpCapabilities = useRef<RtpCapabilities>(undefined)
  const [producerTransport, setProducerTransport] =
    useState<Transport | undefined>(undefined);
  const [consumerTransport, setConsumerTransport] =
    useState<Transport | undefined>(undefined);
  const [consumerList, setConsumerList] = useState<Record<string, Consumer>>({});
  const [isProducerTransportConnected, setIsProducerTransportConnected] =
    useState(false);

  const startCamera = useCallback(async () => {
    try {
      const videoStream = await navigator.mediaDevices?.getUserMedia({
        video: true,
      });
      if (localVideoRef?.current) {
        localVideoRef.current.srcObject = videoStream;
        const track = videoStream?.getVideoTracks()[0];
        setParams((current) => ({ ...current, track }));
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

      setDevice(newDevice);
      return newDevice;
    } catch (error) {
      console.error('Error while creating Mediasoup Device: ', error);
      return undefined;
    }
  }

  const connectSendTransport = useCallback(async () => {
    const producer = await producerTransport?.produce(params);

    producer?.on('trackended', () => {
      console.log('trackended');
    });

    producer?.on('transportclose', () => {
      console.log('transportclose');
    });
  }, [params, producerTransport])

  useEffect(() => {
    let triggerCallbackFromOutside: ((data: unknown) => void) | null = null;

    if (!socket) {
      const newSocket = new WebSocket('ws://localhost:8000');
      setSocket(newSocket);

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
              rtpCapabilities.current = data.rtpCapabilities as RtpCapabilities;
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
                let currentDevice = device;
                if (!currentDevice) {
                  console.log("router rtp capabilities: ", rtpCapabilities)
                  currentDevice = await createDevice(rtpCapabilities.current as RtpCapabilities)
                }

                const transport = currentDevice?.createSendTransport({
                  ...data.params
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

                setProducerTransport(transport);
              } else {
                let currentDevice = device;
                if (!currentDevice) {
                  currentDevice = await createDevice(rtpCapabilities.current as RtpCapabilities)
                }

                const transport = currentDevice?.createRecvTransport({
                  ...data.params
                });

                setConsumerTransport(transport);

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
                    rtpCapabilities,
                    producerId: data.id,
                  },
                })
              );

              break;
            }

            case INCOMING_EVENT_NAMES.EXISTING_CLIENTS_LIST: {
              console.log('existing clients list: ', data.existingClients);

              for (const client of data.existingClients) {
                newSocket.send(
                  JSON.stringify({
                    event: OUTGOING_EVENT_NAMES.CONSUME_MEDIA,
                    data: {
                      rtpCapabilities,
                      producerId: client,
                    },
                  })
                );
              }

              break;
            }

            case INCOMING_EVENT_NAMES.CONSUMING_MEDIA: {
              const consumer = await consumerTransport?.consume({
                ...data.params
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
        setSocket(undefined);

        newSocket.send(JSON.stringify({
          event: OUTGOING_EVENT_NAMES.DISCONNECT
        }))
      };

      return () => {
        // console.log('Closing WebSocket connection');
        // newSocket.close();
      };
    }
  }, [socket, consumerTransport, device, roomId, startCamera]);

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
    if (rtpCapabilities && !device) {
      createDevice(rtpCapabilities.current as RtpCapabilities);
    }
  }, [rtpCapabilities, device]);

  useEffect(() => {
    console.log('producerTransport===', producerTransport);
    if (
      device &&
      producerTransport &&
      params?.track &&
      !isProducerTransportConnected
    ) {
      setIsProducerTransportConnected(true);
      connectSendTransport();
    }
  }, [device, producerTransport, params, isProducerTransportConnected, connectSendTransport]);

  return {
    localVideoRef,
    videoRefs,
    consumerList,
  };
}
