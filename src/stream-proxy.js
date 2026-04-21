import ffmpeg from "fluent-ffmpeg";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STREAM_SEGMENT_DIR = path.join(__dirname, "../.stream-segments");
const HLS_DURATION = 1; // seconds per segment — lower = less lag
const HLS_SEGMENTS = 3; // keep a short live window to reduce playback delay

// Ensure directory exists
if (!fs.existsSync(STREAM_SEGMENT_DIR)) {
  fs.mkdirSync(STREAM_SEGMENT_DIR, { recursive: true });
}

class StreamProxy {
  constructor() {
    this.streams = new Map(); // Map<deviceId, StreamSession>
    this.mjpegSessions = new Map(); // Map<deviceId, Set<response>>
  }

  /**
   * Start streaming from RTSP URL and convert to HLS.
   * Pass getUrlFn to enable automatic restart when Tuya's time-limited token expires.
   * @param {string} deviceId
   * @param {string} rtspUrl
   * @param {(() => Promise<string>) | null} getUrlFn  Optional async callback to fetch a fresh RTSP URL
   */
  async startStream(deviceId, rtspUrl, getUrlFn = null) {
    // Home Assistant style behavior: keep one active pipeline per camera.
    // Reuse it when healthy to avoid startup lag on repeated opens.
    const existing = this.streams.get(deviceId);
    if (existing?.isActive && fs.existsSync(existing.playlistPath)) {
      return existing;
    }

    if (this.streams.has(deviceId)) {
      this.stopStream(deviceId);
    }

    const streamSessionDir = path.join(STREAM_SEGMENT_DIR, deviceId);
    // Wipe and recreate so no stale segments are served
    if (fs.existsSync(streamSessionDir)) {
      fs.rmSync(streamSessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(streamSessionDir, { recursive: true });

    const playlistPath = path.join(streamSessionDir, "stream.m3u8");
    const segmentPattern = path.join(streamSessionDir, "segment-%03d.ts");

    const session = new StreamSession(deviceId, rtspUrl, playlistPath, segmentPattern, getUrlFn);
    session.shouldReconnect = !!getUrlFn;

    return new Promise((resolve, reject) => {
      let promiseResolved = false;
      const ffmpegCommand = ffmpeg(rtspUrl)
        .inputOptions([
          "-rtsp_transport", "tcp",
          "-tls_verify", "0",           // allow self-signed certs on rtsps://
          "-timeout", "10000000",
          "-fflags", "nobuffer+discardcorrupt",
          "-flags", "low_delay",
          "-avioflags", "direct",
        ])
        .outputOptions([
          "-c:v", "copy",
          "-an",                         // drop audio — avoids A/V sync stalls
          "-f", "hls",
          "-hls_time", String(HLS_DURATION),
          "-hls_list_size", String(HLS_SEGMENTS),
          "-hls_flags", "delete_segments+append_list+independent_segments+omit_endlist+program_date_time",
          "-hls_segment_type", "mpegts",
          "-hls_allow_cache", "0",
          "-hls_start_number_source", "datetime",
          "-hls_segment_filename", segmentPattern,
        ])
        .on("start", (cmd) => {
          console.log(`[${deviceId}] HLS FFmpeg: ${cmd}`);
          session.ffmpegProcess = ffmpegCommand;
          session.isActive = true;
          this.streams.set(deviceId, session);
          // Poll for first .ts segment — only then is the stream truly ready
          const checkInterval = setInterval(() => {
            try {
              const segs = fs.readdirSync(streamSessionDir).filter(f => f.endsWith(".ts"));
              if (segs.length > 0 && fs.existsSync(playlistPath)) {
                clearInterval(checkInterval);
                clearTimeout(waitTimeout);
                session.resolved = true;
                resolve(session);
              }
            } catch (_) {}
          }, 300);
          const waitTimeout = setTimeout(() => {
            clearInterval(checkInterval);
            promiseResolved = true;
            if (session.isActive) resolve(session);
            else reject(new Error("FFmpeg did not produce segments in time"));
          }, 20000);
        })
        .on("error", (error) => {
          console.error(`[${deviceId}] HLS error:`, error.message);
          session.isActive = false;
          this.streams.delete(deviceId);
          this._clearSessionTimers(session);
          if (session.resolved && session.shouldReconnect) {
            this._scheduleRestart(session);
          } else if (!session.resolved) {
            reject(error);
          }
        })
        .on("end", () => {
          console.log(`[${deviceId}] HLS stream ended`);
          session.isActive = false;
          this.streams.delete(deviceId);
          this._clearSessionTimers(session);
          if (session.resolved && session.shouldReconnect) {
            this._scheduleRestart(session);
          }
        })
        .save(playlistPath);
    });

  }

  _clearSessionTimers(session) {
    if (session.refreshTimer) {
      clearTimeout(session.refreshTimer);
      session.refreshTimer = null;
    }
  }

  /**
   * Schedule an HLS stream restart using the stored URL refresh function.
   * Uses capped exponential backoff; gives up after 10 attempts.
   */
  _scheduleRestart(session) {
    if (!session.getUrlFn || session.restartCount >= 10) {
      if (session.restartCount >= 10) {
        console.error(`[${session.deviceId}] Max restart attempts reached, giving up`);
      }
      return;
    }

    const delay = Math.min(3000 * Math.pow(1.5, session.restartCount), 30000);
    session.restartCount++;
    console.log(`[${session.deviceId}] Stream expired — auto-restarting in ${Math.round(delay / 1000)}s (attempt ${session.restartCount})`);

    setTimeout(async () => {
      // Don't restart if the device already has a new active stream (user restarted manually)
      if (this.streams.has(session.deviceId)) return;

      try {
        const newUrl = await session.getUrlFn();
        if (!newUrl) {
          console.error(`[${session.deviceId}] URL refresh returned empty, giving up`);
          return;
        }
        const newSession = await this.startStream(session.deviceId, newUrl, session.getUrlFn);
        newSession.restartCount = session.restartCount;
        console.log(`[${session.deviceId}] Stream auto-restarted successfully`);
      } catch (err) {
        console.error(`[${session.deviceId}] Auto-restart failed:`, err.message);
        // Carry restart count forward so backoff keeps increasing
        session.restartCount++;
        this._scheduleRestart(session);
      }
    }, delay);
  }

  /**
   * Pipe RTSP directly to an HTTP response as MJPEG multipart stream.
   * Near-zero buffer — browser displays via <img> tag.
   */
  streamMjpeg(deviceId, rtspUrl, response) {
    response.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=ffmpeg",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Connection": "keep-alive",
    });

    if (!this.mjpegSessions.has(deviceId)) {
      this.mjpegSessions.set(deviceId, new Set());
    }
    this.mjpegSessions.get(deviceId).add(response);

    const proc = ffmpeg(rtspUrl)
      .inputOptions([
        "-rtsp_transport", "tcp",
        "-tls_verify", "0",
        "-fflags", "nobuffer",
      ])
      .outputOptions([
        "-f", "mpjpeg",
        "-q:v", "5",
        "-r", "15",
      ])
      .on("start", (cmd) => console.log(`[${deviceId}] MJPEG FFmpeg: ${cmd}`))
      .on("error", (err) => {
        console.error(`[${deviceId}] MJPEG error:`, err.message);
        response.end();
        this.mjpegSessions.get(deviceId)?.delete(response);
      })
      .on("end", () => {
        response.end();
        this.mjpegSessions.get(deviceId)?.delete(response);
      });

    const stream = proc.pipe();
    stream.pipe(response, { end: false });

    response.on("close", () => {
      proc.kill();
      this.mjpegSessions.get(deviceId)?.delete(response);
    });
  }

