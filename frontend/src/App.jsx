import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Wind,
  Users,
  Sparkles,
  Settings,
  Activity,
  UserCheck,
  Plus,
  Search,
  ChevronRight,
  Layers,
  MapPin,
  Check,
  Info,
  CheckCircle2,
  Droplets,
  Trash2,
  Flame,
  Database,
  Copy,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import {
  isFirebaseConfigured,
  getStoredFirebaseConfig,
  saveFirebaseConfig,
  subscribeToFirebase,
  fbClearAllData,
  fbAddWashroom,
  fbAddCleaner,
  fbCreateTask,
  fbAssignTask,
  fbUpdateTaskStatus,
  fbUpdateCleanerStatus,
  fbUpdateThresholds,
  fbMarkCleaningDone
} from './firebase';

export default function App() {
  // Navigation tabs: 01 Overview | 02 Washrooms | 03 Alerts & Tasks | 04 Cleaners | 05 History
  const [activeTab, setActiveTab] = useState('01_overview');

  // Application State
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState(false);

  // Firebase Realtime State
  const [firebaseConfig, setFirebaseConfig] = useState(getStoredFirebaseConfig());
  const [firebaseActive, setFirebaseActive] = useState(isFirebaseConfigured());
  const [showFirebaseModal, setShowFirebaseModal] = useState(false);
  const [rawConfigInput, setRawConfigInput] = useState('');
  const [firebaseNotice, setFirebaseNotice] = useState('');
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Selected washroom for detailed tab
  const [selectedWashroomId, setSelectedWashroomId] = useState('');

  // Modals
  const [showWiring, setShowWiring] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showAddWashroom, setShowAddWashroom] = useState(false);
  const [showAddCleaner, setShowAddCleaner] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(null);

  // Forms
  const [newWashroomForm, setNewWashroomForm] = useState({ name: '', floor: 'Ground Floor' });
  const [newCleanerForm, setNewCleanerForm] = useState({
    name: '',
    role: 'Hygiene Attendant',
    assignedZone: 'Ground Floor',
    phone: '',
    nfcCardId: ''
  });
  const [newTaskForm, setNewTaskForm] = useState({
    washroomId: '',
    title: '',
    description: '',
    priority: 'Medium',
    assignedCleanerId: ''
  });
  const [thresholdForm, setThresholdForm] = useState({
    gasWarningPpm: 300,
    gasCriticalPpm: 500,
    ammoniaWarningPpm: 25,
    ammoniaCriticalPpm: 50,
    visitorsBeforeClean: 15
  });

  const [historySearch, setHistorySearch] = useState('');

  // Fetch state from local backend API (fallback when Firebase is not configured)
  const fetchState = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setState(data);
        if (data.thresholds) setThresholdForm(data.thresholds);
        if (!selectedWashroomId && data.washrooms?.length > 0) {
          setSelectedWashroomId(data.washrooms[0].id);
        }
        setServerError(false);
      } else {
        if (!firebaseActive) setServerError(true);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      if (!firebaseActive) setServerError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let unsubscribeFb = null;
    let eventSource = null;
    let interval = null;

    if (firebaseActive) {
      // Real-time listener directly from Firebase Realtime Database
      unsubscribeFb = subscribeToFirebase((fbData) => {
        setState(fbData);
        if (fbData.thresholds) setThresholdForm(fbData.thresholds);
        if (!selectedWashroomId && fbData.washrooms?.length > 0) {
          setSelectedWashroomId(fbData.washrooms[0].id);
        }
        setServerError(false);
        setLoading(false);
      });
    } else {
      // Fallback: Local Express backend + Server-Sent Events
      fetchState();

      eventSource = new EventSource('/api/events');
      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.data) {
            setState(parsed.data);
            if (parsed.data.thresholds) setThresholdForm(parsed.data.thresholds);
            if (!selectedWashroomId && parsed.data.washrooms?.length > 0) {
              setSelectedWashroomId(parsed.data.washrooms[0].id);
            }
            setServerError(false);
          }
        } catch (e) {
          console.error('SSE Error:', e);
        }
      };

      interval = setInterval(fetchState, 5000);
    }

    return () => {
      if (unsubscribeFb) unsubscribeFb();
      if (eventSource) eventSource.close();
      if (interval) clearInterval(interval);
    };
  }, [selectedWashroomId, firebaseActive]);

  // Handlers
  const handleAddWashroom = async (e) => {
    e.preventDefault();
    if (!newWashroomForm.name.trim()) return;
    try {
      if (firebaseActive) {
        const created = await fbAddWashroom(newWashroomForm);
        setShowAddWashroom(false);
        setNewWashroomForm({ name: '', floor: 'Ground Floor' });
        if (created?.id) setSelectedWashroomId(created.id);
      } else {
        const res = await fetch('/api/washrooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newWashroomForm)
        });
        if (res.ok) {
          const data = await res.json();
          setShowAddWashroom(false);
          setNewWashroomForm({ name: '', floor: 'Ground Floor' });
          if (data.washroom?.id) setSelectedWashroomId(data.washroom.id);
          fetchState();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddCleaner = async (e) => {
    e.preventDefault();
    if (!newCleanerForm.name.trim()) return;
    try {
      if (firebaseActive) {
        await fbAddCleaner(newCleanerForm);
        setShowAddCleaner(false);
        setNewCleanerForm({
          name: '',
          role: 'Hygiene Attendant',
          assignedZone: 'Ground Floor',
          phone: '',
          nfcCardId: ''
        });
      } else {
        const res = await fetch('/api/cleaners', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newCleanerForm)
        });
        if (res.ok) {
          setShowAddCleaner(false);
          setNewCleanerForm({
            name: '',
            role: 'Hygiene Attendant',
            assignedZone: 'Ground Floor',
            phone: '',
            nfcCardId: ''
          });
          fetchState();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!newTaskForm.washroomId) return;
    try {
      if (firebaseActive) {
        await fbCreateTask(newTaskForm);
        setShowCreateTask(false);
        setNewTaskForm({
          washroomId: state?.washrooms?.[0]?.id || '',
          title: '',
          description: '',
          priority: 'Medium',
          assignedCleanerId: ''
        });
      } else {
        await fetch('/api/tasks/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newTaskForm)
        });
        setShowCreateTask(false);
        setNewTaskForm({
          washroomId: state?.washrooms?.[0]?.id || '',
          title: '',
          description: '',
          priority: 'Medium',
          assignedCleanerId: ''
        });
        fetchState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAssignCleaner = async (taskId, cleanerId) => {
    try {
      if (firebaseActive) {
        await fbAssignTask(taskId, cleanerId);
        setShowAssignModal(null);
      } else {
        await fetch('/api/tasks/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, cleanerId })
        });
        setShowAssignModal(null);
        fetchState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleTaskStatus = async (taskId, status) => {
    try {
      if (firebaseActive) {
        const task = state?.tasks?.find(t => t.id === taskId);
        await fbUpdateTaskStatus(taskId, status, task?.assignedCleanerId);
      } else {
        await fetch('/api/tasks/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, status })
        });
        fetchState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCleanerStatus = async (cleanerId, status) => {
    try {
      if (firebaseActive) {
        await fbUpdateCleanerStatus(cleanerId, status);
      } else {
        await fetch('/api/cleaners/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cleanerId, status })
        });
        fetchState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveThresholds = async (e) => {
    e.preventDefault();
    try {
      if (firebaseActive) {
        await fbUpdateThresholds(thresholdForm);
        setShowSettings(false);
      } else {
        await fetch('/api/thresholds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(thresholdForm)
        });
        setShowSettings(false);
        fetchState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleManualReset = async (washroomId) => {
    if (!washroomId) return;
    try {
      if (firebaseActive) {
        await fbMarkCleaningDone(washroomId);
      } else {
        await fetch('/api/cleaning-done', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            washroomId,
            cleanedBy: 'Staff Member',
            note: 'Sanitization completed'
          })
        });
        fetchState();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Firebase Configuration Actions
  const handleSaveFirebaseConfig = (e) => {
    e.preventDefault();
    if (!firebaseConfig.databaseURL && !firebaseConfig.projectId) {
      setFirebaseNotice('Please enter at least the Firebase Database URL or Project ID.');
      return;
    }
    const db = saveFirebaseConfig(firebaseConfig);
    if (db) {
      setFirebaseActive(true);
      setFirebaseNotice('Connected to Firebase Realtime Database!');
      setTimeout(() => setFirebaseNotice(''), 3000);
    } else {
      setFirebaseNotice('Failed to connect. Please verify your Database URL.');
    }
  };

  const handleParseRawConfig = (text) => {
    setRawConfigInput(text);
    try {
      const dbMatch = text.match(/databaseURL\s*:\s*["']([^"']+)["']/);
      const projMatch = text.match(/projectId\s*:\s*["']([^"']+)["']/);
      const apiMatch = text.match(/apiKey\s*:\s*["']([^"']+)["']/);
      const authMatch = text.match(/authDomain\s*:\s*["']([^"']+)["']/);

      if (dbMatch || projMatch) {
        setFirebaseConfig(prev => ({
          ...prev,
          databaseURL: dbMatch ? dbMatch[1] : prev.databaseURL,
          projectId: projMatch ? projMatch[1] : prev.projectId,
          apiKey: apiMatch ? apiMatch[1] : prev.apiKey,
          authDomain: authMatch ? authMatch[1] : prev.authDomain
        }));
        setFirebaseNotice('Extracted Database URL and Project ID from pasted snippet!');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearFirebaseData = async () => {
    try {
      setFirebaseNotice('Clearing database for live hardware stream...');
      await fbClearAllData();
      setFirebaseNotice('Database cleared! Awaiting real ESP32 & sensor data.');
      setTimeout(() => setFirebaseNotice(''), 4000);
    } catch (err) {
      console.error(err);
      setFirebaseNotice('Error clearing database: ' + err.message);
    }
  };

  const getPpmBadge = (ppm, isConnected = true) => {
    if (!isConnected) {
      return { label: 'ESP not connected', bg: 'bg-[#FAFAFA] text-[#6B7280] border-[#E5E7EB]' };
    }
    if (ppm == null) {
      return { label: 'null', bg: 'bg-[#FAFAFA] text-[#6B7280] border-[#E5E7EB]' };
    }
    if (ppm < 200) {
      return { label: 'Optimal', bg: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
    }
    if (ppm < 350) {
      return { label: 'Moderate', bg: 'bg-[#FFFBEB] text-[#9A5805] border-[#FCD385]' };
    }
    if (ppm < 500) {
      return { label: 'Poor Odor', bg: 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]' };
    }
    return { label: 'Hazardous', bg: 'bg-[#FEF2F2] text-[#E73F1E] border-[#FECACA]' };
  };

  const getCleanerStatusBadge = (status) => {
    switch (status) {
      case 'Available':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'Busy':
        return 'bg-[#FFFBEB] text-[#9A5805] border-[#FCD385]';
      case 'On Break':
        return 'bg-purple-50 text-purple-800 border-purple-200';
      default:
        return 'bg-[#FAFAFA] text-[#6B7280] border-[#E5E7EB]';
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'High':
        return 'bg-[#FEF2F2] text-[#E73F1E] border-[#FECACA]';
      case 'Medium':
        return 'bg-[#FFFBEB] text-[#9A5805] border-[#FCD385]';
      default:
        return 'bg-blue-50 text-blue-800 border-blue-200';
    }
  };

  const activeWashroom = state?.washrooms?.find(w => w.id === selectedWashroomId) || state?.washrooms?.[0];

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#252525] flex flex-col font-sans">
      
      {/* ---------------- TOP HEADER ---------------- */}
      <header className="border-b border-[#E5E7EB] bg-[#FFFFFF] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-16 flex items-center justify-between">
            {/* Logo / App Name */}
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-[#FB6C00] flex items-center justify-center text-white shrink-0">
                <ShieldCheck className="h-5 w-5 stroke-[2.5]" />
              </div>
              <h1 className="text-base font-bold tracking-tight text-[#252525] flex items-center gap-1.5">
                HYGIENE <span className="text-[#FB6C00]">GUARD</span>
              </h1>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <button
                id="btn-firebase"
                onClick={() => setShowFirebaseModal(true)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  firebaseActive
                    ? 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA] hover:bg-[#FFEDD5]'
                    : 'bg-white hover:bg-[#FAFAFA] border-[#E5E7EB] text-[#252525]'
                }`}
                title="Firebase Realtime Database Settings"
              >
                <Flame className={`h-3.5 w-3.5 ${firebaseActive ? 'text-[#FB6C00] fill-[#FB6C00]' : 'text-[#6B7280]'}`} />
                <span>{firebaseActive ? 'Firebase RTDB Live' : 'Connect Firebase'}</span>
                {firebaseActive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>}
              </button>

              <button
                id="btn-wiring"
                onClick={() => setShowWiring(true)}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#FAFAFA] border border-[#E5E7EB] text-xs font-medium text-[#252525] transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Info className="h-3.5 w-3.5 text-[#6B7280]" />
                <span className="hidden sm:inline">ESP32 Connection</span>
              </button>

              <button
                id="btn-settings"
                onClick={() => setShowSettings(true)}
                className="p-1.5 rounded-lg bg-white hover:bg-[#FAFAFA] border border-[#E5E7EB] text-[#6B7280] hover:text-[#252525] transition-colors cursor-pointer"
                title="Threshold Settings"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1 sm:space-x-2 overflow-x-auto border-t border-[#E5E7EB] py-2 scrollbar-none">
            {[
              { id: '01_overview', title: 'Overview' },
              { id: '02_washrooms', title: 'Washrooms' },
              { id: '03_alerts_tasks', title: 'Alerts & Tasks' },
              { id: '04_cleaners', title: 'Cleaners' },
              { id: '05_history', title: 'History' }
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-[#FB6C00] text-white font-semibold shadow-sm'
                      : 'text-[#6B7280] hover:text-[#252525] hover:bg-[#FAFAFA]'
                  }`}
                >
                  {tab.title}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ---------------- MAIN CONTENT ---------------- */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* Server Disconnect Warning */}
        {serverError && (
          <div className="p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-between text-xs text-[#E73F1E]">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#E73F1E]" />
              <span>Cannot connect to backend server at http://localhost:5000.</span>
            </div>
            <button onClick={fetchState} className="font-semibold underline cursor-pointer ml-3">
              Retry
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW 01: OVERVIEW */}
        {/* ========================================================= */}
        {activeTab === '01_overview' && (
          <div className="space-y-6">
            
            {/* Top Stat Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              
              {/* Hygiene Status Card */}
              <div className="p-4 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Overall Hygiene</span>
                  <Activity className="h-4 w-4 text-[#FB6C00]" />
                </div>
                <div className="my-3">
                  {state?.overview?.hygieneScore != null ? (
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold text-[#252525]">{state.overview.hygieneScore}%</span>
                      <span className="text-xs text-[#6B7280]">Index</span>
                    </div>
                  ) : (
                    <div className="text-sm font-medium text-[#6B7280]">
                      {state?.washrooms?.some(w => w.esp32Connected) ? 'null' : 'ESP not connected'}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-[#6B7280]">
                  {state?.washrooms?.length > 0 ? `${state.washrooms.length} facilities monitored` : 'No washrooms registered.'}
                </div>
              </div>

              {/* Washrooms Count */}
              <div className="p-4 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Washrooms</span>
                  <Layers className="h-4 w-4 text-[#6B7280]" />
                </div>
                <div className="my-3">
                  <div className="text-2xl font-bold text-[#252525]">{state?.overview?.totalWashrooms || 0}</div>
                </div>
                <div className="text-[11px] text-[#6B7280]">
                  {state?.overview?.washroomsInAlert > 0 ? (
                    <span className="text-[#E73F1E] font-medium">{state.overview.washroomsInAlert} active alerts</span>
                  ) : (
                    'No active alerts.'
                  )}
                </div>
              </div>

              {/* Live Occupancy */}
              <div className="p-4 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Occupancy</span>
                  <Users className="h-4 w-4 text-[#6B7280]" />
                </div>
                <div className="my-3">
                  <div className="text-2xl font-bold text-[#252525]">
                    {state?.washrooms?.some(w => w.esp32Connected)
                      ? (state?.overview?.totalOccupied || 0)
                      : 'ESP not connected'}
                  </div>
                </div>
                <div className="text-[11px] text-[#6B7280]">
                  Stalls currently occupied
                </div>
              </div>

              {/* Cleaners on Duty */}
              <div className="p-4 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Cleaners</span>
                  <UserCheck className="h-4 w-4 text-[#6B7280]" />
                </div>
                <div className="my-3">
                  <div className="text-2xl font-bold text-[#252525]">{state?.overview?.availableCleaners || 0}</div>
                </div>
                <div className="text-[11px] text-[#6B7280]">
                  {state?.cleaners?.length > 0 ? 'Available for assignment' : 'No cleaners available.'}
                </div>
              </div>
            </div>

            {/* Washroom List Section */}
            <div className="p-5 rounded-xl bg-white border border-[#E5E7EB] shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E5E7EB]">
                <div>
                  <h3 className="text-sm font-bold text-[#252525]">Facility Status Overview</h3>
                  <p className="text-xs text-[#6B7280]">Current status across registered washroom zones</p>
                </div>
                <button
                  id="btn-register-washroom"
                  onClick={() => setShowAddWashroom(true)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Register Washroom</span>
                </button>
              </div>

              {state?.washrooms?.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#6B7280] space-y-1.5">
                  <p className="font-semibold text-[#252525]">No washrooms registered.</p>
                  <p>Register a washroom using the button above or connect an ESP32 device.</p>
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {state?.washrooms?.map((wr) => {
                    const ppmBadge = getPpmBadge(wr.gasPpm, wr.esp32Connected);
                    return (
                      <div
                        key={wr.id}
                        onClick={() => {
                          setSelectedWashroomId(wr.id);
                          setActiveTab('02_washrooms');
                        }}
                        className={`p-4 rounded-lg border transition-all cursor-pointer ${
                          wr.cleaningAlert
                            ? 'bg-[#FEF2F2]/40 border-[#FECACA] hover:border-[#E73F1E]'
                            : 'bg-[#FAFAFA] border-[#E5E7EB] hover:border-[#FB6C00]/60'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-sm font-semibold text-[#252525]">{wr.name}</div>
                            <div className="text-[11px] text-[#6B7280]">{wr.floor}</div>
                          </div>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${ppmBadge.bg}`}>
                            {ppmBadge.label}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 rounded bg-white border border-[#E5E7EB]">
                            <span className="text-[10px] text-[#6B7280] block">Air Quality</span>
                            <span className="font-semibold text-[#252525]">
                              {wr.esp32Connected
                                ? (wr.gasPpm != null ? `${wr.gasPpm} PPM` : 'null')
                                : 'ESP not connected'}
                            </span>
                          </div>
                          <div className="p-2 rounded bg-white border border-[#E5E7EB]">
                            <span className="text-[10px] text-[#6B7280] block">Occupancy</span>
                            <span className="font-semibold text-[#252525]">
                              {wr.esp32Connected
                                ? (wr.occupied == null ? 'null' : (wr.occupied ? 'Occupied' : 'Vacant'))
                                : 'ESP not connected'}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-[11px] text-[#6B7280] pt-2 border-t border-[#E5E7EB]/60">
                          <span>Visits: {wr.esp32Connected ? (wr.visitorsSinceLastClean ?? 'null') : 'ESP not connected'}</span>
                          <span className="text-[#FB6C00] font-medium flex items-center gap-0.5">
                            Details <ChevronRight className="h-3 w-3" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Critical Alert Warning (if active) */}
            {state?.washrooms?.some(w => w.cleaningAlert) && (
              <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-[#E73F1E]/10 text-[#E73F1E] flex items-center justify-center shrink-0">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-[#E73F1E]">Sensor Threshold Exceeded</h4>
                    <p className="text-[#6B7280]">One or more washrooms exceeded safety limits and require servicing.</p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('03_alerts_tasks')}
                  className="px-3 py-1.5 rounded-lg bg-[#E73F1E] hover:bg-[#D33414] text-white font-medium text-xs cursor-pointer shrink-0"
                >
                  View Alerts & Tasks
                </button>
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW 02: WASHROOMS */}
        {/* ========================================================= */}
        {activeTab === '02_washrooms' && (
          <div className="space-y-5">
            {state?.washrooms?.length === 0 ? (
              <div className="p-12 text-center rounded-xl bg-[#FAFAFA] border border-[#E5E7EB] space-y-3">
                <h3 className="text-sm font-bold text-[#252525]">No washrooms registered.</h3>
                <p className="text-xs text-[#6B7280] max-w-sm mx-auto">
                  Add a washroom to begin monitoring live sensor values, or connect your ESP32 device.
                </p>
                <button
                  onClick={() => setShowAddWashroom(true)}
                  className="px-4 py-2 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white font-medium text-xs cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Register Washroom</span>
                </button>
              </div>
            ) : (
              <>
                {/* Washroom Selector if multiple exist */}
                {state?.washrooms?.length > 1 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {state.washrooms.map((wr) => {
                      const isSelected = wr.id === selectedWashroomId;
                      return (
                        <button
                          key={wr.id}
                          onClick={() => setSelectedWashroomId(wr.id)}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
                            isSelected
                              ? 'bg-white border-2 border-[#FB6C00] text-[#252525] shadow-sm font-semibold'
                              : 'bg-[#FAFAFA] border border-[#E5E7EB] text-[#6B7280] hover:text-[#252525]'
                          }`}
                        >
                          <span className={`h-2 w-2 rounded-full ${wr.esp32Connected ? 'bg-emerald-500' : 'bg-[#D1D5DB]'}`}></span>
                          <span>{wr.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Washroom Metadata Header: ID, Location, Connection Status, Last Updated */}
                {activeWashroom && (
                  <div className="p-4 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base font-bold text-[#252525]">{activeWashroom.name}</h2>
                        <span className="text-[11px] font-mono bg-[#FAFAFA] text-[#6B7280] border border-[#E5E7EB] px-2 py-0.5 rounded font-medium">
                          ID: {activeWashroom.id}
                        </span>
                        <span className="text-[11px] text-[#6B7280] bg-[#FAFAFA] border border-[#E5E7EB] px-2 py-0.5 rounded">
                          Location: {activeWashroom.floor || activeWashroom.location || 'Main Zone'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-[#6B7280] flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2.5 w-2.5 rounded-full ${activeWashroom.esp32Connected ? 'bg-emerald-500' : 'bg-[#D1D5DB]'}`}></span>
                        <span className="font-medium text-[#252525]">
                          {activeWashroom.esp32Connected ? 'Device Online' : 'ESP not connected'}
                        </span>
                      </div>
                      <div className="text-[11px]">
                        Last Updated:{' '}
                        <span className="text-[#252525] font-medium">
                          {activeWashroom.esp32Connected && activeWashroom.lastTelemetryAt
                            ? new Date(activeWashroom.lastTelemetryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                            : 'ESP not connected'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Responsive 2×2 Card Layout: 4 Main Monitoring Parameters */}
                {activeWashroom && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* 1. Ammonia Level */}
                    <div className="p-5 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col justify-between min-h-[160px]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[#FB6C00]/10 text-[#FB6C00]">
                            <Wind className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                            Ammonia Level
                          </span>
                        </div>
                        {(() => {
                          if (!activeWashroom.esp32Connected) {
                            return <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-[#FAFAFA] text-[#6B7280] border-[#E5E7EB]">ESP not connected</span>;
                          }
                          const val = activeWashroom.ammoniaPpm != null ? activeWashroom.ammoniaPpm : (activeWashroom.ammonia != null ? activeWashroom.ammonia : null);
                          if (val == null) {
                            return <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-[#FAFAFA] text-[#6B7280] border-[#E5E7EB]">null</span>;
                          }
                          const isHigh = val >= (state?.thresholds?.ammoniaWarningPpm || 25);
                          return (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                              isHigh
                                ? 'bg-[#FEF2F2] text-[#E73F1E] border-[#FECACA]'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}>
                              {isHigh ? 'High' : 'Normal'}
                            </span>
                          );
                        })()}
                      </div>

                      <div className="my-3">
                        {(() => {
                          if (!activeWashroom.esp32Connected) {
                            return <div className="text-sm font-medium text-[#6B7280]">ESP not connected</div>;
                          }
                          const val = activeWashroom.ammoniaPpm != null ? activeWashroom.ammoniaPpm : (activeWashroom.ammonia != null ? activeWashroom.ammonia : null);
                          if (val == null) {
                            return <div className="text-sm font-medium text-[#6B7280]">null</div>;
                          }
                          return (
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-3xl font-bold text-[#252525]">{val}</span>
                              <span className="text-xs text-[#6B7280]">PPM</span>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="text-[11px] text-[#6B7280] pt-2 border-t border-[#E5E7EB] flex items-center justify-between">
                        <span>Status:</span>
                        <span className="text-[#252525] font-medium">
                          {!activeWashroom.esp32Connected
                            ? 'ESP not connected'
                            : (activeWashroom.ammoniaPpm != null || activeWashroom.ammonia != null
                              ? ((activeWashroom.ammoniaPpm ?? activeWashroom.ammonia) >= (state?.thresholds?.ammoniaWarningPpm || 25) ? 'High - Attention Required' : 'Normal')
                              : 'null')}
                        </span>
                      </div>
                    </div>

                    {/* 2. Floor Condition */}
                    <div className="p-5 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col justify-between min-h-[160px]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[#FB6C00]/10 text-[#FB6C00]">
                            <Droplets className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                            Floor Condition
                          </span>
                        </div>
                        {(() => {
                          if (!activeWashroom.esp32Connected) {
                            return <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-[#FAFAFA] text-[#6B7280] border-[#E5E7EB]">ESP not connected</span>;
                          }
                          const raw = activeWashroom.floorCondition != null
                            ? activeWashroom.floorCondition
                            : (activeWashroom.isFloorWet != null ? (activeWashroom.isFloorWet ? 'Wet' : 'Dry') : null);
                          if (raw == null) {
                            return <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-[#FAFAFA] text-[#6B7280] border-[#E5E7EB]">null</span>;
                          }
                          const isWet = String(raw).toLowerCase() === 'wet';
                          return (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                              isWet
                                ? 'bg-[#FEF2F2] text-[#E73F1E] border-[#FECACA]'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}>
                              {isWet ? 'Caution: Wet' : 'Safe: Dry'}
                            </span>
                          );
                        })()}
                      </div>

                      <div className="my-3">
                        {(() => {
                          if (!activeWashroom.esp32Connected) {
                            return <div className="text-sm font-medium text-[#6B7280]">ESP not connected</div>;
                          }
                          const raw = activeWashroom.floorCondition != null
                            ? activeWashroom.floorCondition
                            : (activeWashroom.isFloorWet != null ? (activeWashroom.isFloorWet ? 'Wet' : 'Dry') : null);
                          if (raw == null) {
                            return <div className="text-sm font-medium text-[#6B7280]">null</div>;
                          }
                          const isWet = String(raw).toLowerCase() === 'wet';
                          return (
                            <div className="text-3xl font-bold text-[#252525]">
                              {isWet ? 'Wet' : 'Dry'}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="text-[11px] text-[#6B7280] pt-2 border-t border-[#E5E7EB] flex items-center justify-between">
                        <span>Condition:</span>
                        <span className="text-[#252525] font-medium">
                          {!activeWashroom.esp32Connected
                            ? 'ESP not connected'
                            : (activeWashroom.floorCondition != null || activeWashroom.isFloorWet != null
                              ? (String(activeWashroom.floorCondition || activeWashroom.isFloorWet).toLowerCase() === 'wet' ? 'Wet (Slip hazard)' : 'Dry')
                              : 'null')}
                        </span>
                      </div>
                    </div>

                    {/* 3. Dustbin Status */}
                    <div className="p-5 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col justify-between min-h-[160px]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[#FB6C00]/10 text-[#FB6C00]">
                            <Trash2 className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                            Dustbin Status
                          </span>
                        </div>
                        {(() => {
                          if (!activeWashroom.esp32Connected) {
                            return <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-[#FAFAFA] text-[#6B7280] border-[#E5E7EB]">ESP not connected</span>;
                          }
                          const raw = activeWashroom.dustbinStatus != null
                            ? activeWashroom.dustbinStatus
                            : (activeWashroom.isDustbinFull != null ? (activeWashroom.isDustbinFull ? 'Full' : 'Not Full') : null);
                          if (raw == null) {
                            return <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-[#FAFAFA] text-[#6B7280] border-[#E5E7EB]">null</span>;
                          }
                          const isFull = String(raw).toLowerCase() === 'full';
                          return (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                              isFull
                                ? 'bg-[#FEF2F2] text-[#E73F1E] border-[#FECACA]'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}>
                              {isFull ? 'Clean Required' : 'Normal'}
                            </span>
                          );
                        })()}
                      </div>

                      <div className="my-3">
                        {(() => {
                          if (!activeWashroom.esp32Connected) {
                            return <div className="text-sm font-medium text-[#6B7280]">ESP not connected</div>;
                          }
                          const raw = activeWashroom.dustbinStatus != null
                            ? activeWashroom.dustbinStatus
                            : (activeWashroom.isDustbinFull != null ? (activeWashroom.isDustbinFull ? 'Full' : 'Not Full') : null);
                          if (raw == null) {
                            return <div className="text-sm font-medium text-[#6B7280]">null</div>;
                          }
                          const isFull = String(raw).toLowerCase() === 'full';
                          return (
                            <div className="text-3xl font-bold text-[#252525]">
                              {isFull ? 'Full' : 'Not Full'}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="text-[11px] text-[#6B7280] pt-2 border-t border-[#E5E7EB] flex items-center justify-between">
                        <span>Fill Level:</span>
                        <span className="text-[#252525] font-medium">
                          {!activeWashroom.esp32Connected
                            ? 'ESP not connected'
                            : (activeWashroom.dustbinStatus != null || activeWashroom.isDustbinFull != null
                              ? (String(activeWashroom.dustbinStatus || activeWashroom.isDustbinFull).toLowerCase() === 'full' ? 'Full' : 'Not Full')
                              : 'null')}
                        </span>
                      </div>
                    </div>

                    {/* 4. People Count */}
                    <div className="p-5 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col justify-between min-h-[160px]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[#FB6C00]/10 text-[#FB6C00]">
                            <Users className="h-4 w-4" />
                          </div>
                          <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                            People Count
                          </span>
                        </div>
                        {activeWashroom.esp32Connected && activeWashroom.totalVisitorsToday != null && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-blue-50 text-blue-800 border-blue-200">
                            Today
                          </span>
                        )}
                      </div>

                      <div className="my-3">
                        {(() => {
                          if (!activeWashroom.esp32Connected) {
                            return <div className="text-sm font-medium text-[#6B7280]">ESP not connected</div>;
                          }
                          const count = activeWashroom.totalVisitorsToday != null
                            ? activeWashroom.totalVisitorsToday
                            : (activeWashroom.peopleCount != null ? activeWashroom.peopleCount : (activeWashroom.visitorsToday != null ? activeWashroom.visitorsToday : null));
                          if (count == null) {
                            return <div className="text-sm font-medium text-[#6B7280]">null</div>;
                          }
                          return (
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-3xl font-bold text-[#252525]">{count}</span>
                              <span className="text-xs text-[#6B7280]">people today</span>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="text-[11px] text-[#6B7280] pt-2 border-t border-[#E5E7EB] flex items-center justify-between">
                        <span>Visits since last clean:</span>
                        <span className="text-[#252525] font-medium">
                          {!activeWashroom.esp32Connected
                            ? 'ESP not connected'
                            : (activeWashroom.visitorsSinceLastClean != null ? activeWashroom.visitorsSinceLastClean : 'null')}
                        </span>
                      </div>
                    </div>

                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW 03: ALERTS & TASKS */}
        {/* ========================================================= */}
        {activeTab === '03_alerts_tasks' && (
          <div className="space-y-6">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">Alerts & Maintenance Tasks</h3>
                <p className="text-xs text-[#6B7280]">Detected sensor threshold alerts and assigned cleaning tasks</p>
              </div>

              {state?.washrooms?.length > 0 && (
                <button
                  id="btn-create-task"
                  onClick={() => {
                    setNewTaskForm(prev => ({ ...prev, washroomId: state.washrooms[0].id }));
                    setShowCreateTask(true);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Task</span>
                </button>
              )}
            </div>

            <div className="space-y-3">
              {state?.tasks?.length === 0 ? (
                <div className="p-12 text-center rounded-xl bg-[#FAFAFA] border border-[#E5E7EB] text-[#6B7280] text-xs">
                  No active alerts.
                </div>
              ) : (
                state?.tasks?.map((task) => (
                  <div
                    key={task.id}
                    className="p-4 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${getPriorityBadge(task.priority)}`}>
                          {task.priority} Priority
                        </span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                          task.status === 'Completed'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : task.status === 'In Progress'
                            ? 'bg-[#FFFBEB] text-[#9A5805] border-[#FCD385]'
                            : 'bg-[#FEF2F2] text-[#E73F1E] border-[#FECACA]'
                        }`}>
                          {task.status}
                        </span>
                        <span className="text-xs text-[#6B7280]">• {task.washroomName}</span>
                      </div>

                      <h4 className="text-sm font-semibold text-[#252525]">{task.title}</h4>
                      {task.description && <p className="text-xs text-[#6B7280]">{task.description}</p>}
                      
                      <div className="text-[11px] text-[#6B7280] flex items-center gap-3 pt-1">
                        <span>Assigned to: <strong className="text-[#252525]">{task.assignedCleanerName}</strong></span>
                        <span>Logged: {new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {task.status !== 'Completed' && (
                        <>
                          <button
                            onClick={() => setShowAssignModal(task.id)}
                            className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#FAFAFA] border border-[#E5E7EB] text-xs font-medium text-[#252525] transition-colors cursor-pointer"
                          >
                            {task.assignedCleanerId ? 'Reassign' : 'Assign Cleaner'}
                          </button>

                          <button
                            onClick={() => handleTaskStatus(task.id, 'Completed')}
                            className="px-3 py-1.5 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Mark Resolved</span>
                          </button>
                        </>
                      )}

                      {task.status === 'Completed' && (
                        <div className="flex items-center gap-1 text-xs text-emerald-700 font-medium px-2.5 py-1 rounded bg-emerald-50 border border-emerald-200">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Resolved</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW 04: CLEANERS */}
        {/* ========================================================= */}
        {activeTab === '04_cleaners' && (
          <div className="space-y-6">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">Cleaners Roster</h3>
                <p className="text-xs text-[#6B7280]">Staff availability and assigned zones</p>
              </div>

              <button
                id="btn-add-cleaner"
                onClick={() => setShowAddCleaner(true)}
                className="px-3.5 py-1.5 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Register Cleaner</span>
              </button>
            </div>

            {state?.cleaners?.length === 0 ? (
              <div className="p-12 text-center rounded-xl bg-[#FAFAFA] border border-[#E5E7EB] text-[#6B7280] text-xs space-y-1.5">
                <p className="font-semibold text-[#252525]">No cleaners available.</p>
                <p>Register your staff members using the button above.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {state?.cleaners?.map((cleaner) => {
                  const statusBadge = getCleanerStatusBadge(cleaner.status);
                  return (
                    <div
                      key={cleaner.id}
                      className="p-4 rounded-xl bg-white border border-[#E5E7EB] shadow-sm flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between">
                          <div className="h-9 w-9 rounded-lg bg-[#FAFAFA] border border-[#E5E7EB] flex items-center justify-center text-[#252525] font-bold text-sm">
                            {cleaner.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${statusBadge}`}>
                            {cleaner.status}
                          </span>
                        </div>

                        <div className="mt-3">
                          <h4 className="text-sm font-semibold text-[#252525]">{cleaner.name}</h4>
                          <p className="text-xs text-[#6B7280]">{cleaner.role}</p>
                        </div>

                        <div className="mt-3 space-y-1.5 text-xs border-t border-[#E5E7EB] pt-2.5 text-[#6B7280]">
                          <div className="flex justify-between">
                            <span>Assigned Zone:</span>
                            <strong className="text-[#252525]">{cleaner.assignedZone}</strong>
                          </div>
                          {cleaner.nfcCardId && (
                            <div className="flex justify-between">
                              <span>NFC Badge:</span>
                              <code className="text-[#252525] font-mono text-[11px]">{cleaner.nfcCardId}</code>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span>Tasks Done:</span>
                            <strong className="text-[#252525]">{cleaner.completedToday || 0}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-2.5 border-t border-[#E5E7EB]">
                        <select
                          value={cleaner.status}
                          onChange={(e) => handleCleanerStatus(cleaner.id, e.target.value)}
                          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-[#FAFAFA] border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00] cursor-pointer"
                        >
                          <option value="Available">Available</option>
                          <option value="Busy">Busy</option>
                          <option value="On Break">On Break</option>
                          <option value="Off Duty">Off Duty</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* VIEW 05: HISTORY */}
        {/* ========================================================= */}
        {activeTab === '05_history' && (
          <div className="space-y-6">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#252525]">NFC Records & Task Log</h3>
                <p className="text-xs text-[#6B7280]">Audit log of card taps and completed sanitizations</p>
              </div>

              {state?.nfcRecords?.length > 0 && (
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-[#6B7280] absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search cleaner or room..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-xs text-[#252525] placeholder-[#6B7280] focus:outline-none focus:border-[#FB6C00]"
                  />
                </div>
              )}
            </div>

            {state?.nfcRecords?.length === 0 ? (
              <div className="p-12 text-center rounded-xl bg-[#FAFAFA] border border-[#E5E7EB] text-[#6B7280] text-xs">
                No NFC records found.
              </div>
            ) : (
              <div className="rounded-xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FAFAFA] text-[#6B7280] uppercase text-[10px] tracking-wider border-b border-[#E5E7EB]">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Timestamp</th>
                        <th className="px-4 py-2.5 font-semibold">NFC Card</th>
                        <th className="px-4 py-2.5 font-semibold">Staff Member</th>
                        <th className="px-4 py-2.5 font-semibold">Washroom</th>
                        <th className="px-4 py-2.5 font-semibold">Action</th>
                        <th className="px-4 py-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {state?.nfcRecords?.filter(r => {
                        if (!historySearch) return true;
                        return (r.cleanerName || '').toLowerCase().includes(historySearch.toLowerCase()) ||
                               (r.washroomName || '').toLowerCase().includes(historySearch.toLowerCase());
                      }).map((rec) => (
                        <tr key={rec.id} className="hover:bg-[#FAFAFA] transition-colors">
                          <td className="px-4 py-3 font-mono text-[#6B7280]">
                            {new Date(rec.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}
                          </td>
                          <td className="px-4 py-3 font-mono text-[#252525] font-medium">
                            {rec.nfcCardId}
                          </td>
                          <td className="px-4 py-3 font-medium text-[#252525]">
                            {rec.cleanerName}
                          </td>
                          <td className="px-4 py-3 text-[#6B7280]">
                            {rec.washroomName}
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#FAFAFA] text-[#252525] border border-[#E5E7EB]">
                              {rec.actionType}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-emerald-700 text-[11px] font-medium flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              {rec.badgeStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      </main>

      {/* ---------------- MODALS ---------------- */}

      {/* 1. Register Washroom Modal */}
      {showAddWashroom && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E7EB] rounded-xl max-w-md w-full p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
              <h3 className="font-bold text-[#252525] text-sm">Register Washroom</h3>
              <button onClick={() => setShowAddWashroom(false)} className="text-[#6B7280] hover:text-[#252525]">✕</button>
            </div>

            <form onSubmit={handleAddWashroom} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="text-[#252525] font-semibold block mb-1">Washroom Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Washroom 1 (Ground Floor - North)"
                  value={newWashroomForm.name}
                  onChange={(e) => setNewWashroomForm({ ...newWashroomForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                />
              </div>

              <div>
                <label className="text-[#252525] font-semibold block mb-1">Floor / Zone</label>
                <input
                  type="text"
                  placeholder="e.g. Ground Floor, 1st Floor"
                  value={newWashroomForm.floor}
                  onChange={(e) => setNewWashroomForm({ ...newWashroomForm, floor: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                />
              </div>

              <div className="pt-3 border-t border-[#E5E7EB] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddWashroom(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white font-medium cursor-pointer shadow-sm"
                >
                  Save Washroom
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Register Cleaner Modal */}
      {showAddCleaner && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E7EB] rounded-xl max-w-md w-full p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
              <h3 className="font-bold text-[#252525] text-sm">Register Cleaner</h3>
              <button onClick={() => setShowAddCleaner(false)} className="text-[#6B7280] hover:text-[#252525]">✕</button>
            </div>

            <form onSubmit={handleAddCleaner} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="text-[#252525] font-semibold block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="Enter cleaner's name"
                  value={newCleanerForm.name}
                  onChange={(e) => setNewCleanerForm({ ...newCleanerForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#252525] font-semibold block mb-1">Role</label>
                  <input
                    type="text"
                    placeholder="e.g. Hygiene Attendant"
                    value={newCleanerForm.role}
                    onChange={(e) => setNewCleanerForm({ ...newCleanerForm, role: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                  />
                </div>

                <div>
                  <label className="text-[#252525] font-semibold block mb-1">Assigned Zone</label>
                  <input
                    type="text"
                    placeholder="e.g. Ground Floor"
                    value={newCleanerForm.assignedZone}
                    onChange={(e) => setNewCleanerForm({ ...newCleanerForm, assignedZone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#252525] font-semibold block mb-1">Phone</label>
                  <input
                    type="text"
                    placeholder="Contact number"
                    value={newCleanerForm.phone}
                    onChange={(e) => setNewCleanerForm({ ...newCleanerForm, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                  />
                </div>

                <div>
                  <label className="text-[#252525] font-semibold block mb-1">NFC Card ID</label>
                  <input
                    type="text"
                    placeholder="e.g. NFC-101"
                    value={newCleanerForm.nfcCardId}
                    onChange={(e) => setNewCleanerForm({ ...newCleanerForm, nfcCardId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#E5E7EB] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddCleaner(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white font-medium cursor-pointer shadow-sm"
                >
                  Save Cleaner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Create Task Modal */}
      {showCreateTask && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E7EB] rounded-xl max-w-md w-full p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
              <h3 className="font-bold text-[#252525] text-sm">Create Maintenance Task</h3>
              <button onClick={() => setShowCreateTask(false)} className="text-[#6B7280] hover:text-[#252525]">✕</button>
            </div>

            <form onSubmit={handleCreateTask} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="text-[#252525] font-semibold block mb-1">Target Washroom</label>
                <select
                  value={newTaskForm.washroomId}
                  onChange={(e) => setNewTaskForm({ ...newTaskForm, washroomId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                >
                  {state?.washrooms?.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[#252525] font-semibold block mb-1">Task Title</label>
                <input
                  type="text"
                  required
                  placeholder="Task title"
                  value={newTaskForm.title}
                  onChange={(e) => setNewTaskForm({ ...newTaskForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                />
              </div>

              <div>
                <label className="text-[#252525] font-semibold block mb-1">Description</label>
                <textarea
                  rows="2"
                  placeholder="Task instructions..."
                  value={newTaskForm.description}
                  onChange={(e) => setNewTaskForm({ ...newTaskForm, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                ></textarea>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#252525] font-semibold block mb-1">Priority</label>
                  <select
                    value={newTaskForm.priority}
                    onChange={(e) => setNewTaskForm({ ...newTaskForm, priority: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="text-[#252525] font-semibold block mb-1">Assign Cleaner</label>
                  <select
                    value={newTaskForm.assignedCleanerId}
                    onChange={(e) => setNewTaskForm({ ...newTaskForm, assignedCleanerId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                  >
                    <option value="">Leave Unassigned</option>
                    {state?.cleaners?.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-[#E5E7EB] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateTask(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white font-medium cursor-pointer shadow-sm"
                >
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Assign Cleaner Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E7EB] rounded-xl max-w-sm w-full p-5 shadow-lg">
            <h3 className="font-bold text-[#252525] text-sm mb-3">Assign Cleaner to Task</h3>
            
            {state?.cleaners?.length === 0 ? (
              <p className="text-xs text-[#6B7280] py-3">No cleaners available.</p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {state?.cleaners?.map(cleaner => (
                  <button
                    key={cleaner.id}
                    onClick={() => handleAssignCleaner(showAssignModal, cleaner.id)}
                    className="w-full p-2.5 rounded-lg bg-[#FAFAFA] hover:bg-white border border-[#E5E7EB] text-left flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="font-semibold text-[#252525] text-xs">{cleaner.name}</div>
                      <div className="text-[11px] text-[#6B7280]">{cleaner.assignedZone}</div>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${getCleanerStatusBadge(cleaner.status)}`}>
                      {cleaner.status}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-[#E5E7EB] flex justify-end">
              <button
                onClick={() => setShowAssignModal(null)}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. ESP32 Hardware Wiring Modal */}
      {showWiring && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E7EB] rounded-xl max-w-lg w-full p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
              <h3 className="font-bold text-[#252525] text-sm flex items-center gap-2">
                <Info className="h-4 w-4 text-[#FB6C00]" />
                ESP32 Hardware Connection Guide
              </h3>
              <button onClick={() => setShowWiring(false)} className="text-[#6B7280] hover:text-[#252525]">✕</button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-[#252525]">
              <div className="p-3 rounded-lg bg-[#FAFAFA] border border-[#E5E7EB]">
                <h4 className="font-semibold text-[#252525] mb-2">Pin Connections:</h4>
                <ul className="space-y-1 font-mono text-[11px] text-[#252525]">
                  <li>• MQ-135 Gas / Odor: AOUT → GPIO 34 (ADC1)</li>
                  <li>• HC-SR04 Sonar: TRIG → GPIO 5, ECHO → GPIO 18</li>
                  <li>• Staff Reset Button: GPIO 4 (active LOW)</li>
                  <li>• Green Status LED: GPIO 2</li>
                  <li>• Red Alert LED: GPIO 15</li>
                  <li>• Alert Buzzer: GPIO 13</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-[#FAFAFA] border border-[#E5E7EB] space-y-1">
                <h4 className="font-semibold text-[#252525]">Arduino Sketch:</h4>
                <p className="font-mono text-[#FB6C00] text-[11px]">esp32_connection/hygiene_guard_esp32.ino</p>
                <p className="text-[11px] text-[#6B7280]">
                  Configure your WiFi SSID & Password and server IP (<code className="text-[#252525]">/api/telemetry</code>).
                </p>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-[#E5E7EB] flex justify-end">
              <button onClick={() => setShowWiring(false)} className="px-3.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] text-xs font-medium cursor-pointer">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Threshold Configuration Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E5E7EB] rounded-xl max-w-md w-full p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EB]">
              <h3 className="font-bold text-[#252525] text-sm">Threshold Configuration</h3>
              <button onClick={() => setShowSettings(false)} className="text-[#6B7280] hover:text-[#252525]">✕</button>
            </div>

            <form onSubmit={handleSaveThresholds} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="text-[#252525] font-semibold block mb-1">Air Quality Warning Threshold (PPM)</label>
                <input
                  type="number"
                  value={thresholdForm.gasWarningPpm}
                  onChange={(e) => setThresholdForm({ ...thresholdForm, gasWarningPpm: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                />
              </div>

              <div>
                <label className="text-[#252525] font-semibold block mb-1">Critical Odor Threshold (PPM)</label>
                <input
                  type="number"
                  value={thresholdForm.gasCriticalPpm}
                  onChange={(e) => setThresholdForm({ ...thresholdForm, gasCriticalPpm: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                />
              </div>

              <div>
                <label className="text-[#252525] font-semibold block mb-1">Visitor Count Limit for Cleaning</label>
                <input
                  type="number"
                  value={thresholdForm.visitorsBeforeClean}
                  onChange={(e) => setThresholdForm({ ...thresholdForm, visitorsBeforeClean: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                />
              </div>

              <div className="pt-3 border-t border-[#E5E7EB] flex justify-end gap-2">
                <button type="button" onClick={() => setShowSettings(false)} className="px-3.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-3.5 py-1.5 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white font-medium cursor-pointer shadow-sm">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Firebase Realtime Database Configuration Modal */}
      {showFirebaseModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-[#E5E7EB] rounded-2xl max-w-xl w-full p-6 shadow-2xl my-8">
            <div className="flex items-center justify-between pb-4 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#FB6C00]">
                  <Flame className="h-5 w-5 fill-[#FB6C00]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#252525] text-sm leading-tight">Firebase Realtime Database Setup</h3>
                  <p className="text-[11px] text-[#6B7280]">Direct cloud connectivity for ESP32 and Live Web Dashboard</p>
                </div>
              </div>
              <button
                onClick={() => setShowFirebaseModal(false)}
                className="text-[#6B7280] hover:text-[#252525] text-base p-1 rounded-md hover:bg-gray-100 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Connection Status Banner */}
            <div className="mt-4">
              {firebaseActive ? (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-800">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="font-medium">Firebase RTDB Connected & Listening Live</span>
                  </div>
                  <button
                    onClick={() => {
                      localStorage.removeItem('hygiene_guard_firebase_config');
                      setFirebaseActive(false);
                      setFirebaseNotice('Switched back to local backend.');
                    }}
                    className="text-xs text-rose-600 hover:text-rose-700 font-medium underline cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs text-amber-800">
                  <Info className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>Using local Node.js backend. Connect Firebase below for zero-server cloud streaming.</span>
                </div>
              )}
            </div>

            {firebaseNotice && (
              <div className="mt-3 p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-blue-600" />
                <span>{firebaseNotice}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSaveFirebaseConfig} className="mt-4 space-y-3.5 text-xs">
              {/* Quick Paste Area */}
              <div>
                <label className="text-[#252525] font-semibold block mb-1">
                  Quick Auto-Detect (Paste entire firebaseConfig object or SDK code):
                </label>
                <textarea
                  rows="2"
                  value={rawConfigInput}
                  onChange={(e) => handleParseRawConfig(e.target.value)}
                  placeholder={'const firebaseConfig = {\n  databaseURL: "https://my-app-default-rtdb.firebaseio.com",\n  projectId: "my-app"\n};'}
                  className="w-full px-3 py-2 rounded-lg bg-[#FAFAFA] border border-[#E5E7EB] font-mono text-[11px] text-[#252525] focus:outline-none focus:border-[#FB6C00]"
                />
              </div>

              <div>
                <label className="text-[#252525] font-semibold block mb-1">
                  Firebase Realtime Database URL <span className="text-[#FB6C00]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={firebaseConfig.databaseURL || ''}
                  onChange={(e) => setFirebaseConfig({ ...firebaseConfig, databaseURL: e.target.value.trim() })}
                  placeholder="https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com"
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00] font-mono text-[11px]"
                />
                <span className="text-[10px] text-[#6B7280]">Found in Firebase Console → Realtime Database tab (top URL header)</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[#252525] font-semibold block mb-1">Firebase Project ID</label>
                  <input
                    type="text"
                    value={firebaseConfig.projectId || ''}
                    onChange={(e) => setFirebaseConfig({ ...firebaseConfig, projectId: e.target.value.trim() })}
                    placeholder="my-hygiene-project"
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00] font-mono text-[11px]"
                  />
                </div>
                <div>
                  <label className="text-[#252525] font-semibold block mb-1">Web API Key (Optional)</label>
                  <input
                    type="text"
                    value={firebaseConfig.apiKey || ''}
                    onChange={(e) => setFirebaseConfig({ ...firebaseConfig, apiKey: e.target.value.trim() })}
                    placeholder="AIzaSy..."
                    className="w-full px-3 py-2 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] focus:outline-none focus:border-[#FB6C00] font-mono text-[11px]"
                  />
                </div>
              </div>

              {/* Quick Actions */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB]">
                <button
                  type="button"
                  onClick={handleClearFirebaseData}
                  className="px-3 py-1.5 rounded-lg bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] text-[#E73F1E] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                  title="Wipes all synthetic and historical data, awaiting real ESP32 sensors"
                >
                  <Trash2 className="h-3.5 w-3.5 text-[#E73F1E]" />
                  <span>Empty Database (Live Sensor Mode)</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowFirebaseModal(false)}
                    className="px-3.5 py-1.5 rounded-lg bg-white border border-[#E5E7EB] text-[#252525] cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-[#FB6C00] hover:bg-[#E55F00] text-white font-semibold cursor-pointer shadow-sm flex items-center gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>Save & Connect</span>
                  </button>
                </div>
              </div>
            </form>

            {/* ESP32 Arduino Snippet helper */}
            <div className="mt-5 pt-4 border-t border-[#E5E7EB]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#252525] flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-[#FB6C00]" />
                  Matching ESP32 Firmware Snippet
                </span>
                <button
                  onClick={() => {
                    const snippet = `const char* FIREBASE_DATABASE_URL = "${firebaseConfig.databaseURL || 'https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com'}";\n#define USE_FIREBASE true`;
                    navigator.clipboard.writeText(snippet);
                    setCopiedSnippet(true);
                    setTimeout(() => setCopiedSnippet(false), 2000);
                  }}
                  className="text-[11px] font-medium text-[#FB6C00] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                  {copiedSnippet ? 'Copied!' : 'Copy to Clipboard'}
                </button>
              </div>
              <div className="p-2.5 rounded-lg bg-[#1E1E1E] text-white font-mono text-[11px] overflow-x-auto">
                <div className="text-emerald-400">// In esp32_connection/hygiene_guard_esp32.ino</div>
                <div>#define USE_FIREBASE true</div>
                <div className="text-amber-300">
                  const char* FIREBASE_DATABASE_URL = "{firebaseConfig.databaseURL || 'https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com'}";
                </div>
              </div>
            </div>

            {/* Quick 3-Step Setup Instructions */}
            <div className="mt-4 p-3 rounded-xl bg-[#FAFAFA] border border-[#E5E7EB] text-[11px] text-[#6B7280] space-y-1">
              <span className="font-semibold text-[#252525] block">3-Minute Firebase Setup:</span>
              <p>1. Go to <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" className="text-[#FB6C00] underline font-medium">console.firebase.google.com</a> and create a project.</p>
              <p>2. In the left menu, select <strong>Build → Realtime Database</strong> → click <strong>Create Database</strong>.</p>
              <p>3. Choose <strong>Start in test mode</strong> (or set <code className="text-[#252525]">.read: true, .write: true</code> in the Rules tab) and copy your database URL into the box above!</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
