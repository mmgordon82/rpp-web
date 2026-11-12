import {
  THERMO,
  automationFrame,
  manualFrame,
  smartAutoFrame,
  smartFrame,
  smartStopFrame,
  stopFrame,
} from "./protocol.js";
import { ReonClient } from "./reon-client.js";

const client = new ReonClient();
const connectButton = document.querySelector("#connect");
const connectionLabel = document.querySelector("#connection");
const connectionDot = document.querySelector("#connection-dot");
const deviceLabel = document.querySelector("#device");
const batteryLabel = document.querySelector("#battery");
const batteryFill = document.querySelector("#battery-fill");
const modeSummary = document.querySelector("#mode-summary");
const temperatureLabel = document.querySelector("#temperature");
const contactLabel = document.querySelector("#contact");
const stopButton = document.querySelector("#stop");
const waveControl = document.querySelector("#wave-control");
const waveInput = document.querySelector("#wave");
const autoStartControl = document.querySelector("#auto-start-control");
const autoStartInput = document.querySelector("#auto-start");
const quickLaunchControl = document.querySelector("#quick-launch-control");
const quickLaunchInput = document.querySelector("#quick-launch");
const tagControl = document.querySelector("#tag-control");
const tagLinkButton = document.querySelector("#tag-link");
const tagLinkStatus = document.querySelector("#tag-link-status");
const manualControls = document.querySelector("#manual-controls");
const smartControls = document.querySelector("#smart-controls");
const smartTab = document.querySelector("#smart-tab");
const smartAuto = document.querySelector("#smart-auto");
const smartAutoStart = document.querySelector("#smart-auto-start");
const smartAutoButtons = [...document.querySelectorAll("[data-smart-auto]")];
const tagStatus = document.querySelector("#tag-status");
const coolThreshold = document.querySelector("#cool-threshold");
const warmThreshold = document.querySelector("#warm-threshold");
const coolThresholdOutput = document.querySelector("#cool-threshold-output");
const warmThresholdOutput = document.querySelector("#warm-threshold-output");
const automations = document.querySelector(".automations");
const tabList = document.querySelector(".tabs");
const gauge = document.querySelector(".gauge");
const tabs = [...document.querySelectorAll("[data-control-tab]")];
const manualButtons = [...document.querySelectorAll("[data-manual]")];
const smartButtons = [...document.querySelectorAll("[data-smart]")];
const errorLabel = document.querySelector("#error");
const logOutput = document.querySelector("#log");
let selectedTab = "manual";
let lastThermo = THERMO.cool;
let smartAutoCoolPreference = 3;
let smartAutoWarmPreference = 3;
const SCALE_MIN = 12;
const SCALE_MAX = 42;

function setControlsEnabled(enabled) {
  for (const control of [
    ...manualButtons,
    ...smartButtons,
    ...smartAutoButtons,
    stopButton,
    smartAutoStart,
    coolThreshold,
    warmThreshold,
    waveInput,
    autoStartInput,
    quickLaunchInput,
  ]) {
    control.disabled = !enabled;
  }
}

function modeText(mode) {
  if (!mode?.running) return "Stopped";
  if (mode.type === "manual") {
    return `${mode.kind === "cool" ? "Cooling" : "Warming"} · Level ${mode.level}`;
  }
  if (mode.type === "smart") {
    if (mode.kind === "auto") {
      return `Smart Auto · C${mode.coolPreference} / W${mode.warmPreference}`;
    }
    return `Smart ${mode.kind === "cool" ? "Cool" : "Warm"} · ${mode.preference}/5`;
  }
  return "Running";
}

