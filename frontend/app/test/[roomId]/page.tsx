'use client'

import { INCOMING_EVENT_NAMES, OUTGOING_EVENT_NAMES } from "@/utils/signaling/constants";
import { Device } from "mediasoup-client";
import { Consumer, DtlsParameters, MediaKind, RtpCapabilities, RtpParameters, Transport } from "mediasoup-client/types";
import { useParams } from "next/navigation"
import { RefObject, useEffect, useRef, useState } from "react";

export default function Room() {
  const pathParams = useParams<{ roomId: string }>()
  const { roomId } = pathParams

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [videoRefs, setVideoRefs] = useState<RefObject<HTMLVideoElement | null>[]>([]);

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
  const [device, setDevice] = useState<Device | undefined>(undefined);
  const [RtpCapabilities, setRtpCapabilities] = useState<RtpCapabilities | undefined>(undefined)
  const [producerTransport, setProducerTransport] = useState<Transport | undefined>(undefined);
  const [consumerTransport, setConsumerTransport] = useState<Transport | undefined>(undefined);
  const [consumerList, setConsumerList] = useState<Record<string, Consumer>>({});

  socketRef.current = new WebSocket('ws://localhost:8000');

  useEffect(() => {
    const socket = socketRef.current

    let triggerCallbackFromOutside: ((data: unknown) => void) | null = null;

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

          case INCOMING_EVENT_NAMES.ROUTER_RTP_CAPABILITIES: {
            console.log("router rtp capabilities: ", data.rtpCapabilities)

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
              console.log("producerTransport created: ", transport)

              transport?.on(
                'connect',
                async (
                  { dtlsParameters }: { dtlsParameters: DtlsParameters },
                  callback: () => void,
                  errback: (e: Error) => void
                ) => {
                  try {
                    console.log('Producer transport has connected');

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

                      callback();
                    } else {
                      console.log("socket is not ready yet in producerTransport transport.on connect")
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

                    triggerCallbackFromOutside = callback as (data: unknown) => void;
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
              console.log("consumerTransport created: ", transport)

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
            if (!triggerCallbackFromOutside) {
              console.error("triggerCallbackFromOutside is null")
              return
            }

            triggerCallbackFromOutside({ id: data.id });

            break;
          }
        }

      } catch (error) {
        console.error("websocket error on onmessage", error)
        return;
      }
    }
  }, [roomId, device])

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

      console.log("camera started")
    } catch (error) {
      console.error('Error in accessing camera: ', error);
    }
  }

  async function createDevice() {
    try {
      const newDevice = new Device()

      if (!RtpCapabilities) {
        console.error("rtp capabilities is undefined in createDevice")
        return
      }
      await newDevice.load({ routerRtpCapabilities: RtpCapabilities })
      setDevice(newDevice)

      console.log("device created and loaded: ", newDevice)
    } catch (error) {
      console.error("error in create device", error)
    }
  }

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

  return (
    <main>
      <video ref={localVideoRef} id="localvideo" autoPlay playsInline />
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <button onClick={createDevice}>Create Device</button>
        <button onClick={createSendTransport}>Create Send Transport</button>
      </div>
    </main>
  );
}
