const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ----------------- STRICT NO-FAKE-DATA STATE -----------------
// All collections start completely empty. Data is only populated
// via actual incoming ESP32 telemetry, hardware NFC taps, or user registration.

let washrooms = [];
let cleaners = [];
let tasks = [];
let nfcRecords = [];
let telemetryHistory = [];

let thresholds = {
  gasWarningPpm: 300,
  gasCriticalPpm: 500,
  ammoniaWarningPpm: 25,
  ammoniaCriticalPpm: 50,
  visitorsBeforeClean: 15
};

const sseClients = new Set();

function getAirQualityRating(ppm) {
  if (ppm == null) return null;
  if (ppm < 200) return { label: 'Optimal', color: 'emerald', code: 'good' };
  if (ppm < 350) return { label: 'Moderate', color: 'yellow', code: 'moderate' };
  if (ppm < 500) return { label: 'Poor Odor', color: 'orange', code: 'poor' };
  return { label: 'Hazardous', color: 'rose', code: 'critical' };
}

function calculateOverview() {
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
  const totalOccupied = washrooms.filter(w => w.occupied).length;
  const totalFootfallToday = washrooms.reduce((acc, w) => acc + (w.totalVisitorsToday || 0), 0);
  
  // Calculate score only from actual reported PPM values
  const reportingWashrooms = washrooms.filter(w => typeof w.gasPpm === 'number');
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

function getFullState() {
  // Update online status for washrooms
  const now = Date.now();
  washrooms.forEach(w => {
    if (w.lastTelemetryAt) {
      w.esp32Connected = (now - new Date(w.lastTelemetryAt).getTime()) < 15000;
    } else {
      w.esp32Connected = false;
    }
  });

  return {
    overview: calculateOverview(),
    washrooms,
    cleaners,
    tasks,
    nfcRecords,
    thresholds,
    telemetryHistory: telemetryHistory.slice(-50)
  };
}

function notifyClients() {
  const payload = JSON.stringify({
    type: 'STATE_UPDATE',
    data: getFullState()
  });
  sseClients.forEach(client => {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  });
}

// ----------------- REST API ROUTES -----------------

// 1. Get System Status
app.get('/api/status', (req, res) => {
  res.json(getFullState());
});

// 2. Register a Real Washroom
app.post('/api/washrooms', (req, res) => {
  const { name, floor } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Washroom name is required.' });
  }

  const id = `wr-${Date.now().toString().slice(-4)}`;
  const newWashroom = {
    id,
    name: name.trim(),
    floor: floor ? floor.trim() : 'Ground Floor',
    gasPpm: null,
    ammoniaPpm: null,
    temperature: null,
    humidity: null,
    occupied: null,
    distanceCm: null,
    totalVisitorsToday: 0,
    visitorsSinceLastClean: 0,
    cleaningAlert: false,
    alertReason: '',
    lastCleanedAt: null,
    lastTelemetryAt: null,
    esp32Connected: false,
    deviceIp: null,
    rssi: null,
    airQuality: null
  };

  washrooms.push(newWashroom);
  notifyClients();
  res.json({ success: true, washroom: newWashroom });
});

// 3. Register a Real Cleaner
app.post('/api/cleaners', (req, res) => {
  const { name, role, assignedZone, phone, nfcCardId } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Cleaner name is required.' });
  }

  const id = `cl-${Date.now().toString().slice(-4)}`;
  const newCleaner = {
    id,
    name: name.trim(),
    role: role ? role.trim() : 'Hygiene Attendant',
    status: 'Available',
    assignedZone: assignedZone ? assignedZone.trim() : 'Main Area',
    phone: phone ? phone.trim() : '',
    nfcCardId: nfcCardId ? nfcCardId.trim() : `NFC-${id.toUpperCase()}`,
    completedToday: 0
  };

  cleaners.push(newCleaner);
  notifyClients();
  res.json({ success: true, cleaner: newCleaner });
});

