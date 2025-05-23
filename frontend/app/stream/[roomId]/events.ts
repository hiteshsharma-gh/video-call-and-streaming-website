'use client'

import { useEffect, useRef, useState } from "react"
import { RtpCapabilities } from 'mediasoup-client/types'
// import { MessageType, SignalingServer } from "@/utils/signaling";
import { INCOMING_EVENT_NAMES, OUTGOING_EVENT_NAMES } from "@/utils/signaling/constants";

export function Event(roomId: string) {
  const localVideoRef = useRef<HTMLVideoElement>(null)
  // const videoRefs = useMemo(() => {
  //   return Array.from({ length: 1 }, () => createRef<HTMLVideoElement>())
  // }, [])

  const [params, setParams] = useState({
    encoding: [
      { rid: "r0", maxBitrate: 100000, scalabilityMode: "S1T3" }, // Lowest quality layer
      { rid: "r1", maxBitrate: 300000, scalabilityMode: "S1T3" }, // Middle quality layer
      { rid: "r2", maxBitrate: 900000, scalabilityMode: "S1T3" }, // Highest quality layer
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 }, // Initial bitrate
  });

  const [socket, setSocket] = useState<WebSocket | undefined>(undefined)
  // const [device, setDevice] = useState<Device | null>(null);
  const [rtpCapabilities, setRtpCapabilities] = useState<RtpCapabilities | undefined>(undefined);
  // const [producerTransport, setProducerTransport] = useState<Transport | undefined>(undefined);
  // const [consumerTransport, setConsumerTransport] = useState<Transport | undefined>(undefined);
  // const [consumerList, setConsumerList] = useState<Record<string, Consumer>>({});
  // const [isProducerTransportConnected, setIsProducerTransportConnected] = useState(false)

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8000')
    setSocket(socket)

    socket.onopen = (event) => {
      console.log("socket open: ", event)
    }

    socket.onmessage = (message) => {
      try {
        const { event, data } = JSON.parse(message.data)
        console.log("Received event:", event)

        if (event === INCOMING_EVENT_NAMES.CONNECTION_SUCCESS) {
          console.log("connection successful")
          socket.send(JSON.stringify({
            event: OUTGOING_EVENT_NAMES.JOIN_ROOM,
            data: { roomId }
          }))
          console.log("Join room signal sent")
          startCamera()
        }

        if (event === INCOMING_EVENT_NAMES.ROUTER_RTP_CAPABILITIES) {
          console.log("router rtp capabilities: ", data.rtpCapabilities)
          setRtpCapabilities(data.rtpCapabilities as RtpCapabilities)
        }

      } catch (error) {
        console.error("Error in signaling server: ", error)
      }
    }

    return () => {
      socket.close()
    }

  }, [])

  // useEffect(() => {
  //   Object.keys(consumerList).forEach((key, index) => {
  //     if (videoRefs[index]?.current) {
  //       const { track } = consumerList[key]!;
  //       videoRefs[index].current.srcObject = new MediaStream([track]);
  //     }
  //   });
  // }, [consumerList]);
  //
  // useEffect(() => {
  //   if (rtpCapabilities && !device) {
  //     createDevice()
  //   }
  // }, [rtpCapabilities])
  //
  // useEffect(() => {
  //   if (device) {
  //     createSendTransport();
  //     createRecvTransport();
  //   }
  // }, [device]);
  //
  // useEffect(() => {
  //   console.log("producerTransport===", producerTransport);
  //   if (
  //     device &&
  //     producerTransport &&
  //     // @ts-expect-error currently I don't know how to resolve this error, will fine a way soon
  //     params?.track &&
  //     !isProducerTransportConnected
  //   ) {
  //     setIsProducerTransportConnected(true);
  //     connectSendTransport();
  //   }
  // }, [device, producerTransport, params]);

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
      console.error("Error in starting camera: ", error)
    }
  };

  // async function createDevice() {
  //   try {
  //     const newDevice = new Device()
  //
  //     await newDevice.load({ routerRtpCapabilities: rtpCapabilities as RtpCapabilities })
  //
  //     setDevice(newDevice)
  //   } catch (error) {
  //     console.error("Error while create Mediasoup Device: ", error)
  //   }
  // }
  //
  // async function createSendTransport() {
  //   SignalingServer.sendMessage({
  //     event: OUTGOING_EVENT_NAMES.CREATE_TRANSPORT,
  //     data: {
  //       sender: true
  //     }
  //   })
  //
  //   SignalingServer.onMessage((msg) => {
  //     if (msg.event === INCOMING_EVENT_NAMES.TRANSPORT_CREATED && msg.data.sender) {
  //       const transport = device?.createSendTransport({
  //         id: msg.data.id as string,
  //         iceParameters: msg.data.iceParameters as IceParameters,
  //         iceCandidates: msg.data.iceCandidates as IceCandidate[],
  //         dtlsParameters: msg.data.dtlsParameters as DtlsParameters,
  //       })
  //
  //       console.log("transport created====== ", transport, device)
  //
  //       transport?.on('connect', async ({ dtlsParameters }: { dtlsParameters: DtlsParameters }, callback: () => void, errback: (e: Error) => void) => {
  //         try {
  //           console.log("Producer Transport has connected")
  //
  //           SignalingServer.sendMessage({
  //             event: OUTGOING_EVENT_NAMES.CONNECT_TRANSPORT,
  //             data: {
  //               dtlsParameters: dtlsParameters,
  //               sender: true
  //             }
  //           })
  //
  //           callback()
  //         } catch (e: unknown) {
  //           errback(e as Error)
  //         }
  //       })
  //
  //       transport?.on('produce', async ({ kind, rtpParameters }: { kind: MediaKind, rtpParameters: RtpParameters }, callback: ({ id }: { id: string }) => void, errback: (e: Error) => void) => {
  //         try {
  //           console.log("producing media")
  //
  //           SignalingServer.sendMessage({
  //             event: OUTGOING_EVENT_NAMES.PRODUCE_MEDIA,
  //             data: {
  //               kind,
  //               rtpParameters
  //             }
  //           })
  //
  //           SignalingServer.onMessage((msg) => {
  //             if (msg.event === INCOMING_EVENT_NAMES.PRODUCING_MEDIA) {
  //               callback({ id: msg.data.id as string })
  //             }
  //           })
  //         } catch (e) {
  //           errback(e as Error)
  //         }
  //       })
  //
  //       setProducerTransport(transport)
  //     }
  //   })
  // }
  //
  // async function connectSendTransport() {
  //   const producer = await producerTransport?.produce(params)
  //
  //   producer?.on('trackended', () => {
  //     console.log("trackended")
  //   })
  //
  //   producer?.on('transportclose', () => {
  //     console.log("transportclose")
  //   })
  // }
  //
  // async function createRecvTransport() {
  //   SignalingServer.sendMessage({
  //     event: OUTGOING_EVENT_NAMES.CREATE_TRANSPORT,
  //     data: {
  //       sender: false
  //     }
  //   })
  //
  //   SignalingServer.onMessage((msg) => {
  //     if (msg.event === INCOMING_EVENT_NAMES.TRANSPORT_CREATED && !msg.data.sender) {
  //       const transport = device?.createRecvTransport({
  //         id: msg.data.id as string,
  //         iceParameters: msg.data.iceParameters as IceParameters,
  //         iceCandidates: msg.data.iceCandidates as IceCandidate[],
  //         dtlsParameters: msg.data.dtlsParameters as DtlsParameters,
  //       })
  //
  //       setConsumerTransport(transport)
  //
  //       SignalingServer.onMessage((msg) => {
  //         if (msg.event === INCOMING_EVENT_NAMES.NEW_PRODUCER_TRANSPORT_CREATED) {
  //           console.log("connecting to new user joined")
  //           connectRecvTransport({ clientId: msg.data.newClientId as string })
  //         }
  //       })
  //
  //       SignalingServer.onMessage((msg) => {
  //         if (msg.event === INCOMING_EVENT_NAMES.EXISTING_CLIENTS_LIST) {
  //           console.log("existing clients list: ", msg.data.existingClients)
  //           for (const client of msg.data.existingClients as string[]) {
  //             connectRecvTransport({ clientId: client })
  //           }
  //         }
  //       })
  //
  //       transport?.on('connect', async ({ dtlsParameters }: { dtlsParameters: DtlsParameters }, callback: () => void, errback: (e: Error) => void) => {
  //         try {
  //           SignalingServer.sendMessage({
  //             event: OUTGOING_EVENT_NAMES.CONNECT_TRANSPORT,
  //             data: {
  //               sender: false,
  //               dtlsParameters
  //             }
  //           })
  //
  //           callback()
  //
  //           console.log("consumer transport  has connected")
  //         } catch (error) {
  //           errback(error as Error)
  //         }
  //       })
  //     }
  //   })
  // }
  //
  // async function connectRecvTransport({ clientId }: { clientId: string }) {
  //   SignalingServer.sendMessage({
  //     event: OUTGOING_EVENT_NAMES.CONSUME_MEDIA,
  //     data: {
  //       rtpCapabilities: device?.rtpCapabilities,
  //       producerId: clientId
  //     }
  //   })
  //
  //   SignalingServer.onMessage(async (msg) => {
  //     if (msg.event === INCOMING_EVENT_NAMES.CONSUMING_MEDIA) {
  //       const consumer = await consumerTransport?.consume({
  //         id: msg.data.id as string,
  //         kind: msg.data.kind as MediaKind,
  //         rtpParameters: msg.data.rtpParameters as RtpParameters,
  //         producerId: msg.data.producerId as string
  //       })
  //
  //       const { track } = consumer!
  //       console.log("track------------------", track)
  //
  //       setConsumerList((prev) => ({ ...prev, [clientId]: consumer! }))
  //
  //       SignalingServer.sendMessage({
  //         event: OUTGOING_EVENT_NAMES.RESUME_CONSUME,
  //         data: {}
  //       })
  //
  //       console.log("consumer transport  has resumed")
  //     }
  //   })
  // }
  //
  // return {
  //   localVideoRef,
  //   videoRefs,
  //   consumerList,
  // }
}
