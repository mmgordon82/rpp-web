import { afterEach, describe, expect, test } from "bun:test";
import { CHARACTERISTIC, DEVICE_INFO, SERVICE } from "./protocol.js";
import { getRegistration } from "./registration.js";
import { ReonClient } from "./reon-client.js";

const ownerKey = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const globals = ["navigator", "document", "localStorage", "CustomEvent"];
const descriptors = new Map(
  globals.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);

afterEach(() => {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

function dataView(bytes) {
  return new DataView(Uint8Array.from(bytes).buffer);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function stubGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true });
}

function connection({
  status = 1,
  otherOwner = false,
  authReadFails = false,
  ownerWriteFails = false,
} = {}) {
  const storage = memoryStorage();
  storage.setItem("reon-owner-key", toStoredKey(ownerKey));
  const writes = [];
  const currentOwner = Uint8Array.from(ownerKey);
  if (otherOwner) currentOwner[0] ^= 255;
  const values = {
    [CHARACTERISTIC.capability]: [0, 0, 0, 0, 0],
    [CHARACTERISTIC.mode]: [0, 0, 0, 3, 0],
    [CHARACTERISTIC.battery]: [100, 1, 0, 255, 255],
    [CHARACTERISTIC.temperature]: [1, 11, 184, 10, 240, 12, 28, 0, 0, 0, 0, 0, 0, 10, 1],
  };
  const control = {
    getCharacteristic: async (id) => ({
      properties: { notify: false },
      addEventListener: () => {},
      readValue: async () => {
        if (id === CHARACTERISTIC.authentication) {
          if (authReadFails) throw new Error("Read unavailable");
          return dataView([1, status, ...currentOwner]);
        }
        if (values[id]) return dataView(values[id]);
        throw new Error(`Unexpected read: ${id}`);
      },
      writeValueWithResponse: async (frame) => {
        if (id !== CHARACTERISTIC.owner) {
          throw new Error(`Unexpected write: ${id}`);
        }
        writes.push([
          ...new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength),
        ]);
        if (ownerWriteFails) throw new Error("Owner rejected");
      },
    }),
  };
  const deviceInfo = {
    getCharacteristic: async (id) => ({
      readValue: async () =>
        dataView(
          new TextEncoder().encode(
            id === DEVICE_INFO.model ? "RNP-5" : "1.0.0",
          ),
        ),
    }),
  };
  let disconnects = 0;
  const device = {
    id: "browser-device-id",
    name: "RNP-5",
    addEventListener: () => {},
    gatt: {
      connect: async () => ({
        getPrimaryService: async (id) => {
          if (id === SERVICE.control) return control;
          if (id === SERVICE.deviceInfo) return deviceInfo;
          throw new Error(`Unexpected service: ${id}`);
        },
      }),
      disconnect: () => {
        disconnects += 1;
      },
    },
  };

  stubGlobal("navigator", {
    bluetooth: { requestDevice: async () => device },
  });
  stubGlobal("document", { dispatchEvent: () => {} });
  stubGlobal("localStorage", storage);
  stubGlobal(
    "CustomEvent",
    class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
  );
  return { storage, writes, disconnects: () => disconnects };
}

function toStoredKey(key) {
  return [...key]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("owner connection flow", () => {
  test("does not write an owner key over another owner's registration", async () => {
    const connectionState = connection({ otherOwner: true });
    const client = new ReonClient();

    await client.connect();

    expect(connectionState.writes).toHaveLength(0);
    expect(connectionState.disconnects()).toBe(1);
    expect(client.state.connected).toBe(false);
    expect(client.state.ownership).toBe("other");
    expect(client.state.error).toContain("15 seconds");
    expect(client.state.error).toContain("instead of Sony's app");
    expect(
      getRegistration(connectionState.storage, "browser-device-id")?.registered,
    ).toBe(false);
  });

  test("reuses this browser's owner key with the normal connection write", async () => {
    const connectionState = connection();
    const client = new ReonClient();

    await client.connect();

    expect(connectionState.writes).toEqual([[1, ...ownerKey]]);
    expect(client.state.connected).toBe(true);
    expect(client.state.ownership).toBe("mine");
    expect(
      getRegistration(connectionState.storage, "browser-device-id")?.registered,
    ).toBe(true);
  });

  test("claims an unregistered device for this browser", async () => {
    const connectionState = connection({ status: 0 });
    const client = new ReonClient();

    await client.connect();

    expect(connectionState.writes).toEqual([[1, ...ownerKey]]);
    expect(client.state.connected).toBe(true);
    expect(client.state.ownership).toBe("mine");
  });

  test("falls back to reset guidance when ownership checks are inconclusive", async () => {
    const connectionState = connection({
      authReadFails: true,
      ownerWriteFails: true,
    });
    const client = new ReonClient();

    await client.connect();

    expect(connectionState.writes).toEqual([[1, ...ownerKey]]);
    expect(client.state.connected).toBe(false);
    expect(client.state.ownership).toBe("unknown");
    expect(client.state.error).toContain("may still be registered");
    expect(getRegistration(connectionState.storage, "browser-device-id")).toBeNull();
  });
});
