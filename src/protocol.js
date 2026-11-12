export const SERVICE = {
  control: "04ca1501-fd57-404e-8459-c5ef8d765c8d",
  deviceInfo: 0x180a,
  tag: "16671501-e783-4330-b308-b9e1481ecfcc",
};

export const SONY_COMPANY_ID = 0x012d;

const controlUuid = (shortId) =>
  `04ca${shortId}-fd57-404e-8459-c5ef8d765c8d`;

export const CHARACTERISTIC = {
  mode: controlUuid("1503"),
  autoStart: controlUuid("1505"),
  authentication: controlUuid("1506"),
  quickLaunch: controlUuid("1509"),
  owner: controlUuid("150a"),
  capability: controlUuid("1580"),
  temperature: controlUuid("1581"),
  battery: controlUuid("1582"),
};

export const DEVICE_INFO = {
  model: 0x2a24,
  firmware: 0x2a26,
};

export const THERMO = {
  cool: 1,
  warm: 2,
  offCool: 3,
  offWarm: 4,
};

const SMART_TARGET = {
  cool: [2900, 2700, 2500, 2300, 2100],
  warm: [3800, 3900, 4050, 4125, 4200],
};

const RNP1_5_MODELS = new Set([
  "RNP-1",
  "RNP-1L",
  "RNP-1A",
  "RNP-2",
  "RNP-3",
  "RNP-4",
  "RNP-5",
]);

function isRnp1To5(model) {
  return RNP1_5_MODELS.has(model);
}

const TAG_DECRYPTION_KEY = Uint8Array.of(
  0xd2,
  0x23,
  0xec,
  0x09,
  0x13,
  0x84,
  0xf9,
  0x96,
  0x31,
  0x45,
  0xfc,
  0xf2,
  0xcf,
  0xfa,
  0x34,
  0x41,
);

function bytesOf(value) {
  return value instanceof DataView
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : value;
}

function hasBit(byte, bit) {
  return Boolean(byte & (1 << bit));
}

function setInt16(bytes, offset, value) {
  new DataView(bytes.buffer).setInt16(offset, value, false);
}

