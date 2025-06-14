import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { types as MediasoupTypes } from 'mediasoup';
import { Mediasoup } from '../mediasoup/index.js'; // Assuming Mediasoup class is correctly exported
import { HLS_OUTPUT_DIR_NAME, FFMPEG_STARTING_RTP_PORT } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HLS_BASE_DIR = path.join(__dirname, '..', '..', HLS_OUTPUT_DIR_NAME); // Puts hls_output at backend/hls_output

interface ActiveHlsStream {
  ffmpegProcess: ChildProcess;
  plainTransports: MediasoupTypes.PlainTransport[];
  consumers: MediasoupTypes.Consumer[];
  sdpFiles: string[];
}

export class HlsManager {
  private activeStreams: Map<string, ActiveHlsStream> = new Map();
  private mediasoup: Mediasoup;
  private nextRtpPort: number = FFMPEG_STARTING_RTP_PORT;

  constructor(mediasoupInstance: Mediasoup) {
    this.mediasoup = mediasoupInstance;
    this.ensureHlsOutputDir();
  }

  private ensureHlsOutputDir() {
    if (!fs.existsSync(HLS_BASE_DIR)) {
      fs.mkdirSync(HLS_BASE_DIR, { recursive: true });
      console.log(`HLS Manager ---- Created HLS output directory: ${HLS_BASE_DIR}`);
    }
  }

  private getNextAvailableRtpPorts(): { rtpPort: number; rtcpPort: number } {
    const rtpPort = this.nextRtpPort;
    const rtcpPort = this.nextRtpPort + 1;
    this.nextRtpPort += 2; // Increment for the next stream
    return { rtpPort, rtcpPort };
  }

  private generateSdpFileContent(
    rtpPort: number,
    rtcpPort: number, // FFmpeg generally uses this in the c-line for RTCP if not muxed
    consumerRtpParameters: MediasoupTypes.RtpParameters,
    kind: 'audio' | 'video',
  ): string {
    const { codecs } = consumerRtpParameters;
    const codec = codecs[0]; // Assuming primary codec

    const sdp = [
      'v=0',
      `o=- 0 0 IN IP4 127.0.0.1`,
      's=FFmpeg',
      `c=IN IP4 127.0.0.1`, // FFmpeg listens on this IP
      't=0 0',
      `m=${kind} ${rtpPort} RTP/AVP ${codec.payloadType}`,
      `a=rtcp:${rtcpPort}`, // RTCP port
      `a=rtpmap:${codec.payloadType} ${codec.mimeType.split('/')[1]}/${codec.clockRate}${kind === 'audio' ? '/' + codec.channels : ''}`,
      'a=sendrecv', // Though FFmpeg is mostly receiving here
    ];

    if (codec.parameters) {
      Object.entries(codec.parameters).forEach(([key, value]) => {
        sdp.push(`a=fmtp:${codec.payloadType} ${key}=${value}`);
      });
    }

    return sdp.join('\r\n') + '\r\n';
  }

