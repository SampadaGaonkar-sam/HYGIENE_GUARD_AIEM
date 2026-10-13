import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, update, push, serverTimestamp } from 'firebase/database';

const STORAGE_KEY = 'hygiene_guard_firebase_config';

// Default configuration template
// Users can provide config via .env or directly via the UI Settings Modal
export const defaultFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBU1GP6GXYWQFr5P4A_gnzT5LsMRUfXdTk",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "hygieneguard.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://hygieneguard-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "hygieneguard",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "hygieneguard.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "239165743826",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:239165743826:web:ffde39cd0df1017bd4830b"
};

export function getStoredFirebaseConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error("Error reading Firebase config from storage:", e);
  }
  return defaultFirebaseConfig;
}

export function saveFirebaseConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    // Reinitialize
    return initFirebase(config);
  } catch (e) {
    console.error("Error saving Firebase config:", e);
    return null;
  }
}

let firebaseApp = null;
let firebaseDb = null;

export function initFirebase(customConfig = null) {
  const config = customConfig || getStoredFirebaseConfig();

  // Validate if minimum required fields exist
  if (!config.databaseURL && !config.projectId) {
    return null;
  }

  try {
    if (getApps().length > 0) {
      firebaseApp = getApp();
    } else {
      firebaseApp = initializeApp(config);
    }
    firebaseDb = getDatabase(firebaseApp, config.databaseURL || undefined);
    return firebaseDb;
  } catch (err) {
    console.warn("Firebase initialization skipped or failed:", err);
    return null;
  }
}

export function getFirebaseDb() {
  if (!firebaseDb) {
    return initFirebase();
  }
  return firebaseDb;
}

export function isFirebaseConfigured() {
  const config = getStoredFirebaseConfig();
  return Boolean(config && (config.databaseURL || config.projectId));
}

// Helper: Calculate overview metrics from Firebase collections
export function calculateFirebaseOverview(washrooms = [], cleaners = [], tasks = []) {
  const totalWashrooms = washrooms.length;
  if (totalWashrooms === 0) {
    return {
      hygieneScore: null,
      totalWashrooms: 0,
      optimalWashrooms: 0,
      washroomsInAlert: 0,
      totalOccupied: 0,
      totalFootfallToday: 0,
      availableCleaners: cleaners.filter(c => c.status === 'Available').length,
      activeTasks: tasks.filter(t => t.status !== 'Completed').length
    };
  }

  const washroomsInAlert = washrooms.filter(w => w.cleaningAlert).length;
  const optimalWashrooms = totalWashrooms - washroomsInAlert;
  const totalOccupied = washrooms.filter(w => w.occupied === true).length;
  const totalFootfallToday = washrooms.reduce((acc, w) => acc + (Number(w.totalVisitorsToday) || 0), 0);

  // Hygiene score is strictly derived from active online reporting sensors
  const reportingWashrooms = washrooms.filter(w => w.esp32Connected && typeof w.gasPpm === 'number');
  let hygieneScore = null;
  if (reportingWashrooms.length > 0) {
    const avgPpm = reportingWashrooms.reduce((acc, w) => acc + w.gasPpm, 0) / reportingWashrooms.length;
    hygieneScore = Math.max(0, Math.min(100, Math.round(100 - (avgPpm / 600) * 50 - (washroomsInAlert * 15))));
  }

  return {
    hygieneScore,
    totalWashrooms,
    optimalWashrooms,
    washroomsInAlert,
    totalOccupied,
    totalFootfallToday,
    availableCleaners: cleaners.filter(c => c.status === 'Available').length,
    activeTasks: tasks.filter(t => t.status !== 'Completed').length
  };
}

// Convert Firebase object dict to array
function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return Object.keys(val).map(key => ({ id: key, ...val[key] }));
}

// Clear all data from Firebase Realtime Database
export async function fbClearAllData() {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase not initialized");
  await set(ref(db, '/'), null);
}

