import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http"
import { connectConsumerTransport, connectProducerTransport, consumeMedia, createTransport, getRouterCapabilities, transportProduce } from "./mediasoup";

export default async function SignalingServer(server: Server) {
  const wss = new WebSocketServer({ server })

  wss.on('connection', async (ws) => {
    const clients = new Map<string, WebSocket>()

    const clientId = generateClientId()
    clients.set(clientId, ws)
    console.log("SignalingServer ---- Client connected: ", clientId)

    ws.send(JSON.stringify({
      event: "connection-success"
    }))

    ws.on('message', async (message: string) => {
      const { event, data } = JSON.parse(message)

      switch (event) {
        case 'disconnect':
          console.log("SignalingServer ---- Client diconnected")
          break;

        case 'getRouterRtpCapabilities':
          const routerRtpCapabilities = getRouterCapabilities()
          ws.send(JSON.stringify({
            event: 'routerRtpCapabilities',
            data: {
              routerRtpCapabilities
            }
          }))
          break;

        case 'createTransport':
          const transport = await createTransport(data.sender || false)
          ws.send(JSON.stringify({
            event: 'transportCreated',
            data: transport
          }))
          break;

        case 'connectProducerTransport':
          await connectProducerTransport(data.dtlsParameters)
          ws.send(JSON.stringify({
            event: 'producerTransportConnected',
            data: {}
          }))
          break;

        case 'transportProduce':
          const produce = await transportProduce({ kind: data.kind, rtpParameters: data.rtpParameters })
          ws.send(JSON.stringify({
            event: 'transportingProduce',
            data: { producerId: produce?.id }
          }))
          break;

        case 'connectConsumerTransport':
          await connectConsumerTransport({ dtlsParameters: data.dtlsParameters })
          ws.send(JSON.stringify({
            event: 'consumerTransportConnected',
            data: {}
          }))
          break;

        case 'consumeMedia':
          const consume = await consumeMedia({ rtpCapabilities: data.rtpCapabilities })
          ws.send(JSON.stringify({
            event: 'consumingMedia',
            data: consume
          }))
          break;

        default:
          ws.send(JSON.stringify({
            event: event,
            data: {
              message: `${event} is not a valid event`
            }
          }))
          break;
      }
    })
  })
}

function generateClientId(): string {
  return Math.random().toString(36).substring(2, 15)
}
