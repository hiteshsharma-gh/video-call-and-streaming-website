import express from "express"
import http from "http"
import SignalingServer from "./signalingServer";
import { createRouter, createWorker } from "./mediasoup";
import { config } from "dotenv";

config()

const app = express()
const server = http.createServer(app)

  ; (async () => {
    await createWorker()
    await createRouter()

    SignalingServer(server)
  })()

server.listen(process.env.PORT, () => { console.log("server is listening on port ", process.env.PORT) })
