import {
  CHARACTERISTIC,
  DEVICE_INFO,
  SERVICE,
  parseAutomation,
  parseBattery,
  parseCapabilities,
  parseMode,
  parseTagAdvertisement,
  parseTemperature,
  SONY_COMPANY_ID,
  tagRegistrationFrame,
  tagUnregistrationFrame,
  toHex,
} from "./protocol.js";

const OWNER_KEY_STORAGE = "reon-owner-key";
const TAG_ADDRESS_STORAGE = "reon-tag-address";

function ownerKey() {
  const stored = localStorage.getItem(OWNER_KEY_STORAGE);
  if (stored) {
    return Uint8Array.from(stored.match(/.{2}/g), (byte) =>
      Number.parseInt(byte, 16),
    );
  }

  const key = crypto.getRandomValues(new Uint8Array(16));
  for (let index = 0; index < key.length; index += 1) {
    key[index] %= 255;
  }
  localStorage.setItem(OWNER_KEY_STORAGE, toHex(key).replaceAll(" ", ""));
  return key;
}

async function readText(service, characteristicId) {
  const characteristic = await service.getCharacteristic(characteristicId);
  const value = await characteristic.readValue();
  return new TextDecoder().decode(value).replaceAll("\0", "");
}

function receiveTagAdvertisement(device) {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      controller.abort();
      reject(new Error("Tag broadcast timed out"));
    }, 15000);
    const finish = (result, error) => {
      window.clearTimeout(timeout);
      controller.abort();
      if (error) reject(error);
      else resolve(result);
    };
    device.addEventListener(
      "advertisementreceived",
      (event) => {
        const value = event.manufacturerData.get(SONY_COMPANY_ID);
        const tag = value ? parseTagAdvertisement(value) : null;
        if (tag) finish(tag);
      },
      { signal: controller.signal },
    );
    device
      .watchAdvertisements({ signal: controller.signal })
      .catch((error) => finish(null, error));
  });
}

export class ReonClient {
  #device;
  #characteristics = {};
  #listeners = new Set();
  #writeQueue = Promise.resolve();

  state = {
    connected: false,
    connecting: false,
    device: null,
    capabilities: null,
    mode: null,
    battery: null,
    temperature: null,
    tag: null,
    autoStart: null,
    quickLaunch: null,
    tagLinked: Boolean(localStorage.getItem(TAG_ADDRESS_STORAGE)),
    pairingTag: false,
    error: null,
  };

