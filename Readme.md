# WebRTC Streaming App with Mediasoup

This project is a full-stack application demonstrating real-time video and audio streaming using WebRTC and Mediasoup. It allows users to create or join streaming rooms, with a frontend built using Next.js and a backend powered by Node.js, Express, and Mediasoup.

## Features

*   **Real-time Communication:** Leverages WebRTC for low-latency video and audio streaming.
*   **Mediasoup Integration:** Uses Mediasoup as the SFU (Selective Forwarding Unit) on the backend for efficient media routing between multiple participants.
*   **Room-Based Streaming:** Users can create unique rooms or join existing ones using a Room ID.
*   **WebSocket Signaling:** Implements a custom signaling server using WebSockets (`ws`) for negotiating WebRTC connections.
*   **Interactive Frontend:** Built with Next.js (App Router), allowing users to easily:
    *   Start their camera.
    *   Create a new streaming room.
    *   Join an existing streaming room.
    *   View their local video feed and the video feeds of other participants in the room.
*   **Scalable Worker Management:** The backend Mediasoup implementation manages a pool of workers to handle multiple routers and transports.

## Upcoming Features

*   **HLS Playback (`/watch` page):**
    *   The `/watch` page will be enhanced to allow users to view live streams via HLS (HTTP Live Streaming).
    *   This will involve backend modifications to transcode or relay the WebRTC stream from Mediasoup into an HLS format, likely using tools like FFmpeg or a dedicated media server.
    *   Users will be able to enter a `roomId` on the `/watch` page to view the HLS stream corresponding to that room.

## Directory Structure

The project is a monorepo organized into two main parts:

```bash
./
├── backend/ # Node.js, Express, Mediasoup, WebSocket Signaling Server
│   ├── src/
│   │   ├── mediasoup/ # Mediasoup specific logic (workers, routers, transports)
│   │   ├── signaling/ # WebSocket signaling logic
│   │   └── index.ts # Backend server entry point
│   ├── package.json
│   └── tsconfig.json
└── frontend/ # Next.js Client Application
    ├── app/ # Next.js App Router (pages, layouts)
    │   ├── stream/
    │   │   ├── [roomId]/page.tsx # Dynamic room page
    │   │   └── page.tsx # Page to create/join a room
    │   └── watch/page.tsx # Placeholder for HLS watch page
    ├── components/ # UI components (shadcn/ui)
    ├── utils/ # Utility functions, including signaling client logic
    ├── package.json
    └── tsconfig.json
```

## Tech Stack

**Backend:**

*   **Runtime:** Node.js
*   **Framework:** Express.js
*   **Language:** TypeScript
*   **WebRTC SFU:** Mediasoup
*   **Signaling:** WebSockets (`ws`)
*   **Package Manager:** PNPM
*   **Environment Variables:** `dotenv`
*   **CORS:** `cors`
*   **Linting/Formatting:** ESLint, Prettier

**Frontend:**

*   **Framework:** Next.js (v15+, App Router, Turbopack for dev)
*   **Language:** TypeScript
*   **UI Library:** React (v19+)
*   **WebRTC SFU Client:** `mediasoup-client`
*   **Signaling** WebSockets
*   **Styling:** Tailwind CSS
*   **UI Components:** shadcn/ui
*   **Package Manager:** PNPM
*   **Linting/Formatting:** ESLint (Next.js default), Prettier (implied by backend, can be added)

## Prerequisites

*   Node.js (LTS version recommended; check `package.json` for specific version compatibility if needed)
*   PNPM (v10.11.0 or compatible, as specified in `backend/package.json`)

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd <repository-name>
    ```

2.  **Backend Setup:**
    ```bash
    cd backend
    pnpm install
    ```
    Create a `.env` file in the `backend` directory (you can copy `.env.example` if one exists, otherwise create it manually):
    ```env
    # backend/.env
    PORT=8000
    ```

3.  **Frontend Setup:**
    ```bash
    cd ../frontend
    pnpm install
    ```

## Running the Application

1.  **Start the Backend Server:**
    Navigate to the `backend` directory:
    ```bash
    cd backend
    pnpm dev
    ```
    The backend server will start, typically on `http://localhost:8000` (or the port specified in your `backend/.env` file).