  public async startHlsStream(
    roomId: string,
    router: MediasoupTypes.Router,
    videoProducers: MediasoupTypes.Producer[], // Expecting up to 2 video producers
    audioProducers: MediasoupTypes.Producer[], // Expecting up to 2 audio producers
  ) {
    if (this.activeStreams.has(roomId)) {
      console.log(`HLS Manager ---- Stream already active for room ${roomId}`);
      return;
    }

    if (videoProducers.length === 0) {
      console.warn(`HLS Manager ---- No video producers for room ${roomId}, cannot start HLS.`);
      return;
    }
    // Limit to 2 video and 2 audio producers for the combined stream
    const selectedVideoProducers = videoProducers.slice(0, 2);
    const selectedAudioProducers = audioProducers.slice(0, 2);

    console.log(
      `HLS Manager ---- Attempting to start HLS stream for room ${roomId} with ${selectedVideoProducers.length} video and ${selectedAudioProducers.length} audio producers.`,
    );

    const plainTransports: MediasoupTypes.PlainTransport[] = [];
    const consumers: MediasoupTypes.Consumer[] = [];
    const sdpFiles: string[] = [];
    const ffmpegInputs: string[] = [];
    const streamInfo: Array<{
      kind: 'video' | 'audio';
      sdpPath: string;
      rtpPort: number;
      rtcpPort: number;
      producerId: string;
    }> = [];

    try {
      // Create transports and consumers for selected video producers
      for (const producer of selectedVideoProducers) {
        const { rtpPort, rtcpPort } = this.getNextAvailableRtpPorts();
        const transport = await this.mediasoup.createPlainTransport(router);
        await transport.connect({ ip: '127.0.0.1', port: rtpPort, rtcpPort: rtcpPort });
        plainTransports.push(transport);

        const consumer = await transport.consume({
          producerId: producer.id,
          rtpCapabilities: router.rtpCapabilities, // Use router's capabilities for consuming
          paused: true, // Start paused
        });
        consumers.push(consumer);

        const sdpPath = path.join(HLS_BASE_DIR, `${roomId}_${producer.id}_video.sdp`);
        const sdpContent = this.generateSdpFileContent(
          rtpPort,
          rtcpPort,
          consumer.rtpParameters,
          'video',
        );
        fs.writeFileSync(sdpPath, sdpContent);
        sdpFiles.push(sdpPath);
        ffmpegInputs.push('-protocol_whitelist', 'file,udp,rtp', '-i', sdpPath);
        streamInfo.push({ kind: 'video', sdpPath, rtpPort, rtcpPort, producerId: producer.id });
      }

      // Create transports and consumers for selected audio producers
      for (const producer of selectedAudioProducers) {
        const { rtpPort, rtcpPort } = this.getNextAvailableRtpPorts();
        const transport = await this.mediasoup.createPlainTransport(router);
        await transport.connect({ ip: '127.0.0.1', port: rtpPort, rtcpPort: rtcpPort });
        plainTransports.push(transport);

        const consumer = await transport.consume({
          producerId: producer.id,
          rtpCapabilities: router.rtpCapabilities,
          paused: true,
        });
        consumers.push(consumer);

        const sdpPath = path.join(HLS_BASE_DIR, `${roomId}_${producer.id}_audio.sdp`);
        const sdpContent = this.generateSdpFileContent(
          rtpPort,
          rtcpPort,
          consumer.rtpParameters,
          'audio',
        );
        fs.writeFileSync(sdpPath, sdpContent);
        sdpFiles.push(sdpPath);
        ffmpegInputs.push('-protocol_whitelist', 'file,udp,rtp', '-i', sdpPath);
        streamInfo.push({ kind: 'audio', sdpPath, rtpPort, rtcpPort, producerId: producer.id });
      }

      if (ffmpegInputs.length === 0) {
        console.error('HLS Manager ---- No media inputs for FFmpeg.');
        this.cleanupRoomResources(roomId, plainTransports, consumers, sdpFiles); // Partial cleanup
        return;
      }

      // Construct FFmpeg command
      const videoFilterParts: string[] = [];
      const audioFilterParts: string[] = [];
      const videoOutputStreams: string[] = [];
      const audioOutputStreams: string[] = [];
      let videoInputIdx = 0;
      let audioInputIdx = 0;

      streamInfo.forEach((stream, ffmpegInputIndex) => {
        if (stream.kind === 'video') {
          videoFilterParts.push(
            `[${ffmpegInputIndex}:v]scale=640:480,setpts=PTS-STARTPTS[v${videoInputIdx}]`,
          );
          videoOutputStreams.push(`[v${videoInputIdx}]`);
          videoInputIdx++;
        } else if (stream.kind === 'audio') {
          audioFilterParts.push(`[${ffmpegInputIndex}:a]asetpts=PTS-STARTPTS[a${audioInputIdx}]`);
          audioOutputStreams.push(`[a${audioInputIdx}]`);
          audioInputIdx++;
        }
      });

      let filterComplex = '';
      if (videoOutputStreams.length > 0) {
        filterComplex += videoFilterParts.join(';') + ';';
        if (videoOutputStreams.length > 1) {
          filterComplex +=
            videoOutputStreams.join('') + `hstack=inputs=${videoOutputStreams.length}[outv]`;
        } else {
          filterComplex += `${videoOutputStreams[0]}copy[outv]`; // If only one video, just pass it through
        }
      }

      if (audioOutputStreams.length > 0) {
        filterComplex += (filterComplex ? ';' : '') + audioFilterParts.join(';') + ';';
        if (audioOutputStreams.length > 1) {
          filterComplex +=
            audioOutputStreams.join('') + `amerge=inputs=${audioOutputStreams.length}[outa]`;
        } else {
          filterComplex += `${audioOutputStreams[0]}pan=stereo|c0<c0|c1<c0[outa]`; // If only one audio, ensure it's stereo or properly mapped
        }
      }

      const ffmpegArgs = [
        ...ffmpegInputs,
        '-filter_complex',
        filterComplex,
        ...(videoOutputStreams.length > 0 ? ['-map', '[outv]'] : []),
        ...(audioOutputStreams.length > 0 ? ['-map', '[outa]'] : []),
        // Video codec
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-tune',
        'zerolatency',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '48',
        '-keyint_min',
        '48',
        '-sc_threshold',
        '0',
        // Audio codec
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-ac',
        '2', // Ensure 48000 for broader compatibility if input is also 48k
        // HLS output
        '-f',
        'hls',
        '-hls_time',
        '2', // Shorter segments for lower latency
        '-hls_list_size',
        '3',
        '-hls_flags',
        'delete_segments+omit_endlist',
        '-hls_segment_filename',
        path.join(HLS_BASE_DIR, `${roomId}_%03d.ts`),
        path.join(HLS_BASE_DIR, `${roomId}_playlist.m3u8`),
      ].filter(Boolean); // Filter out any falsey values if some maps are not present

      console.log(
        `HLS Manager ---- Spawning FFmpeg for room ${roomId}: ffmpeg ${ffmpegArgs.join(' ')}`,
      );
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

      ffmpegProcess.on('error', (err) => {
        console.error(`HLS Manager ---- FFmpeg process error for room ${roomId}:`, err);
        this.stopHlsStream(roomId); // Cleanup on error
      });

      // ffmpegProcess.stderr.on('data', (data) => {
      //   // console.error(`HLS Manager ---- FFmpeg stderr (room ${roomId}): ${data.toString()}`);
      // });

      ffmpegProcess.on('close', (code) => {
        console.log(`HLS Manager ---- FFmpeg process for room ${roomId} exited with code ${code}`);
        this.stopHlsStream(roomId); // Ensure cleanup if FFmpeg stops for any reason
      });

      this.activeStreams.set(roomId, { ffmpegProcess, plainTransports, consumers, sdpFiles });

      // Resume all consumers
      for (const consumer of consumers) {
        await consumer.resume();
        console.log(
          `HLS Manager ---- Resumed consumer ${consumer.id} for producer ${consumer.producerId}`,
        );
      }
      console.log(`HLS Manager ---- HLS stream started successfully for room ${roomId}`);
    } catch (error) {
      console.error(`HLS Manager ---- Error starting HLS stream for room ${roomId}:`, error);
      this.cleanupRoomResources(roomId, plainTransports, consumers, sdpFiles);
    }
  }

