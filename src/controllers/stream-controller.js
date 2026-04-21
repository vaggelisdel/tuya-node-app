import { streamProxy } from "../stream-proxy.js";

function sendError(response, status, error, extra = {}) {
  response.status(status).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

export function createStreamController(appState) {
  return {
    /**
     * Start HLS stream for a device
     */
    async startHlsStream(request, response) {
      const session = appState.getSession();
      const deviceId = request.params.deviceId;

      if (!session) {
        sendError(response, 404, "No active session");
        return;
      }

      if (!deviceId) {
        sendError(response, 400, "Missing required deviceId");
        return;
      }

      const existing = streamProxy.getStream(deviceId);
      if (existing) {
        response.json({
          success: true,
          deviceId,
          status: "streaming",
          playlistUrl: `/api/streams/${deviceId}/playlist.m3u8`,
          uptime: existing.getStatus().uptime,
        });
        return;
      }

      try {
        // Import here to avoid circular dependency
        const { createPersistentManager } = await import("../services/tuya-service.js");
        
        const manager = await createPersistentManager(appState.getSessionPath(), session);
        // Request RTSP from Tuya regardless of client method — we proxy it server-side
        const rtspUrl = await manager.getDeviceStreamUrl(deviceId, "rtsp");

        if (!rtspUrl) {
          sendError(response, 404, "No stream available for this device");
          return;
        }

        // Refresh function — called automatically when Tuya's token expires
        const getUrlFn = async () => {
          const freshManager = await createPersistentManager(appState.getSessionPath(), appState.getSession());
          return freshManager.getDeviceStreamUrl(deviceId, "rtsp");
        };

        // Start the HLS stream (FFmpeg converts RTSP → HLS segments)
        const stream = await streamProxy.startStream(deviceId, rtspUrl, getUrlFn);

        response.json({
          success: true,
          deviceId,
          status: "streaming",
          playlistUrl: `/api/streams/${deviceId}/playlist.m3u8`,
          uptime: 0,
        });
      } catch (error) {
        sendError(response, 500, error);
      }
    },

    /**
     * Stream RTSP directly as MJPEG (near real-time, low latency)
     */
    async mjpegStream(request, response) {
      const session = appState.getSession();
      const deviceId = request.params.deviceId;

      if (!session) {
        sendError(response, 404, "No active session");
        return;
      }

      if (!deviceId) {
        sendError(response, 400, "Missing required deviceId");
        return;
      }

      try {
        const { createPersistentManager } = await import("../services/tuya-service.js");
        const manager = await createPersistentManager(appState.getSessionPath(), session);
        const rtspUrl = await manager.getDeviceStreamUrl(deviceId, "rtsp");

        if (!rtspUrl) {
          sendError(response, 404, "No stream available for this device");
          return;
        }

        streamProxy.streamMjpeg(deviceId, rtspUrl, response);
      } catch (error) {
        sendError(response, 500, error);
      }
    },

    /**
     * Get HLS playlist
     */
    getPlaylist(request, response) {
      const deviceId = request.params.deviceId;

      const playlist = streamProxy.getPlaylist(deviceId);
      if (!playlist) {
        return sendError(response, 404, "Stream playlist not found");
      }

      response
        .type("application/vnd.apple.mpegurl")
        .set("Cache-Control", "no-cache, no-store, must-revalidate")
        .set("Pragma", "no-cache")
        .set("Expires", "0")
        .send(playlist);
    },

    /**
     * Get HLS segment
     */
    getSegment(request, response) {
      const deviceId = request.params.deviceId;
      // Route is /segment-:segmentName so segmentName is e.g. "000.ts"
      // Reconstruct the full filename that FFmpeg wrote: "segment-000.ts"
      const segmentName = `segment-${request.params.segmentName}`;

      if (!deviceId || !request.params.segmentName) {
        return sendError(response, 400, "Missing deviceId or segmentName");
      }

      const segment = streamProxy.getSegment(deviceId, segmentName);
      if (!segment) {
        return sendError(response, 404, "Segment not found");
      }

      response
        .type("video/MP2T")
        .set("Cache-Control", "no-cache, no-store, must-revalidate")
        .set("Pragma", "no-cache")
        .set("Expires", "0")
        .send(segment);
    },

    /**
     * Stop HLS stream
     */
    stopStream(request, response) {
      const deviceId = request.params.deviceId;

      if (!deviceId) {
        sendError(response, 400, "Missing required deviceId");
        return;
      }

      streamProxy.stopStream(deviceId);

      response.json({
        success: true,
        deviceId,
        status: "stopped",
      });
    },

    /**
     * Get stream status
     */
    getStreamStatus(request, response) {
      const deviceId = request.params.deviceId;

      if (!deviceId) {
        sendError(response, 400, "Missing required deviceId");
        return;
      }

      const stream = streamProxy.getStream(deviceId);
      if (!stream) {
        return response.json({
          success: true,
          deviceId,
          status: "inactive",
        });
      }

      response.json({
        success: true,
        deviceId,
        status: "active",
        ...stream.getStatus(),
      });
    },
  };
}