2.  **Start the Frontend Development Server:**
    Navigate to the `frontend` directory:
    ```bash
    cd frontend
    pnpm dev
    ```
    The frontend application will start, typically on `http://localhost:3000`.

Open `http://localhost:3000` in your browser to use the application.

## Available Scripts

**Backend (`backend/package.json`):**

*   `pnpm dev`: Starts the backend server in development mode using `ts-node`.
*   `pnpm start`: Builds the TypeScript code (to `dist/`) and starts the production server.
*   `pnpm lint:check`: Checks for Prettier formatting issues.
*   `pnpm lint:fix`: Automatically fixes Prettier formatting issues.

**Frontend (`frontend/package.json`):**

*   `pnpm dev`: Starts the Next.js development server (using Turbopack).
*   `pnpm build`: Builds the Next.js application for production.
*   `pnpm start`: Starts the Next.js production server (requires `pnpm build` to be run first).
*   `pnpm lint`: Lints the frontend code using ESLint and Next.js's recommended configurations.

## How It Works (Simplified Flow)

1.  **Initial Connection:** The frontend client establishes a WebSocket connection to the backend signaling server (`ws://localhost:8000`).
2.  **Join Room:**
    *   The user creates or enters a `roomId` in the frontend.
    *   The client sends a `join-room` message to the server with the `roomId`.
3.  **Mediasoup Setup (Server):**
    *   The server creates a Mediasoup `Router` for the `roomId` if one doesn't already exist.
    *   The server sends the `routerRtpCapabilities` back to the client.
4.  **Mediasoup Setup (Client):**
    *   The client initializes a `mediasoup-client` `Device` and loads it with the `routerRtpCapabilities`.
5.  **Transport Creation:**
    *   The client requests the server to create a WebRTC transport for sending media (`producerTransport`) and one for receiving media (`consumerTransport`).
    *   The server creates these transports on its Mediasoup router and sends their parameters (id, iceParameters, iceCandidates, dtlsParameters) back to the client.
6.  **Transport Connection:**
    *   The client uses these parameters to establish a connection for its local `SendTransport` and `RecvTransport` with the server-side transports. This involves DTLS and ICE handshakes.
    *   `transport.on('connect', ...)` and `transport.on('produce', ...)` (for send transport) are key event handlers.
7.  **Producing Media (Streaming Out):**
    *   The client gets the local media stream (camera/microphone).
    *   It creates a `Producer` on its `SendTransport` using `transport.produce({ track })`.
    *   Information about this new producer (kind, rtpParameters) is sent to the server.
    *   The server creates a corresponding server-side producer.
    *   Other clients in the room are notified about this new producer.
8.  **Consuming Media (Receiving Streams):**
    *   When a client is notified of a new remote producer (another user streaming), or when it joins a room with existing producers, it requests to consume that media.
    *   The client sends a `consume-media` message to the server with the `producerId` it wants to consume and its own `rtpCapabilities`.
    *   The server checks if consumption is possible and creates a server-side `Consumer`.
    *   The server sends consumer parameters (id, producerId, kind, rtpParameters) back to the client.
    *   The client creates a local `Consumer` on its `RecvTransport` using these parameters: `recvTransport.consume(...)`.
    *   The `consumer.track` is then attached to an HTML `<video>` element to display the remote stream.
9.  **Dynamic Updates:** The system handles clients joining/leaving and starting/stopping their streams, updating video displays accordingly.

This project serves as a comprehensive example of building a many-to-many video conferencing or streaming application using Mediasoup and WebRTC.
