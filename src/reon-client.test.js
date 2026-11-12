import { afterEach, describe, expect, test } from "bun:test";
import {
  CHARACTERISTIC,
  DEVICE_INFO,
  SERVICE,
  SONY_COMPANY_ID,
} from "./protocol.js";
import { getRegistration } from "./registration.js";
import { ReonClient } from "./reon-client.js";

const ownerKey = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const globals = [
  "navigator",
  "document",
  "localStorage",
  "CustomEvent",
  "window",
];
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
    removeItem: (key) => values.delete(key),
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
        if (
          id !== CHARACTERISTIC.owner &&
          id !== CHARACTERISTIC.authentication
        ) {
          throw new Error(`Unexpected write: ${id}`);
        }
        writes.push([
          ...new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength),
        ]);
        if (id === CHARACTERISTIC.owner && ownerWriteFails) {
          throw new Error("Owner rejected");
        }
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
  stubGlobal("window", {
    setTimeout: setTimeout.bind(globalThis),
    clearTimeout: clearTimeout.bind(globalThis),
  });
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

function selectTag2() {
  const key = [
    0xd2, 0x23, 0xec, 0x09, 0x13, 0x84, 0xf9, 0x96, 0x31, 0x45, 0xfc,
    0xf2, 0xcf, 0xfa, 0x34, 0x41,
  ];
  const advertisement = new Uint8Array(22);
  advertisement[0] = 2;
  advertisement[1] = 7;
  advertisement[11] = 76;
  advertisement.set([0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa], 16);
  const encrypted = advertisement.map(
    (byte, index) => byte ^ key[index % key.length],
  );
  const device = {
    name: "RNPT-2",
    addEventListener: (type, listener) => {
      queueMicrotask(() =>
        listener({
          manufacturerData: new Map([
            [SONY_COMPANY_ID, dataView(encrypted)],
          ]),
        }),
      );
    },
    watchAdvertisements: async () => {},
  };
  navigator.bluetooth.requestDevice = async () => device;
}

describe("Tag registration", () => {
  test("registers a discovered Tag 2 and persists its model", async () => {
    const connectionState = connection();
    const client = new ReonClient();
    await client.connect();
    selectTag2();

    await client.linkTag();

    expect(connectionState.writes[1]).toEqual([
      2, 1, 255, 238, 221, 204, 187, 170, 2,
    ]);
    expect(connectionState.storage.getItem("reon-tag-address")).toBe(
      "AA:BB:CC:DD:EE:FF",
    );
    expect(
      JSON.parse(connectionState.storage.getItem("reon-tag-info")),
    ).toEqual({
      address: "AA:BB:CC:DD:EE:FF",
      model: "RNPT-2",
      deviceType: 2,
    });
    expect(client.state.tagLinked).toBe(true);
    expect(client.state.pairingTag).toBe(false);

    await client.unlinkTag();

    expect(connectionState.writes[2]).toEqual([
      2, 2, 0, 0, 0, 0, 0, 0, 2,
    ]);
    expect(connectionState.storage.getItem("reon-tag-address")).toBeNull();
    expect(connectionState.storage.getItem("reon-tag-info")).toBeNull();
    expect(client.state.tagLinked).toBe(false);
  });

  test("keeps existing address-only Tag registrations compatible", () => {
    const connectionState = connection();
    connectionState.storage.setItem("reon-tag-address", "AA:BB:CC:DD:EE:FF");

    const client = new ReonClient();

    expect(client.state.tagLinked).toBe(true);
  });
});