  onState(listener) {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  #update(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.#listeners) {
      listener(this.state);
    }
  }

  #log(direction, name, value) {
    document.dispatchEvent(
      new CustomEvent("reon-log", {
        detail: { direction, name, hex: value ? toHex(value) : "" },
      }),
    );
  }

  async connect() {
    this.#update({ connecting: true, error: null });
    try {
      this.#device ??= await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "RNP-" }],
        optionalServices: [SERVICE.control, SERVICE.deviceInfo],
      });
      this.#device.addEventListener("gattserverdisconnected", () => {
        this.#characteristics = {};
        this.#update({ connected: false, connecting: false });
      });

      const server = await this.#device.gatt.connect();
      const control = await server.getPrimaryService(SERVICE.control);
      const owner = await control.getCharacteristic(CHARACTERISTIC.owner);
      const ownerFrame = Uint8Array.of(1, ...ownerKey());
      this.#log("write", "owner", ownerFrame);
      await owner.writeValueWithResponse(ownerFrame);

      const [deviceInfo, capabilityValue] = await Promise.all([
        this.#readDeviceInfo(server),
        this.#readCharacteristic(control, "capability"),
      ]);
      const capabilities = parseCapabilities(capabilityValue);

      const characteristicNames = ["mode", "battery", "temperature"];
      characteristicNames.push("authentication");
      if (capabilities.autoStart) {
        characteristicNames.push("autoStart");
      }
      if (capabilities.quickLaunch) {
        characteristicNames.push("quickLaunch");
      }
      await Promise.all(
        characteristicNames.map(async (name) => {
          this.#characteristics[name] = await control.getCharacteristic(
            CHARACTERISTIC[name],
          );
        }),
      );

      await Promise.all(
        ["mode", "battery", "temperature"].map((name) => this.#subscribe(name)),
      );
      await this.refresh();
      this.#update({
        connected: true,
        connecting: false,
        device: deviceInfo,
        capabilities,
      });
    } catch (error) {
      this.#update({
        connected: false,
        connecting: false,
        error:
          error.name === "NotFoundError"
            ? "No device selected."
            : "Connection failed. Hold the device button for 2 seconds, then try again.",
      });
      this.#log("error", error.name, new TextEncoder().encode(error.message));
    }
  }

  disconnect() {
    this.#device?.gatt?.disconnect();
  }

  async refresh() {
    const names = [
      "mode",
      "battery",
      "temperature",
      "autoStart",
      "quickLaunch",
    ].filter((name) => this.#characteristics[name]);
    const values = await Promise.all(
      names.map(async (name) => [name, await this.#read(name)]),
    );
    this.#applyValues(values);
  }

  writeMode(frame) {
    return this.#write("mode", frame);
  }

  writeAutomation(name, frame) {
    return this.#write(name, frame);
  }

  async linkTag() {
    this.#update({ pairingTag: true, error: null });
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE.tag] }],
        optionalManufacturerData: [SONY_COMPANY_ID],
      });
      const tag = await receiveTagAdvertisement(device);
      const written = await this.#write(
        "authentication",
        tagRegistrationFrame(tag.address),
        false,
      );
      if (!written) return;
      localStorage.setItem(TAG_ADDRESS_STORAGE, tag.address);
      this.#update({ tagLinked: true });
    } catch (error) {
      this.#update({
        error:
          error.name === "NotFoundError"
            ? "No Tag selected."
            : "Could not read the Tag. Press its button, keep it nearby, and try again.",
      });
      this.#log("error", error.name, new TextEncoder().encode(error.message));
    } finally {
      this.#update({ pairingTag: false });
    }
  }

  async unlinkTag() {
    const written = await this.#write(
      "authentication",
      tagUnregistrationFrame(),
      false,
    );
    if (!written) return;
    localStorage.removeItem(TAG_ADDRESS_STORAGE);
    this.#update({ tag: null, tagLinked: false });
  }

  async #readDeviceInfo(server) {
    const service = await server.getPrimaryService(SERVICE.deviceInfo);
    const [model, firmware] = await Promise.all([
      readText(service, DEVICE_INFO.model),
      readText(service, DEVICE_INFO.firmware),
    ]);
    return { name: this.#device.name, model, firmware };
  }

  async #readCharacteristic(service, name) {
    const characteristic = await service.getCharacteristic(CHARACTERISTIC[name]);
    const value = await characteristic.readValue();
    this.#log("read", name, value);
    return value;
  }

  async #read(name) {
    const value = await this.#characteristics[name].readValue();
    this.#log("read", name, value);
    return value;
  }

  async #subscribe(name) {
    const characteristic = this.#characteristics[name];
    if (!characteristic.properties.notify) {
      return;
    }
    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      this.#log("notify", name, event.target.value);
      this.#applyValues([[name, event.target.value]]);
    });
    await characteristic.startNotifications();
  }

  #applyValues(values) {
    const patch = {};
    for (const [name, value] of values) {
      if (name === "mode") patch.mode = parseMode(value);
      if (name === "battery") patch.battery = parseBattery(value);
      if (name === "temperature") {
        const sensor = parseTemperature(value);
        if (sensor?.source === "tag") {
          patch.tag = sensor;
          patch.tagLinked = true;
        } else if (sensor) {
          patch.temperature = sensor;
        }
      }
      if (name === "autoStart") patch.autoStart = parseAutomation(value);
      if (name === "quickLaunch") patch.quickLaunch = parseAutomation(value);
    }
    this.#update(patch);
  }

  #write(name, frame, readBack = true) {
    this.#writeQueue = this.#writeQueue
      .then(async () => {
        this.#log("write", name, frame);
        await this.#characteristics[name].writeValueWithResponse(frame);
        if (readBack) {
          this.#applyValues([[name, await this.#read(name)]]);
        }
        return true;
      })
      .catch((error) => {
        this.#update({
          error: "The device rejected that change. Reconnect and try again.",
        });
        this.#log("error", error.name, new TextEncoder().encode(error.message));
        return false;
      });
    return this.#writeQueue;
  }
}