function showTab(name) {
  selectedTab = name;
  manualControls.hidden = name !== "manual";
  smartControls.hidden = name !== "smart";
  for (const tab of tabs) {
    const active = tab.dataset.controlTab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function renderGauge(temperature, mode) {
  const position = temperature
    ? (temperature.surface - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)
    : 0.5;
  gauge.style.setProperty(
    "--strip-pos",
    `${Math.min(1, Math.max(0, position)) * 100}%`,
  );
  gauge.classList.toggle("live", Boolean(temperature));
  gauge.classList.toggle("worn", Boolean(temperature?.contact));
  gauge.classList.toggle("cool", Boolean(mode?.running) && mode.kind === "cool");
  gauge.classList.toggle("warm", Boolean(mode?.running) && mode.kind === "warm");
}

function render(state) {
  const {
    connected,
    connecting,
    device,
    capabilities,
    mode,
    battery,
    temperature,
    tag,
  } = state;
  connectionDot.classList.toggle("connected", connected);
  connectionDot.classList.toggle("connecting", connecting);
  connectionLabel.textContent = connecting
    ? "Connecting…"
    : connected
      ? "Connected"
      : "Not connected";
  connectButton.textContent = connected ? "Disconnect" : connecting ? "Connecting…" : "Connect";
  connectButton.disabled = connecting;
  deviceLabel.textContent = device
    ? `${device.model} · Firmware ${device.firmware}`
    : "REON Pocket Pro Plus";
  errorLabel.textContent = state.error ?? "";
  errorLabel.hidden = !state.error;

  modeSummary.textContent = modeText(mode);
  setControlsEnabled(connected);
  stopButton.disabled = !connected || !mode?.running;

  if (battery) {
    const charging =
      battery.chargeStatus === "charging" || battery.chargeStatus === "full";
    batteryLabel.textContent = `${battery.level}%${charging ? " · Charging" : ""}`;
    batteryFill.style.width = `${battery.level}%`;
    batteryFill.classList.toggle("low", !charging && battery.level <= 20);
  }

  temperatureLabel.textContent = temperature
    ? temperature.surface.toFixed(1)
    : "--.-";
  contactLabel.textContent = connected
    ? "Live surface temperature"
    : "Waiting for device";
  renderGauge(temperature, mode);

  automations.hidden = !capabilities;
  smartTab.hidden = capabilities ? !capabilities.smart : true;
  waveControl.hidden = capabilities ? !capabilities.wave : true;
  autoStartControl.hidden = capabilities ? !capabilities.autoStart : true;
  quickLaunchControl.hidden = capabilities ? !capabilities.quickLaunch : true;
  tagControl.hidden = capabilities ? !capabilities.smart : true;
  tagLinkButton.disabled = !connected || state.pairingTag;
  tagLinkButton.textContent = state.pairingTag
    ? "Finding…"
    : state.tagLinked
      ? "Unlink"
      : "Link Tag";
  tagLinkStatus.textContent = state.tagLinked
    ? tag
      ? `${tag.temperature.toFixed(1)}°C · ${Math.round(tag.humidity)}% humidity · ${tag.battery}%`
      : "Linked · waiting for a reading"
    : "Required for automatic Cool ⇄ Warm";

  smartAuto.hidden = !state.tagLinked;
  if (tag) {
    tagStatus.textContent = `Tag · ${tag.battery}% · ${tag.temperature.toFixed(1)}° · ${Math.round(tag.humidity)}%`;
  }

  if (capabilities) {
    for (const button of manualButtons) {
      const max =
        button.dataset.kind === "cool"
          ? capabilities.coolLevels
          : capabilities.warmLevels;
      button.hidden = Number(button.dataset.level) > max;
    }
  }

  if (mode?.kind === "warm") {
    lastThermo = THERMO.warm;
  } else if (mode?.kind === "cool") {
    lastThermo = THERMO.cool;
  }
  waveInput.checked = mode?.type === "manual" && mode.wave;
  autoStartInput.checked = state.autoStart ?? false;
  quickLaunchInput.checked = state.quickLaunch ?? false;
  if (mode?.type === "smart" && mode.kind === "auto" && mode.running) {
    smartAutoCoolPreference = mode.coolPreference;
    smartAutoWarmPreference = mode.warmPreference;
    if (mode.coolThreshold !== null) coolThreshold.value = mode.coolThreshold;
    if (mode.warmThreshold !== null) warmThreshold.value = mode.warmThreshold;
  }
  renderSmartAuto();

  for (const button of manualButtons) {
    setActive(
      button,
      mode?.type === "manual" &&
        mode.running &&
        mode.kind === button.dataset.kind &&
        mode.level === Number(button.dataset.level),
    );
  }
  for (const button of smartButtons) {
    setActive(
      button,
      mode?.type === "smart" &&
        mode.running &&
        mode.kind === button.dataset.kind &&
        mode.preference === Number(button.dataset.preference),
    );
  }
}

function renderSmartAuto() {
  coolThresholdOutput.textContent = `${coolThreshold.value}°C`;
  warmThresholdOutput.textContent = `${warmThreshold.value}°C`;
  for (const button of smartAutoButtons) {
    const preference =
      button.dataset.kind === "cool"
        ? smartAutoCoolPreference
        : smartAutoWarmPreference;
    setActive(button, Number(button.dataset.preference) === preference);
  }
}

function setActive(button, active) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
}

connectButton.addEventListener("click", () => {
  if (client.state.connected) {
    client.disconnect();
  } else {
    client.connect();
  }
});

for (const tab of tabs) {
  tab.addEventListener("click", () => showTab(tab.dataset.controlTab));
}

tabList.addEventListener("keydown", (event) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  const visible = tabs.filter((tab) => !tab.hidden);
  if (!step || visible.length < 2) return;
  event.preventDefault();
  const index = visible.indexOf(document.activeElement);
  const next = visible[(index + step + visible.length) % visible.length];
  showTab(next.dataset.controlTab);
  next.focus();
});

