const REGISTRATION_STORAGE = "reon-device-registrations";

function readRegistrations(storage) {
  try {
    const registrations = JSON.parse(
      storage.getItem(REGISTRATION_STORAGE) ?? "{}",
    );
    return registrations &&
      typeof registrations === "object" &&
      !Array.isArray(registrations)
      ? registrations
      : {};
  } catch {
    return {};
  }
}

export function getRegistration(storage, deviceId) {
  if (!deviceId) return null;
  const registration = readRegistrations(storage)[deviceId];
  return typeof registration?.registered === "boolean" ? registration : null;
}

export function saveRegistration(storage, device, registered) {
  if (!device.id) return false;
  try {
    const registrations = readRegistrations(storage);
    registrations[device.id] = {
      name: device.name ?? null,
      model: device.model ?? null,
      registered,
    };
    storage.setItem(REGISTRATION_STORAGE, JSON.stringify(registrations));
    return true;
  } catch {
    return false;
  }
}