// 4. Actual Telemetry Receiver (From ESP32 device)
app.post('/api/telemetry', (req, res) => {
  const {
    washroomId,
    gasPpm,
    ammoniaPpm,
    temperature,
    humidity,
    occupied,
    visitorEntered,
    distanceCm,
    cleaningButtonPressed,
    deviceIp,
    rssi
  } = req.body;

  let wr = null;

  if (washroomId) {
    wr = washrooms.find(w => w.id === washroomId);
  }

  // If no washroom registered yet or not found, register automatically using device telemetry
  if (!wr) {
    if (washrooms.length === 0) {
      wr = {
        id: 'wr-1',
        name: deviceIp ? `Restroom (${deviceIp})` : 'Connected Restroom Node',
        floor: 'Main Floor',
        gasPpm: null,
        ammoniaPpm: null,
        temperature: null,
        humidity: null,
        occupied: null,
        distanceCm: null,
        totalVisitorsToday: 0,
        visitorsSinceLastClean: 0,
        cleaningAlert: false,
        alertReason: '',
        lastCleanedAt: null,
        lastTelemetryAt: null,
        esp32Connected: true,
        deviceIp: deviceIp || null,
        rssi: rssi || null,
        airQuality: null
      };
      washrooms.push(wr);
    } else {
      wr = washrooms[0];
    }
  }

  wr.lastTelemetryAt = new Date().toISOString();
  wr.esp32Connected = true;

  if (typeof gasPpm === 'number') wr.gasPpm = Math.round(gasPpm);
  if (typeof ammoniaPpm === 'number') wr.ammoniaPpm = Math.round(ammoniaPpm);
  if (typeof temperature === 'number') wr.temperature = parseFloat(temperature.toFixed(1));
  if (typeof humidity === 'number') wr.humidity = parseFloat(humidity.toFixed(1));
  if (typeof distanceCm === 'number') wr.distanceCm = Math.round(distanceCm);
  if (typeof occupied === 'boolean') wr.occupied = occupied;
  if (deviceIp) wr.deviceIp = deviceIp;
  if (typeof rssi === 'number') wr.rssi = rssi;

  if (visitorEntered) {
    wr.totalVisitorsToday += 1;
    wr.visitorsSinceLastClean += 1;
  }

  wr.airQuality = getAirQualityRating(wr.gasPpm);

  // Evaluate thresholds
  let alertReasons = [];
  if (typeof wr.gasPpm === 'number' && wr.gasPpm >= thresholds.gasWarningPpm) {
    alertReasons.push(`High Odor Detected (${wr.gasPpm} PPM)`);
  }
  if (typeof wr.ammoniaPpm === 'number' && wr.ammoniaPpm >= thresholds.ammoniaWarningPpm) {
    alertReasons.push(`Elevated Ammonia (${wr.ammoniaPpm} PPM)`);
  }
  if (wr.visitorsSinceLastClean >= thresholds.visitorsBeforeClean) {
    alertReasons.push(`Visitor Limit Reached (${wr.visitorsSinceLastClean}/${thresholds.visitorsBeforeClean})`);
  }

  if (cleaningButtonPressed) {
    performWashroomReset(wr.id, 'Physical Device Button');
  } else {
    wr.cleaningAlert = alertReasons.length > 0;
    wr.alertReason = alertReasons.join(' | ');

    if (wr.cleaningAlert) {
      const existingTask = tasks.find(t => t.washroomId === wr.id && t.status !== 'Completed');
      if (!existingTask) {
        tasks.unshift({
          id: `tsk-${Date.now().toString().slice(-4)}`,
          washroomId: wr.id,
          washroomName: wr.name,
          title: `Sensor Alert in ${wr.name}`,
          description: wr.alertReason,
          priority: wr.gasPpm > thresholds.gasCriticalPpm ? 'High' : 'Medium',
          status: 'Pending',
          assignedCleanerId: null,
          assignedCleanerName: 'Unassigned',
          createdAt: new Date().toISOString()
        });
      }
    }
  }

  telemetryHistory.push({
    timestamp: wr.lastTelemetryAt,
    gasPpm: wr.gasPpm,
    ammoniaPpm: wr.ammoniaPpm,
    occupied: wr.occupied,
    visitors: wr.visitorsSinceLastClean
  });
  if (telemetryHistory.length > 100) telemetryHistory.shift();

  notifyClients();
  res.json({ success: true, state: getFullState() });
});