for (const button of manualButtons) {
  button.addEventListener("click", () => {
    const thermo = button.dataset.kind === "cool" ? THERMO.cool : THERMO.warm;
    lastThermo = thermo;
    client.writeMode(
      manualFrame(thermo, Number(button.dataset.level), waveInput.checked),
    );
  });
}

for (const button of smartButtons) {
  button.addEventListener("click", () => {
    client.writeMode(
      smartFrame(
        button.dataset.kind,
        Number(button.dataset.preference),
        client.state.device?.model,
      ),
    );
  });
}

for (const button of smartAutoButtons) {
  button.addEventListener("click", () => {
    const preference = Number(button.dataset.preference);
    if (button.dataset.kind === "cool") {
      smartAutoCoolPreference = preference;
    } else {
      smartAutoWarmPreference = preference;
    }
    renderSmartAuto();
    if (client.state.mode?.kind === "auto" && client.state.mode.running) {
      smartAutoStart.click();
    }
  });
}

for (const threshold of [coolThreshold, warmThreshold]) {
  threshold.addEventListener("input", () => {
    if (
      threshold === coolThreshold &&
      Number(coolThreshold.value) < Number(warmThreshold.value)
    ) {
      warmThreshold.value = coolThreshold.value;
    }
    if (
      threshold === warmThreshold &&
      Number(warmThreshold.value) > Number(coolThreshold.value)
    ) {
      coolThreshold.value = warmThreshold.value;
    }
    renderSmartAuto();
  });
  threshold.addEventListener("change", () => {
    if (client.state.mode?.kind === "auto" && client.state.mode.running) {
      smartAutoStart.click();
    }
  });
}

smartAutoStart.addEventListener("click", () => {
  client.writeMode(
    smartAutoFrame(
      smartAutoCoolPreference,
      smartAutoWarmPreference,
      Number(coolThreshold.value),
      Number(warmThreshold.value),
      client.state.device?.model,
    ),
  );
});

waveInput.addEventListener("change", () => {
  const mode = client.state.mode;
  if (mode?.type === "manual" && mode.running) {
    client.writeMode(
      manualFrame(
        mode.kind === "cool" ? THERMO.cool : THERMO.warm,
        mode.level,
        waveInput.checked,
      ),
    );
  }
});

autoStartInput.addEventListener("change", () => {
  client.writeAutomation("autoStart", automationFrame(autoStartInput.checked));
});

quickLaunchInput.addEventListener("change", () => {
  client.writeAutomation(
    "quickLaunch",
    automationFrame(quickLaunchInput.checked),
  );
});

tagLinkButton.addEventListener("click", () => {
  if (client.state.tagLinked) {
    client.unlinkTag();
  } else {
    client.linkTag();
  }
});

stopButton.addEventListener("click", () => {
  const mode = client.state.mode;
  client.writeMode(
    mode?.type === "smart"
      ? smartStopFrame(mode)
      : stopFrame(lastThermo, client.state.device?.model),
  );
});

document.addEventListener("reon-log", ({ detail }) => {
  const line = `${new Date().toLocaleTimeString()} ${detail.direction} ${detail.name}${detail.hex ? ` · ${detail.hex}` : ""}`;
  logOutput.textContent = `${line}\n${logOutput.textContent}`.slice(0, 12000);
});

client.onState(render);
showTab(selectedTab);

if (!navigator.bluetooth) {
  connectButton.disabled = true;
  connectionLabel.textContent = "Open in Chrome on macOS or Android";
}