  private cleanupRoomResources(
    roomId: string,
    transports: MediasoupTypes.PlainTransport[],
    consumers: MediasoupTypes.Consumer[],
    sdpFiles: string[],
  ) {
    consumers.forEach((c) => c.close());
    transports.forEach((t) => t.close());
    sdpFiles.forEach((sdpPath) => {
      if (fs.existsSync(sdpPath)) fs.unlinkSync(sdpPath);
    });
    // Optionally, delete HLS segments and playlist if FFmpeg didn't run or errored early
    const playlistPath = path.join(HLS_BASE_DIR, `${roomId}_playlist.m3u8`);
    if (fs.existsSync(playlistPath)) {
      // Basic cleanup, a more robust solution would parse the playlist
      // and delete associated .ts files. For now, just the playlist and common segments.
      fs.unlinkSync(playlistPath);
      fs.readdirSync(HLS_BASE_DIR).forEach((file) => {
        if (file.startsWith(`${roomId}_`) && file.endsWith('.ts')) {
          fs.unlinkSync(path.join(HLS_BASE_DIR, file));
        }
      });
    }
  }

  public stopHlsStream(roomId: string) {
    const streamData = this.activeStreams.get(roomId);
    if (!streamData) {
      // console.log(`HLS Manager ---- No active HLS stream to stop for room ${roomId}`);
      return;
    }

    console.log(`HLS Manager ---- Stopping HLS stream for room ${roomId}`);
    if (streamData.ffmpegProcess && !streamData.ffmpegProcess.killed) {
      streamData.ffmpegProcess.kill('SIGINT'); // Send SIGINT first for graceful shutdown
      setTimeout(() => {
        // Force kill if not exited
        if (streamData.ffmpegProcess && !streamData.ffmpegProcess.killed) {
          streamData.ffmpegProcess.kill('SIGKILL');
        }
      }, 2000);
    }

    this.cleanupRoomResources(
      roomId,
      streamData.plainTransports,
      streamData.consumers,
      streamData.sdpFiles,
    );
    this.activeStreams.delete(roomId);
    console.log(`HLS Manager ---- HLS stream stopped and resources cleaned for room ${roomId}`);
  }
}