function performWashroomReset(washroomId, cleanedBy = 'Staff Action') {
  const wr = washrooms.find(w => w.id === washroomId);
  if (!wr) return;

  wr.lastCleanedAt = new Date().toISOString();
  wr.visitorsSinceLastClean = 0;
  wr.cleaningAlert = false;
  wr.alertReason = '';

  tasks.forEach(t => {
    if (t.washroomId === wr.id && t.status !== 'Completed') {
      t.status = 'Completed';
      t.completedAt = new Date().toISOString();
    }
  });
}

// 5. Mark Cleaning Done
app.post('/api/cleaning-done', (req, res) => {
  const { washroomId, cleanedBy, note } = req.body;
  if (!washroomId) return res.status(400).json({ error: 'Washroom ID required' });

  const wr = washrooms.find(w => w.id === washroomId);
  if (!wr) return res.status(404).json({ error: 'Washroom not found' });

  performWashroomReset(washroomId, cleanedBy);

  nfcRecords.unshift({
    id: `nfc-${Date.now().toString().slice(-4)}`,
    nfcCardId: 'MANUAL',
    cleanerName: cleanedBy || 'Staff Member',
    washroomId: wr.id,
    washroomName: wr.name,
    actionType: 'Cleaned & Reset',
    timestamp: new Date().toISOString(),
    durationMinutes: null,
    badgeStatus: 'Logged'
  });

  notifyClients();
  res.json({ success: true, state: getFullState() });
});

// 6. NFC Reader Tap Endpoint (From Hardware NFC/RFID Reader)
app.post('/api/nfc-tap', (req, res) => {
  const { nfcCardId, washroomId, actionType } = req.body;
  if (!nfcCardId) {
    return res.status(400).json({ error: 'NFC Card ID is required.' });
  }

  const cleaner = cleaners.find(c => c.nfcCardId === nfcCardId);
  const wr = washrooms.find(w => w.id === washroomId) || washrooms[0];

  if (!cleaner) {
    return res.status(404).json({ error: `NFC Card ${nfcCardId} is not assigned to any registered cleaner.` });
  }
  if (!wr) {
    return res.status(404).json({ error: 'No washroom registered.' });
  }

  const isCheckIn = actionType === 'check-in';

  if (isCheckIn) {
    cleaner.status = 'Busy';
    nfcRecords.unshift({
      id: `nfc-${Date.now().toString().slice(-4)}`,
      nfcCardId: cleaner.nfcCardId,
      cleanerName: cleaner.name,
      washroomId: wr.id,
      washroomName: wr.name,
      actionType: 'Check-In Tap',
      timestamp: new Date().toISOString(),
      durationMinutes: null,
      badgeStatus: 'Verified'
    });

    const pendingTask = tasks.find(t => t.washroomId === wr.id && t.status === 'Pending');
    if (pendingTask) {
      pendingTask.status = 'In Progress';
      pendingTask.assignedCleanerId = cleaner.id;
      pendingTask.assignedCleanerName = cleaner.name;
    }
  } else {
    cleaner.status = 'Available';
    cleaner.completedToday += 1;
    performWashroomReset(wr.id, cleaner.name);

    nfcRecords.unshift({
      id: `nfc-${Date.now().toString().slice(-4)}`,
      nfcCardId: cleaner.nfcCardId,
      cleanerName: cleaner.name,
      washroomId: wr.id,
      washroomName: wr.name,
      actionType: 'Check-Out / Verified Cleaned',
      timestamp: new Date().toISOString(),
      durationMinutes: null,
      badgeStatus: 'Verified'
    });
  }

  notifyClients();
  res.json({ success: true, cleaner, washroom: wr, state: getFullState() });
});

