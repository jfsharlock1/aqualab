const AUTH_PROFILE_KEY = "aqualab_sensor_auth_profile";
const AUTH_SESSION_KEY = "aqualab_sensor_auth_session";

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `local-user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

async function hashAccessCode(accessCode) {
  const text = String(accessCode || "");
  if (!globalThis.crypto?.subtle) return `plain:${text}`;
  const data = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  if (!profile.localUserId || !profile.accessCodeHash) return null;
  return {
    localUserId: profile.localUserId,
    displayName: profile.displayName || "Local Sensor User",
    accessCodeHash: profile.accessCodeHash,
    authMode: "local-offline",
    createdAt: profile.createdAt || new Date().toISOString()
  };
}

export function createSensorAuthService() {
  function getProfile() {
    return normalizeProfile(loadJson(AUTH_PROFILE_KEY, null));
  }

  function getSession() {
    const profile = getProfile();
    const session = loadJson(AUTH_SESSION_KEY, null);
    if (!profile || !session || session.localUserId !== profile.localUserId) return null;
    return {
      localUserId: profile.localUserId,
      displayName: profile.displayName,
      authMode: "local-offline",
      loggedInAt: session.loggedInAt || null
    };
  }

  function isAuthenticated() {
    return Boolean(getSession());
  }

  async function createLocalProfile({ displayName, accessCode }) {
    const code = String(accessCode || "").trim();
    if (code.length < 4) {
      return { ok: false, message: "Use a local access code with at least 4 characters." };
    }

    const now = new Date().toISOString();
    const profile = {
      localUserId: createId(),
      displayName: String(displayName || "").trim() || "Local Sensor User",
      accessCodeHash: await hashAccessCode(code),
      authMode: "local-offline",
      createdAt: now
    };

    if (!saveJson(AUTH_PROFILE_KEY, profile)) {
      return { ok: false, message: "Could not save local login on this device." };
    }

    saveJson(AUTH_SESSION_KEY, { localUserId: profile.localUserId, loggedInAt: now });
    return { ok: true, user: getSession(), message: "Local Sensor Array login created." };
  }

  async function loginLocal(accessCode) {
    const profile = getProfile();
    if (!profile) {
      return { ok: false, message: "No local Sensor Array login is configured on this device yet." };
    }

    const inputHash = await hashAccessCode(String(accessCode || "").trim());
    if (inputHash !== profile.accessCodeHash) {
      return { ok: false, message: "That local access code did not match." };
    }

    saveJson(AUTH_SESSION_KEY, {
      localUserId: profile.localUserId,
      loggedInAt: new Date().toISOString()
    });
    return { ok: true, user: getSession(), message: "Signed in with local offline login." };
  }

  function logout() {
    removeItem(AUTH_SESSION_KEY);
  }

  return {
    hasLocalProfile: () => Boolean(getProfile()),
    getProfile,
    getSession,
    isAuthenticated,
    createLocalProfile,
    loginLocal,
    logout
  };
}
