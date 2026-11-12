import { describe, expect, test } from "bun:test";
import {
  THERMO,
  automationFrame,
  manualFrame,
  parseBattery,
  parseCapabilities,
  parseMode,
  parseTagAdvertisement,
  parseTemperature,
  smartAutoFrame,
  smartFrame,
  smartStopFrame,
  stopFrame,
  tagRegistrationFrame,
  tagUnregistrationFrame,
} from "./protocol.js";

describe("REON protocol", () => {
  test("builds manual, wave, and stop commands", () => {
    expect([...manualFrame(THERMO.cool, 5)]).toEqual([
      0, 0, 0, 1, 4, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect([...manualFrame(THERMO.warm, 2, true)]).toEqual([
      0, 0, 0, 2, 1, 4, 0, 0, 0, 0, 0, 0,
    ]);
    expect([...stopFrame(THERMO.warm)]).toEqual([
      0, 0, 0, 4, 255, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  test("builds smart temperature commands", () => {
    expect([...smartFrame("cool", 3)]).toEqual([
      4, 0, 0, 17, 0, 0, 3, 9, 196, 128, 0, 0, 0, 128, 128, 0, 0, 0, 0, 0,
    ]);
    expect([...smartFrame("warm", 5)]).toEqual([
      4, 0, 0, 33, 0, 0, 80, 128, 0, 16, 104, 0, 0, 128, 128, 0, 0, 0, 0, 0,
    ]);
    expect([...smartAutoFrame(3, 4)]).toEqual([
      4, 0, 0, 49, 0, 0, 67, 9, 196, 16, 29, 0, 0, 50, 40, 0, 0, 0, 0, 0,
    ]);
    expect([...smartStopFrame({ kind: "auto" })]).toEqual([
      4, 0, 0, 48, 0, 0, 0, 128, 0, 128, 0, 0, 0, 128, 128, 0, 0, 0, 0, 0,
    ]);
  });

  test("builds RNP 1-5 command variants", () => {
    for (const model of [
      "RNP-1",
      "RNP-1L",
      "RNP-1A",
      "RNP-2",
      "RNP-3",
      "RNP-4",
      "RNP-5",
    ]) {
      expect([...stopFrame(THERMO.cool, model)]).toEqual([
        0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0,
      ]);
    }
    expect([...stopFrame(THERMO.warm, "RNP-5")]).toEqual([
      0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect([...stopFrame(THERMO.warm, "RNP-P1")]).toEqual([
      0, 0, 0, 4, 255, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect([...smartFrame("cool", 3, "RNP-5")]).toEqual([
      4, 0, 0, 17, 0, 0, 3, 128, 0, 128, 0, 0, 0, 128, 128, 0, 0, 0, 0, 0,
    ]);
    expect([...smartFrame("warm", 5, "RNP-5")]).toEqual([
      4, 0, 0, 33, 0, 0, 80, 128, 0, 128, 0, 0, 0, 128, 128, 0, 0, 0, 0, 0,
    ]);
    expect([...smartAutoFrame(3, 4, 25, 20, "RNP-5")]).toEqual([
      4, 0, 0, 49, 0, 0, 67, 128, 0, 128, 0, 0, 0, 50, 40, 0, 0, 0, 0, 0,
    ]);
    expect([...smartFrame("cool", 3, "RNP-P1")]).toEqual([
      4, 0, 0, 17, 0, 0, 3, 9, 196, 128, 0, 0, 0, 128, 128, 0, 0, 0, 0, 0,
    ]);
  });

  test("parses device state", () => {
    expect(parseMode(Uint8Array.of(0, 0, 0, 1, 4, 4))).toMatchObject({
      type: "manual",
      kind: "cool",
      running: true,
      level: 5,
      wave: true,
    });
    expect(parseBattery(Uint8Array.of(100, 2, 1, 0, 90))).toEqual({
      level: 100,
      chargeStatus: "charging",
      pluggedIn: true,
      remainMinutes: 90,
    });
    expect(parseTemperature(Uint8Array.of(1, 11, 184, 10, 240, 12, 28, 0, 0, 0, 0, 0, 0, 10, 1))).toMatchObject({
      source: "device",
      surface: 30,
      element: 28,
      exhaust: 31,
    });
    expect(parseTemperature(Uint8Array.of(2, 5, 1, 1, 11, 184, 21, 124, 0, 0, 0, 0, 0, 88))).toEqual({
      source: "tag",
      firmware: 5,
      temperature: 30,
      humidity: 55,
      battery: 88,
    });
    expect(
      parseTemperature(
        Uint8Array.of(2, 0, 0, 255, 128, 0, 128, 0, 255, 255, 255, 255, 12, 255),
      ),
    ).toBeNull();
  });

  test("uses capabilities as the product surface", () => {
    expect(parseCapabilities(Uint8Array.of(216, 0, 20, 0, 2))).toEqual({
      raw: [216, 0, 20, 0, 2],
      smart: true,
      autoStart: true,
      wave: true,
      quickLaunch: true,
      coolLevels: 5,
      warmLevels: 4,
      environmentalSensor: true,
    });
    expect([...automationFrame(true)]).toEqual([1, 128]);
    expect([...automationFrame(false)]).toEqual([0]);
  });

  test("discovers and registers a REON Pocket Tag", () => {
    const key = [
      0xd2, 0x23, 0xec, 0x09, 0x13, 0x84, 0xf9, 0x96, 0x31, 0x45, 0xfc,
      0xf2, 0xcf, 0xfa, 0x34, 0x41,
    ];
    const advertisement = new Uint8Array(27);
    advertisement[0] = 5;
    advertisement[1] = 5;
    advertisement[12] = 91;
    advertisement.set([0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa], 21);
    const encrypted = advertisement.map(
      (byte, index) => byte ^ key[index % key.length],
    );

    expect(parseTagAdvertisement(encrypted)).toEqual({
      address: "AA:BB:CC:DD:EE:FF",
      firmware: 5,
      format: 5,
      battery: 91,
    });
    expect([...tagRegistrationFrame("AA:BB:CC:DD:EE:FF")]).toEqual([
      2, 1, 255, 238, 221, 204, 187, 170, 1,
    ]);
    expect([...tagUnregistrationFrame()]).toEqual([
      2, 2, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });
});