  stopStream(deviceId) {
    const stream = this.streams.get(deviceId);
    if (!stream) {
      return;
    }
    stream.shouldReconnect = false; // cancel any pending auto-reconnect
    this._clearSessionTimers(stream);

    if (stream.ffmpegProcess) {
      stream.ffmpegProcess.kill();
    }

    stream.isActive = false;
    this.streams.delete(deviceId);

    // Clean up files
    const streamSessionDir = path.join(STREAM_SEGMENT_DIR, deviceId);
    if (fs.existsSync(streamSessionDir)) {
      fs.rmSync(streamSessionDir, { recursive: true, force: true });
    }

    console.log(`[${deviceId}] Stream stopped and cleaned up`);
  }

  /**
   * Get stream session or null if not found
   */
  getStream(deviceId) {
    const stream = this.streams.get(deviceId);
    return stream && stream.isActive ? stream : null;
  }

  /**
   * Get HLS playlist for a device
   */
  getPlaylist(deviceId) {
    const stream = this.getStream(deviceId);
    if (!stream || !fs.existsSync(stream.playlistPath)) {
      return null;
    }

    try {
      return fs.readFileSync(stream.playlistPath, "utf8");
    } catch (error) {
      console.error(`[${deviceId}] Error reading playlist:`, error);
      return null;
    }
  }

  /**
   * Get HLS segment
   */
  getSegment(deviceId, segmentName) {
    const stream = this.getStream(deviceId);
    if (!stream) {
      return null;
    }

    const segmentPath = path.join(path.dirname(stream.playlistPath), segmentName);
    if (fs.existsSync(segmentPath)) {
      return fs.readFileSync(segmentPath);
    }

    return null;
  }

  /**
   * Stop all streams
   */
  stopAllStreams() {
    for (const [deviceId] of this.streams) {
      this.stopStream(deviceId);
    }
  }
}

class StreamSession {
  constructor(deviceId, rtspUrl, playlistPath, segmentPattern, getUrlFn = null) {
    this.deviceId = deviceId;
    this.rtspUrl = rtspUrl;
    this.playlistPath = playlistPath;
    this.segmentPattern = segmentPattern;
    this.ffmpegProcess = null;
    this.isActive = false;
    this.resolved = false;
    this.getUrlFn = getUrlFn;
    this.restartCount = 0;
    this.refreshTimer = null;
    this.createdAt = new Date();
  }

  getStatus() {
    return {
      deviceId: this.deviceId,
      isActive: this.isActive,
      createdAt: this.createdAt.toISOString(),
      uptime: this.isActive ? Date.now() - this.createdAt.getTime() : 0,
    };
  }
}

export const streamProxy = new StreamProxy();

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, stopping all streams...");
  streamProxy.stopAllStreams();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, stopping all streams...");
  streamProxy.stopAllStreams();
  process.exit(0);
});
