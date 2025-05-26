export class WebsocketHandler {
  url: string,
  ws: WebSocket,
  eventHandler

  constructor(url) {
    this.url = url,
      this.ws = null,
      this.eventHandler = {},
      this.connected = false;

    this.connect()
  }
}