// 7. Tasks Management
app.post('/api/tasks/create', (req, res) => {
  const { washroomId, title, description, priority, assignedCleanerId } = req.body;
  const wr = washrooms.find(w => w.id === washroomId);
  if (!wr) return res.status(400).json({ error: 'Valid washroom required.' });

  const cleaner = cleaners.find(c => c.id === assignedCleanerId);

  const newTask = {
    id: `tsk-${Date.now().toString().slice(-4)}`,
    washroomId: wr.id,
    washroomName: wr.name,
    title: title ? title.trim() : `Inspection for ${wr.name}`,
    description: description ? description.trim() : '',
    priority: priority || 'Medium',
    status: cleaner ? 'In Progress' : 'Pending',
    assignedCleanerId: cleaner ? cleaner.id : null,
    assignedCleanerName: cleaner ? cleaner.name : 'Unassigned',
    createdAt: new Date().toISOString()
  };

  if (cleaner) {
    cleaner.status = 'Busy';
  }

  tasks.unshift(newTask);
  notifyClients();
  res.json({ success: true, task: newTask });
});

app.post('/api/tasks/assign', (req, res) => {
  const { taskId, cleanerId } = req.body;
  const task = tasks.find(t => t.id === taskId);
  const cleaner = cleaners.find(c => c.id === cleanerId);

  if (task && cleaner) {
    task.assignedCleanerId = cleaner.id;
    task.assignedCleanerName = cleaner.name;
    task.status = 'In Progress';
    cleaner.status = 'Busy';
    notifyClients();
    return res.json({ success: true, task });
  }

  res.status(400).json({ error: 'Invalid task or cleaner.' });
});

app.post('/api/tasks/status', (req, res) => {
  const { taskId, status } = req.body;
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.status = status;
    if (status === 'Completed') {
      task.completedAt = new Date().toISOString();
      performWashroomReset(task.washroomId, task.assignedCleanerName);
      const cleaner = cleaners.find(c => c.id === task.assignedCleanerId);
      if (cleaner) {
        cleaner.status = 'Available';
        cleaner.completedToday += 1;
      }
    }
    notifyClients();
    return res.json({ success: true, task });
  }
  res.status(400).json({ error: 'Task not found.' });
});

// 8. Cleaner Status Update
app.post('/api/cleaners/status', (req, res) => {
  const { cleanerId, status } = req.body;
  const cleaner = cleaners.find(c => c.id === cleanerId);
  if (cleaner) {
    cleaner.status = status;
    notifyClients();
    return res.json({ success: true, cleaner });
  }
  res.status(400).json({ error: 'Cleaner not found.' });
});

// 9. Thresholds
app.post('/api/thresholds', (req, res) => {
  const { gasWarningPpm, gasCriticalPpm, ammoniaWarningPpm, ammoniaCriticalPpm, visitorsBeforeClean } = req.body;
  if (gasWarningPpm) thresholds.gasWarningPpm = Number(gasWarningPpm);
  if (gasCriticalPpm) thresholds.gasCriticalPpm = Number(gasCriticalPpm);
  if (ammoniaWarningPpm) thresholds.ammoniaWarningPpm = Number(ammoniaWarningPpm);
  if (ammoniaCriticalPpm) thresholds.ammoniaCriticalPpm = Number(ammoniaCriticalPpm);
  if (visitorsBeforeClean) thresholds.visitorsBeforeClean = Number(visitorsBeforeClean);
  
  notifyClients();
  res.json({ success: true, thresholds });
});

// 10. Real-Time Server-Sent Events (SSE) Stream
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'INITIAL_STATE', data: getFullState() })}\n\n`);

  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.listen(PORT, () => {
  console.log(`🛡️ Hygiene Guard Backend running on http://localhost:${PORT}`);
});
