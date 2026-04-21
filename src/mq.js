import { randomUUID } from "node:crypto";

import { PATHS, PROTOCOL_DEVICE_REPORT, PROTOCOL_OTHER } from "./constants.js";

export class SharingMq {
  constructor(customerApi, ownerIds, devices) {
    this.api = customerApi;
    this.ownerIds = ownerIds;
    this.devices = devices;
    this.messageListeners = new Set();
    this.client = null;
    this.mqConfig = null;
  }

  async getMqttConfig() {
    const response = await this.api.post(PATHS.mqttConfig, null, {
      linkId: `tuya-device-sharing-sdk-node.${randomUUID()}`,
    });
    return response.result ?? {};
  }

  async start() {
    let mqtt;
    try {
      mqtt = await import("mqtt");
    } catch (error) {
      throw new Error(
        "Realtime Tuya MQTT requires the optional `mqtt` package. Run `npm install` in tools/tuya-node-app first.",
        { cause: error },
      );
    }

    this.mqConfig = await this.getMqttConfig();
    const client = mqtt.connect(this.mqConfig.url, {
      clientId: this.mqConfig.clientId,
      username: this.mqConfig.username,
      password: this.mqConfig.password,
    });

    client.on("connect", () => {
      const ownerTopic = this.mqConfig.topic?.ownerId?.sub;
      if (ownerTopic) {
        for (const ownerId of this.ownerIds) {
          client.subscribe(ownerTopic.replace("{ownerId}", ownerId));
        }
      }

      for (const device of this.devices) {
        client.subscribe(this.subscribeTopic(device.id, device.support_local));
      }
    });

    client.on("message", (topic, payload) => {
      void topic;
      const message = JSON.parse(payload.toString("utf8"));
      for (const listener of this.messageListeners) {
        listener(message);
      }
    });

    this.client = client;
  }

  stop() {
    this.messageListeners.clear();
    this.client?.end(true);
    this.client = null;
  }

  subscribeTopic(deviceId, supportLocal) {
    const deviceTopic = this.mqConfig?.topic?.devId?.sub;
    if (!deviceTopic) {
      throw new Error("Missing device MQTT topic template");
    }
    return `${deviceTopic.replace("{devId}", deviceId)}${supportLocal ? "/pen" : "/sta"}`;
  }

  subscribeDevice(device) {
    this.devices.push(device);
    this.client?.subscribe(this.subscribeTopic(device.id, device.support_local));
  }

  unsubscribeDevice(deviceId, supportLocal) {
    this.client?.unsubscribe(this.subscribeTopic(deviceId, supportLocal));
  }

  addMessageListener(listener) {
    this.messageListeners.add(listener);
  }

  removeMessageListener(listener) {
    this.messageListeners.delete(listener);
  }
}

export { PROTOCOL_DEVICE_REPORT, PROTOCOL_OTHER };
