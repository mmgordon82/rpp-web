import { describe, expect, test } from "bun:test";
import { parseOwnerRegistration } from "./protocol.js";
import { getRegistration, saveRegistration } from "./registration.js";

const ownerKey = Uint8Array.from({ length: 16 }, (_, index) => index + 1);

function ownerFrame(status, owner = ownerKey, type = 1) {
  return Uint8Array.of(type, status, ...owner);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("ownership", () => {
  test("identifies unregistered, current-owner, and other-owner records", () => {
    expect(parseOwnerRegistration(ownerFrame(0), ownerKey)).toBe("unregistered");
    expect(parseOwnerRegistration(ownerFrame(1), ownerKey)).toBe("mine");
    expect(parseOwnerRegistration(ownerFrame(0, ownerKey, 129), ownerKey)).toBe(
      "unregistered",
    );

    const otherKey = Uint8Array.from(ownerKey).reverse();
    expect(parseOwnerRegistration(ownerFrame(1, otherKey), ownerKey)).toBe(
      "other",
    );
  });

  test("rejects records that cannot prove ownership", () => {
    expect(parseOwnerRegistration(ownerFrame(2), ownerKey)).toBeNull();
    expect(parseOwnerRegistration(ownerFrame(1, ownerKey, 2), ownerKey)).toBeNull();
    expect(parseOwnerRegistration(Uint8Array.of(1, 1, 1), ownerKey)).toBeNull();
    expect(parseOwnerRegistration(ownerFrame(1), ownerKey.slice(0, 15))).toBeNull();
  });

  test("stores registration independently for each browser device ID", () => {
    const storage = memoryStorage();
    const pocket = { id: "pocket-id", name: "RNP-5", model: "RNP-5" };
    const pro = { id: "pro-id", name: "RNP-P1", model: "RNP-P1" };

    expect(saveRegistration(storage, pocket, true)).toBe(true);
    expect(saveRegistration(storage, pro, false)).toBe(true);
    expect(getRegistration(storage, pocket.id)).toEqual({
      name: "RNP-5",
      model: "RNP-5",
      registered: true,
    });
    expect(getRegistration(storage, pro.id)?.registered).toBe(false);
  });

  test("handles missing, malformed, and unavailable local storage", () => {
    const storage = memoryStorage();
    expect(getRegistration(storage, "missing")).toBeNull();
    expect(getRegistration(storage, "")).toBeNull();
    storage.setItem("reon-device-registrations", "not json");
    expect(getRegistration(storage, "pocket-id")).toBeNull();
    expect(saveRegistration(storage, { id: "pocket-id" }, true)).toBe(true);
    expect(getRegistration(storage, "pocket-id")?.registered).toBe(true);

    const unavailable = {
      getItem: () => {
        throw new Error("Unavailable");
      },
      setItem: () => {
        throw new Error("Unavailable");
      },
    };
    expect(getRegistration(unavailable, "pocket-id")).toBeNull();
    expect(saveRegistration(unavailable, { id: "pocket-id" }, true)).toBe(false);
    expect(saveRegistration(storage, {}, true)).toBe(false);
  });
});