// Real-time listener for the root Firebase tree
export function subscribeToFirebase(callback) {
  const db = getFirebaseDb();
  if (!db) return () => {};

  const rootRef = ref(db, '/');
  const unsubscribe = onValue(rootRef, (snapshot) => {
    const data = snapshot.val() || {};

    // Standardize collections strictly from real ESP32 / sensor telemetry
    const rawWashrooms = toArray(data.washrooms);
    const now = Date.now();
    const washrooms = rawWashrooms.map(w => {
      const lastTelemetryTime = w.lastTelemetryAt
        ? new Date(w.lastTelemetryAt).getTime()
        : (w.timestamp ? new Date(w.timestamp).getTime() : 0);

      const hasSensorData = (w.sensors?.ammonia != null) || (w.ammoniaPpm != null) || (w.ammonia != null);
      const isOnline = lastTelemetryTime > 0
        ? (now - lastTelemetryTime < 35000)
        : Boolean(w.esp32Connected || hasSensorData);

      // STRICT NO SYNTHETIC VALUES:
      // If sensor has not reported a value or ESP is offline, value is strictly null.
      const ammoniaVal = isOnline
        ? (w.ammoniaPpm != null ? Number(w.ammoniaPpm) : (w.ammonia != null ? Number(w.ammonia) : (w.sensors?.ammonia != null ? Number(w.sensors.ammonia) : null)))
        : null;

      const gasVal = isOnline
        ? (w.gasPpm != null ? Number(w.gasPpm) : (w.sensors?.gasPpm != null ? Number(w.sensors.gasPpm) : null))
        : null;

      const distVal = isOnline
        ? (w.distanceCm != null ? Number(w.distanceCm) : (w.sensors?.distanceCm != null ? Number(w.sensors.distanceCm) : null))
        : null;

      const dustbinVal = isOnline
        ? (w.dustbinStatus != null ? w.dustbinStatus : (w.sensors?.dustbin != null ? (w.sensors.dustbin > 80 ? 'Full' : 'Normal') : null))
        : null;

      const floorVal = isOnline
        ? (w.floorCondition != null ? w.floorCondition : (w.sensors?.floorWetness != null ? (w.sensors.floorWetness > 50 ? 'Wet' : 'Dry') : null))
        : null;

      const occupiedVal = isOnline
        ? (w.occupied !== undefined ? Boolean(w.occupied) : null)
        : null;

      const visitorsVal = isOnline
        ? (w.totalVisitorsToday != null ? Number(w.totalVisitorsToday) : (w.peopleCount != null ? Number(w.peopleCount) : null))
        : null;

      return {
        id: w.id,
        name: w.name || `Washroom ${w.id}`,
        floor: w.floor || 'Ground Floor',
        gasPpm: gasVal,
        ammoniaPpm: ammoniaVal,
        ammonia: ammoniaVal,
        distanceCm: distVal,
        dustbinStatus: dustbinVal,
        floorCondition: floorVal,
        occupied: occupiedVal,
        cleaningAlert: isOnline && ammoniaVal !== null && ammoniaVal >= (data.thresholds?.ammoniaWarningPpm || 25),
        totalVisitorsToday: visitorsVal,
        visitorsSinceLastClean: isOnline && w.visitorsSinceLastClean != null ? Number(w.visitorsSinceLastClean) : null,
        lastTelemetryAt: w.lastTelemetryAt || (isOnline && lastTelemetryTime > 0 ? new Date(lastTelemetryTime).toISOString() : null),
        esp32Connected: isOnline
      };
    });

    const rawCleaners = toArray(data.cleaners || data.staff);
    const cleaners = rawCleaners.map(c => ({
      id: c.id,
      name: c.name || 'Cleaner',
      role: c.role || 'Hygiene Attendant',
      assignedZone: c.assignedZone || c.zone || 'Ground Floor',
      phone: c.phone || '',
      nfcCardId: c.nfcCardId || c.cardId || '',
      status: c.status || (c.isAvailable ? 'Available' : 'Busy'),
      completedToday: c.completedToday || c.tasksToday || 0,
      ...c
    }));

    const tasks = toArray(data.tasks);
    const nfcRecords = toArray(data.nfcRecords);
    const telemetryHistory = toArray(data.telemetryHistory).slice(-50);
    const thresholds = data.thresholds || {
      gasWarningPpm: 300,
      gasCriticalPpm: 500,
      ammoniaWarningPpm: 25,
      ammoniaCriticalPpm: 50,
      visitorsBeforeClean: 15
    };

    const overview = calculateFirebaseOverview(washrooms, cleaners, tasks);

    callback({
      overview,
      washrooms,
      cleaners,
      tasks,
      nfcRecords,
      thresholds,
      telemetryHistory,
      source: 'FIREBASE'
    });
  }, (error) => {
    console.error("Firebase onValue error:", error);
  });

  return unsubscribe;
}

