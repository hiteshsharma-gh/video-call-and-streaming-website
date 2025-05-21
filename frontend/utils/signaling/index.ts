type MessageType = {
  event: string,
  data: Record<string, unknown>
}

export class SignalingServer {
  private static socket: WebSocket | null = null;
  private static url: string;
  private static isConnected: boolean = false;
  private static messageHandler?: (msg: MessageType) => void

  static init(url: string) {
    this.url = url
    this.connect()
  }

  private static connect() {
    this.socket = new WebSocket(this.url)

    this.socket.onopen = () => {
      console.log("Signaling Server connected")
      this.isConnected = true
    }

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (this.messageHandler) {
          this.messageHandler(data)
        } else {
          console.warn("No message handler set")
        }

      } catch (error) {
        console.error("Error in signaling server: ", error)
      }
    }

    this.socket.onerror = (error) => {
      console.error("Signaling Websocket error: ", error)
    }

    this.socket.onclose = (event) => {
      console.warn("Signaling Websocket closed. Reason: ", event.reason)
      this.isConnected = false
    }
  }

  static sendMessage(message: MessageType) {
    if (this.isConnected && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      console.warn("Signaling Server cannot send. Socket not open")
    }
  }

  static onMessage(callback: (msg: MessageType) => void) {
    this.messageHandler = callback
  }

  static close() {
    this.socket?.close()
    this.isConnected = false
  }
}
