'use client'

import { INCOMING_EVENT_NAMES, OUTGOING_EVENT_NAMES } from "@/utils/signaling/constants";
import { Device } from "mediasoup-client";
import { Consumer, DtlsParameters, MediaKind, RtpCapabilities, RtpParameters, Transport } from "mediasoup-client/types";
import { createRef, RefObject, useCallback, useEffect, useRef, useState } from "react";

export default function useSignalingServer(roomId: string) {

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [videoRefs, setVideoRefs] = useState<Record<string, RefObject<HTMLVideoElement | null>>>({});

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
  const [params, setParams] = useState<Params>({
    encoding: [
      { rid: 'r0', maxBitrate: 100000, scalabilityMode: 'S1T3' }, // Lowest quality layer
      { rid: 'r1', maxBitrate: 300000, scalabilityMode: 'S1T3' }, // Middle quality layer
      { rid: 'r2', maxBitrate: 900000, scalabilityMode: 'S1T3' }, // Highest quality layer
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 }, // Initial bitrate
    track: undefined,
  });

  const socketRef = useRef<WebSocket | undefined>(undefined)
  const triggerCallbackAcrossEventsRef = useRef<(data: unknown) => void | undefined>(undefined)

  const [device, setDevice] = useState<Device | undefined>(undefined);
  const [rtpCapabilities, setRtpCapabilities] = useState<RtpCapabilities | undefined>(undefined)
  const [producerTransport, setProducerTransport] = useState<Transport | undefined>(undefined);
  const [isProducerTransportConnected, setIsProducerTransportConnected] = useState<boolean>(false)
  const [consumerTransport, setConsumerTransport] = useState<Transport | undefined>(undefined);
  const [consumerList, setConsumerList] = useState<Record<string, Consumer>>({});

  async function startCamera() {
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
      console.error('Error in accessing camera: ', error);
    }
  }

  const createDevice = useCallback(async () => {
    try {
      const newDevice = new Device()

      if (!rtpCapabilities) {
        console.error("rtp capabilities is undefined in createDevice")
        return
      }
      await newDevice.load({ routerRtpCapabilities: rtpCapabilities })
      setDevice(newDevice)

    } catch (error) {
      console.error("error in create device", error)
    }
  }, [rtpCapabilities])

  async function createSendTransport() {
    const socket = socketRef.current

    if (!socket) {
      console.error("socket is undefined in createSendTransport")
      return
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        event: OUTGOING_EVENT_NAMES.CREATE_TRANSPORT,
        data: {
          sender: true
        }
      }))
    } else {
      console.error("socket is not ready in createSendTransport")
    }
  }

  const connectSendTransport = useCallback(async () => {
    if (!producerTransport) {
      console.error("producer transport is undefined in connectSendTransport")
      return
    }

    await producerTransport.produce(params)

  }, [params, producerTransport])

  const createRecvTransport = useCallback(async () => {
    const socket = socketRef.current

    if (!socket) {
      console.error("socket is undefined in createSendTransport")
      return
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        event: OUTGOING_EVENT_NAMES.CREATE_TRANSPORT,
        data: {
          sender: false
        }
      }))
    } else {
      console.error("socket is not ready in createSendTransport")
    }
  }, [])

  const connectRecvTransport = useCallback(async (newClientId: string) => {
    if (!device) {
      console.error("device is undefined in connectRecvTransport")
      return
    }

    const socket = socketRef.current

    if (!socket) {
      console.error("socket is undefined in createSendTransport")
      return
    }

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        event: OUTGOING_EVENT_NAMES.CONSUME_MEDIA,
        data: {
          rtpCapabilities: device.rtpCapabilities,
          producerId: newClientId,
        }
      }))
    } else {
      console.error("socket is not ready in createSendTransport")
    }
  }, [device])


  useEffect(() => {
    if (!socketRef.current) {
      const url = process.env.NEXT_PUBLIC_WS_URL
      if (!url) {
        console.error("ws url not found")
        return
      }

      socketRef.current = new WebSocket(url);
    }
  }, [])

  useEffect(() => {
    const socket = socketRef.current

    if (!socket) {
      console.error("socket is undefined in the beginning")
      return;
    }

    socket.onmessage = async (message) => {
      try {
        const { event, data } = JSON.parse(message.data)
        console.log("event received: ", event)

        switch (event) {
          case INCOMING_EVENT_NAMES.CONNECTION_SUCCESS: {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                event: OUTGOING_EVENT_NAMES.JOIN_ROOM,
                data: {
                  roomId
                }
              }))
            } else {
              console.error("socket not open")
              return
            }

            await startCamera()

            break;
          }

          case INCOMING_EVENT_NAMES.DISCONNECT: {
            setConsumerList((prev) => {
              const { [data.disconnectedClient]: _, ...updated } = prev

              console.log("user id: ", data.userId)
              console.log("client to be removed from consumerlist: ", data.disconnectedClient)
              console.log("existing client list: ", prev)
              console.log("updated client list: ", updated)
              return updated
            })

            break;
          }

          case INCOMING_EVENT_NAMES.ROUTER_RTP_CAPABILITIES: {
            setRtpCapabilities(data.rtpCapabilities)

            break;
          }

          case INCOMING_EVENT_NAMES.TRANSPORT_CREATED: {
            if (data.sender) {
              if (!device) {
                console.error("device is undefined in transport-created event")
                return
              }

              const transport = device.createSendTransport(data.params)
              setProducerTransport(transport)

              transport?.on(
                'connect',
                async (
                  { dtlsParameters }: { dtlsParameters: DtlsParameters },
                  callback: () => void,
                  errback: (e: Error) => void
                ) => {
                  try {
                    setIsProducerTransportConnected(true)

                    if (socket.readyState === WebSocket.OPEN) {
                      socket.send(
                        JSON.stringify({
                          event: OUTGOING_EVENT_NAMES.CONNECT_TRANSPORT,
                          data: {
                            dtlsParameters,
                            sender: true,
                          },
                        })
                      );
                    } else {
                      console.error("socket is not ready yet in producerTransport transport.on connect")
                      return
                    }

                    callback();
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
                    if (socket.readyState === WebSocket.OPEN) {
                      socket.send(
                        JSON.stringify({
                          event: OUTGOING_EVENT_NAMES.PRODUCE_MEDIA,
                          data: {
                            kind,
                            rtpParameters,
                          },
                        })
                      );
                    } else {
                      console.error("socket not ready in producerTransport transport.on produce")
                      return
                    }

                    triggerCallbackAcrossEventsRef.current = callback as (data: unknown) => void;
                  } catch (error) {
                    errback(error as Error);
                  }
                }
              );
            } else {
              if (!device) {
                console.error("device is undefined in createRecvTransport")
                return
              }

              const transport = device.createRecvTransport(data.params)
              setConsumerTransport(transport)

              transport?.on(
                'connect',
                async (
                  { dtlsParameters }: { dtlsParameters: DtlsParameters },
                  callback: () => void,
                  errback: (e: Error) => void
                ) => {
                  try {
                    if (socket.readyState === WebSocket.OPEN) {
                      socket.send(
                        JSON.stringify({
                          event: OUTGOING_EVENT_NAMES.CONNECT_TRANSPORT,
                          data: {
                            sender: false,
                            dtlsParameters,
                          },
                        })
                      );
                    } else {
                      console.error("socket is not ready in consumer transport on connect")
                    }

                    callback();
                  } catch (error) {
                    errback(error as Error);
                  }
                }
              );
            }
            break;
          }

          case INCOMING_EVENT_NAMES.NEW_PRODUCER_TRANSPORT_CREATED: {
            const { newClientId } = data
            connectRecvTransport(newClientId)

            break;
          }

          case INCOMING_EVENT_NAMES.CONSUMING_MEDIA: {
            if (!consumerTransport) {
              console.error("consumerTransport is undefined in CONSUMING_MEDIA event")
              return
            }

            const consumer = await consumerTransport.consume(data.params)
            setConsumerList((prev) => ({ ...prev, [data.params.producerId]: consumer }))

            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                event: OUTGOING_EVENT_NAMES.RESUME_CONSUME,
              }))
            } else {
              console.error("socket is not ready in createSendTransport")
            }

            break;
          }

          case INCOMING_EVENT_NAMES.EXISTING_CLIENTS_LIST: {
            for (const client of data.existingClients) {
              connectRecvTransport(client)
            }

            break;
          }

          case INCOMING_EVENT_NAMES.PRODUCING_MEDIA: {
            if (!triggerCallbackAcrossEventsRef.current) {
              console.error("triggerCallbackFromOutside is null")
              return
            }

            triggerCallbackAcrossEventsRef.current({ id: data.id });

            break;
          }
        }

      } catch (error) {
        console.error("websocket error on onmessage", error)
        return;
      }
    }
  }, [roomId, device, consumerTransport, producerTransport, connectRecvTransport])

  useEffect(() => {
    if (rtpCapabilities && !device) {
      createDevice()
    }
  }, [rtpCapabilities, device, createDevice])

  useEffect(() => {
    if (device) {
      createSendTransport()
      createRecvTransport()
    }
  }, [createRecvTransport, device])

  useEffect(() => {
    if (device && producerTransport && params.track && !isProducerTransportConnected) {
      setIsProducerTransportConnected(true)
      connectSendTransport()
    }
  }, [device, producerTransport, params, isProducerTransportConnected, connectSendTransport])

  useEffect(() => {
    const newRefs: Record<string, RefObject<HTMLVideoElement | null>> = {};

    Object.keys(consumerList).forEach((producerId) => {
      if (!videoRefs[producerId]) {
        newRefs[producerId] = createRef<HTMLVideoElement>();
      }
    });

    if (Object.keys(newRefs).length > 0) {
      setVideoRefs((prev) => ({ ...prev, ...newRefs }));
    }
  }, [consumerList, videoRefs]);

  useEffect(() => {
    Object.entries(consumerList).forEach(([producerId, consumer]) => {
      const videoRef = videoRefs[producerId];
      if (videoRef?.current && consumer.track) {
        const stream = new MediaStream([consumer.track]);
        videoRef.current.srcObject = stream;

        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch((err) => {
            console.error("Video play error", err);
          });
        };
      }
    });
  }, [consumerList, videoRefs]);

  return {
    localVideoRef, videoRefs, consumerList
  }
}