// Realtime Database Mutations
export async function fbAddWashroom(washroomData) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase not initialized");
  const washroomsRef = ref(db, 'washrooms');
  const newRef = push(washroomsRef);
  const id = newRef.key;
  const washroom = {
    id,
    name: washroomData.name,
    floor: washroomData.floor || 'Ground Floor',
    gasPpm: null,
    ammoniaPpm: null,
    distanceCm: null,
    occupied: false,
    cleaningAlert: false,
    totalVisitorsToday: 0,
    lastCleanedAt: new Date().toISOString(),
    esp32Connected: false,
    createdAt: new Date().toISOString()
  };
  await set(newRef, washroom);
  return washroom;
}

export async function fbAddCleaner(cleanerData) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase not initialized");
  const cleanersRef = ref(db, 'cleaners');
  const newRef = push(cleanersRef);
  const id = newRef.key;
  const cleaner = {
    id,
    name: cleanerData.name,
    role: cleanerData.role || 'Hygiene Attendant',
    assignedZone: cleanerData.assignedZone || 'Ground Floor',
    phone: cleanerData.phone || '',
    nfcCardId: cleanerData.nfcCardId || '',
    status: 'Available',
    registeredAt: new Date().toISOString()
  };
  await set(newRef, cleaner);
  return cleaner;
}

export async function fbCreateTask(taskData) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase not initialized");
  const tasksRef = ref(db, 'tasks');
  const newRef = push(tasksRef);
  const id = newRef.key;
  const task = {
    id,
    washroomId: taskData.washroomId,
    title: taskData.title,
    description: taskData.description || '',
    priority: taskData.priority || 'Medium',
    status: taskData.assignedCleanerId ? 'Assigned' : 'Pending',
    assignedCleanerId: taskData.assignedCleanerId || null,
    createdAt: new Date().toISOString()
  };
  await set(newRef, task);

  // If cleaner was assigned, update cleaner status
  if (taskData.assignedCleanerId) {
    await update(ref(db, `cleaners/${taskData.assignedCleanerId}`), { status: 'Busy' });
  }
  return task;
}

export async function fbAssignTask(taskId, cleanerId) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase not initialized");
  await update(ref(db, `tasks/${taskId}`), {
    assignedCleanerId: cleanerId,
    status: 'Assigned'
  });
  if (cleanerId) {
    await update(ref(db, `cleaners/${cleanerId}`), { status: 'Busy' });
  }
}

export async function fbUpdateTaskStatus(taskId, status, assignedCleanerId) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase not initialized");
  const updates = { status };
  if (status === 'Completed') {
    updates.completedAt = new Date().toISOString();
  }
  await update(ref(db, `tasks/${taskId}`), updates);

  if (status === 'Completed' && assignedCleanerId) {
    await update(ref(db, `cleaners/${assignedCleanerId}`), { status: 'Available' });
  }
}

export async function fbUpdateCleanerStatus(cleanerId, status) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase not initialized");
  await update(ref(db, `cleaners/${cleanerId}`), { status });
}

export async function fbUpdateThresholds(thresholds) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase not initialized");
  await update(ref(db, 'thresholds'), thresholds);
}

export async function fbMarkCleaningDone(washroomId, method = 'Web Portal', cleanerName = 'Attendant') {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase not initialized");

  const now = new Date().toISOString();
  await update(ref(db, `washrooms/${washroomId}`), {
    cleaningAlert: false,
    alertReason: null,
    lastCleanedAt: now
  });

  // Log record
  const nfcRef = ref(db, 'nfcRecords');
  const recordRef = push(nfcRef);
  await set(recordRef, {
    id: recordRef.key,
    washroomId,
    method,
    cleanerName,
    timestamp: now
  });
}