export function toHex(value) {
  return [...bytesOf(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

export function manualFrame(thermo, level, wave = false) {
  return Uint8Array.of(
    0,
    0,
    0,
    thermo,
    level - 1,
    wave ? 4 : 0,
    0,
    0,
    0,
    0,
    0,
    0,
  );
}

export function stopFrame(lastThermo, model) {
  const frame = manualFrame(
    lastThermo === THERMO.warm ? THERMO.offWarm : THERMO.offCool,
    0,
  );
  if (isRnp1To5(model)) frame[4] = 0;
  return frame;
}

export function smartFrame(kind, preference, model) {
  const bytes = new Uint8Array(20);
  const isCool = kind === "cool";
  const useSmartTargets = !isRnp1To5(model);
  bytes[0] = 4;
  bytes[3] = 1 | ((isCool ? 1 : 2) << 4);
  bytes[6] = isCool ? preference : preference << 4;
  setInt16(
    bytes,
    7,
    isCool && useSmartTargets ? SMART_TARGET.cool[preference - 1] : -32768,
  );
  setInt16(
    bytes,
    9,
    !isCool && useSmartTargets ? SMART_TARGET.warm[preference - 1] : -32768,
  );
  bytes[13] = 128;
  bytes[14] = 128;
  return bytes;
}

export function smartAutoFrame(
  coolPreference,
  warmPreference,
  coolThreshold = 25,
  warmThreshold = 20,
  model,
) {
  const bytes = new Uint8Array(20);
  const useSmartTargets = !isRnp1To5(model);
  bytes[0] = 4;
  bytes[3] = 49;
  bytes[6] = coolPreference | (warmPreference << 4);
  setInt16(
    bytes,
    7,
    useSmartTargets ? SMART_TARGET.cool[coolPreference - 1] : -32768,
  );
  setInt16(
    bytes,
    9,
    useSmartTargets ? SMART_TARGET.warm[warmPreference - 1] : -32768,
  );
  bytes[13] = coolThreshold * 2;
  bytes[14] = warmThreshold * 2;
  return bytes;
}

export function smartStopFrame(mode) {
  const bytes = new Uint8Array(20);
  const smartType = mode?.kind === "auto" ? 3 : mode?.kind === "warm" ? 2 : 1;
  bytes[0] = 4;
  bytes[3] = smartType << 4;
  setInt16(bytes, 7, -32768);
  setInt16(bytes, 9, -32768);
  bytes[13] = 128;
  bytes[14] = 128;
  return bytes;
}

export function automationFrame(enabled) {
  return enabled ? Uint8Array.of(1, 128) : Uint8Array.of(0);
}

export function tagRegistrationFrame(address, deviceType = 1) {
  const addressBytes = address
    .split(":")
    .map((byte) => Number.parseInt(byte, 16))
    .reverse();
  return Uint8Array.of(2, 1, ...addressBytes, deviceType);
}

export function tagUnregistrationFrame(deviceType = 1) {
  return Uint8Array.of(2, 2, 0, 0, 0, 0, 0, 0, deviceType);
}

export function parseTagAdvertisement(value, model) {
  const encrypted = bytesOf(value);
  const bytes = Uint8Array.from(
    encrypted,
    (byte, index) => byte ^ TAG_DECRYPTION_KEY[index % TAG_DECRYPTION_KEY.length],
  );
  const addressOffset = bytes[1] === 5 ? 21 : bytes[1] === 7 ? 16 : null;
  if (addressOffset === null || bytes.length < addressOffset + 6) {
    return null;
  }
  const address = [...bytes.slice(addressOffset, addressOffset + 6)]
    .reverse()
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
  if (address === "00:00:00:00:00:00") {
    return null;
  }
  const deviceType = { "RNPT-1": 1, "RNPT-2": 2 }[model];
  return {
    address,
    firmware: bytes[0],
    format: bytes[1],
    battery: bytes[1] === 5 ? bytes[12] : bytes[11],
    ...(deviceType ? { model, deviceType } : {}),
  };
}

export function parseCapabilities(value) {
  const bytes = bytesOf(value);
  const feature = bytes[0] ?? 0;
  const levels = bytes[2] ?? 0;
  const sensors = bytes[4] ?? 0;
  const coolLevels =
    hasBit(levels, 2) || hasBit(levels, 3)
      ? 5
      : hasBit(levels, 0) || hasBit(levels, 1)
        ? 4
        : 3;

  return {
    raw: [...bytes],
    smart: hasBit(feature, 3),
    autoStart: hasBit(feature, 4),
    wave: hasBit(feature, 6),
    quickLaunch: hasBit(feature, 7),
    coolLevels,
    warmLevels: hasBit(levels, 4) ? 4 : 3,
    environmentalSensor: hasBit(sensors, 1),
  };
}

export function parseMode(value) {
  const bytes = bytesOf(value);
  if (bytes.length < 5) {
    return null;
  }

  if (bytes[0] === 0) {
    const thermo = bytes[3];
    const running = thermo === THERMO.cool || thermo === THERMO.warm;
    const kind =
      thermo === THERMO.warm || thermo === THERMO.offWarm ? "warm" : "cool";
    return {
      type: "manual",
      kind,
      running,
      level: running ? bytes[4] + 1 : null,
      wave: hasBit(bytes[5] ?? 0, 2),
    };
  }

  if (bytes[0] === 4) {
    const running = hasBit(bytes[3], 0);
    const smartType = (bytes[3] >> 4) & 3;
    const kind = smartType === 3 ? "auto" : smartType === 2 ? "warm" : "cool";
    const coolPreference = bytes[6] & 15;
    const warmPreference = bytes[6] >> 4;
    const preference =
      kind === "cool"
        ? coolPreference
        : kind === "warm"
          ? warmPreference
          : null;
    return {
      type: "smart",
      kind,
      running,
      preference: running ? preference : null,
      coolPreference: running ? coolPreference : null,
      warmPreference: running ? warmPreference : null,
      coolThreshold: bytes[13] === 128 ? null : bytes[13] / 2,
      warmThreshold: bytes[14] === 128 ? null : bytes[14] / 2,
    };
  }

  return {
    type: "other",
    running: bytes[0] !== 15,
    action: bytes[0],
  };
}

export function parseBattery(value) {
  const bytes = bytesOf(value);
  const chargeStatus = {
    1: "discharging",
    2: "charging",
    3: "full",
    253: "too-cold",
    254: "too-hot",
  }[bytes[1]];
  const remainTime =
    bytes.length >= 5 ? new DataView(bytes.buffer, bytes.byteOffset).getUint16(3, false) : 65535;

  return {
    level: bytes[0],
    chargeStatus,
    pluggedIn: bytes[2] === 1,
    remainMinutes: remainTime === 65535 ? null : remainTime,
  };
}

export function parseTemperature(value) {
  const bytes = bytesOf(value);
  if (bytes.length < 14) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 2) {
    const temperature = view.getInt16(4, false) / 100;
    const humidity = view.getInt16(6, false) / 100;
    const illumination = view.getUint16(8, false);
    const proximity = view.getUint16(10, false);
    if (
      bytes[1] === 0 ||
      bytes[3] !== 1 ||
      temperature <= -327.68 ||
      humidity <= -327.68 ||
      bytes[13] > 100
    ) {
      return null;
    }
    return {
      source: "tag",
      firmware: bytes[1],
      format: bytes[2],
      temperature,
      humidity,
      illumination: illumination === 65535 ? null : illumination,
      proximity: proximity === 65535 ? null : proximity,
      battery: bytes[13],
    };
  }
  if (bytes.length < 15 || bytes[0] !== 1) {
    return null;
  }
  return {
    source: "device",
    surface: view.getInt16(1, false) / 100,
    element: view.getInt16(3, false) / 100,
    exhaust: view.getInt16(5, false) / 100,
  };
}

export function parseAutomation(value) {
  return bytesOf(value)[0] === 1;
}

export function parseOwnerRegistration(value, ownerKey) {
  const bytes = bytesOf(value);
  const key = bytesOf(ownerKey);
  if (
    bytes.length < 18 ||
    (bytes[0] !== 1 && bytes[0] !== 129) ||
    (bytes[1] !== 0 && bytes[1] !== 1) ||
    key.length !== 16
  ) {
    return null;
  }
  if (bytes[1] === 0) return "unregistered";
  return bytes
    .slice(2, 18)
    .every((byte, index) => byte === key[index])
    ? "mine"
    : "other";
}
