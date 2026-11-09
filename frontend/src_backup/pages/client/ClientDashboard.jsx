import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Car,
  CircleUserRound,
  Clock3,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
  ParkingSquare,
  Activity,
  ChevronRight,
} from "lucide-react";

const API_BASE =
  process.env.REACT_APP_BACKEND_URL || "http://127.0.0.1:8000";

function apiUrl(path) {
  return `${API_BASE}/api${path}`;
}

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("sp_token");

  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {}
    throw new Error(message);
  }

  return response.json();
}

function StatCard({ label, value, tone, icon: Icon }) {
  const tones = {
    neutral: "border-slate-700/70 bg-slate-900/70 text-white",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  };

  return (
    <div className={`rounded-2xl border p-5 shadow-xl ${tones[tone] || tones.neutral}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          {label}
        </span>
        <Icon className="h-5 w-5 opacity-80" />
      </div>
      <div className="mt-3 text-3xl font-black tracking-tight">{value}</div>
    </div>
  );
}

function StatusPill({ status }) {
  const config = {
    FREE: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    OCCUPIED: "border-red-400/30 bg-red-400/10 text-red-300",
    UNKNOWN: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  };

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide ${
        config[status] || config.UNKNOWN
      }`}
    >
      {status || "UNKNOWN"}
    </span>
  );
}

export default function ClientDashboard() {
  const [user, setUser] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [activeCameraId, setActiveCameraId] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const activeCamera = useMemo(
    () => cameras.find((camera) => camera.id === activeCameraId) || cameras[0] || null,
    [cameras, activeCameraId]
  );

  const loadDashboard = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);

      setError("");

      const me = await apiFetch("/auth/me");
      setUser(me.user);

      // Client users are automatically scoped by the backend.
      const cameraResponse = await apiFetch("/cameras");
      const nextCameras = cameraResponse.cameras || [];

      setCameras(nextCameras);

      const selectedId =
        activeCameraId && nextCameras.some((c) => c.id === activeCameraId)
          ? activeCameraId
          : nextCameras[0]?.id || null;

      setActiveCameraId(selectedId);

      if (selectedId) {
        const nextStatus = await apiFetch(`/cameras/${selectedId}/status`);
        setStatus(nextStatus);
      } else {
        setStatus(null);
      }
    } catch (err) {
      setError(err.message || "Unable to load parking data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeCameraId]);

  useEffect(() => {
    loadDashboard(false);
  }, [loadDashboard]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (activeCameraId) {
        apiFetch(`/cameras/${activeCameraId}/status`)
          .then(setStatus)
          .catch(() => {});
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [activeCameraId]);

  const selectCamera = async (cameraId) => {
    setActiveCameraId(cameraId);
    setStatus(null);

    try {
      const nextStatus = await apiFetch(`/cameras/${cameraId}/status`);
      setStatus(nextStatus);
    } catch (err) {
      setError(err.message || "Unable to load camera status.");
    }
  };

  const total = status?.total ?? activeCamera?.slot_count ?? 0;
  const free = status?.free ?? 0;
  const occupied = status?.occupied ?? 0;
  const unknown = status?.unknown ?? 0;

  const occupancyPercent = total
    ? Math.round((occupied / total) * 100)
    : 0;

  const lastUpdated = status?.timestamp
    ? new Date(status.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <div className="min-h-screen bg-[#060b12] text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-7 flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 ring-1 ring-sky-400/20">
                <ParkingSquare className="h-5 w-5 text-sky-300" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-300">
                  EzySlot
                </p>
                <h1 className="text-2xl font-black tracking-tight">
                  Parking Dashboard
                </h1>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span className="font-semibold text-slate-200">
                {user?.name || "Client"}
              </span>
              {activeCamera && (
                <>
                  <span className="text-slate-700">•</span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {activeCamera.name}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 sm:block">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Secure client view
              </div>
            </div>

            <button
              onClick={() => loadDashboard(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid min-h-[55vh] place-items-center">
            <div className="text-center">
              <RefreshCw className="mx-auto h-8 w-8 animate-spin text-sky-400" />
              <p className="mt-3 text-sm text-slate-400">
                Loading your parking system...
              </p>
            </div>
          </div>
        ) : !activeCamera ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-12 text-center">
            <ParkingSquare className="mx-auto h-12 w-12 text-slate-600" />
            <h2 className="mt-4 text-xl font-bold">No camera assigned</h2>
            <p className="mt-2 text-sm text-slate-400">
              Your EzySlot account does not have a parking camera assigned yet.
            </p>
          </div>
        ) : (
          <>
            {/* Camera selector */}
            {cameras.length > 1 && (
              <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
                {cameras.map((camera) => (
                  <button
                    key={camera.id}
                    onClick={() => selectCamera(camera.id)}
                    className={`whitespace-nowrap rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
                      camera.id === activeCamera.id
                        ? "border-sky-400/50 bg-sky-400/10 text-sky-300"
                        : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    {camera.name}
                  </button>
                ))}
              </div>
            )}

            {/* System status */}
            <div className="mb-5 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {activeCamera.status === "online" ? (
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/10">
                    <Wifi className="h-5 w-5 text-emerald-400" />
                  </span>
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-400/10">
                    <WifiOff className="h-5 w-5 text-red-400" />
                  </span>
                )}

                <div>
                  <p className="font-bold">{activeCamera.name}</p>
                  <p className="text-xs text-slate-400">
                    Camera {status?.camera_status === "online" ? "online" : "offline"} ·
                    AI source: {status?.source || "—"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Activity className="h-4 w-4 text-sky-400" />
                Last update {lastUpdated}
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Total Slots" value={total} tone="neutral" icon={ParkingSquare} />
              <StatCard label="Free" value={free} tone="green" icon={ChevronRight} />
              <StatCard label="Occupied" value={occupied} tone="red" icon={Car} />
              <StatCard label="Unknown" value={unknown} tone="amber" icon={Clock3} />
            </div>

            {/* Occupancy bar */}
            <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold">Current Occupancy</p>
                  <p className="text-xs text-slate-500">
                    AI-detected parking utilization
                  </p>
                </div>
                <span className="text-xl font-black text-slate-100">
                  {occupancyPercent}%
                </span>
              </div>

              <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-red-400 transition-all duration-500"
                  style={{ width: `${occupancyPercent}%` }}
                />
              </div>
            </div>

            {/* Slot map */}
            <section className="mt-5 rounded-3xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-black">Live Slot Availability</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Slot status is supplied by the EzySlot AI detection service.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-emerald-300">
                    ● Free
                  </span>
                  <span className="rounded-full border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-red-300">
                    ● Occupied
                  </span>
                  <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-amber-300">
                    ● Unknown
                  </span>
                </div>
              </div>

              {status?.slots?.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
                  {status.slots.map((slot) => {
                    const isFree = slot.status === "FREE";
                    const isOccupied = slot.status === "OCCUPIED";

                    return (
                      <div
                        key={slot.slot_id}
                        className={`min-h-[105px] rounded-2xl border p-4 transition ${
                          isFree
                            ? "border-emerald-400/30 bg-emerald-400/10"
                            : isOccupied
                            ? "border-red-400/25 bg-red-400/10"
                            : "border-amber-400/25 bg-amber-400/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span
                            className={`text-lg font-black ${
                              isFree
                                ? "text-emerald-300"
                                : isOccupied
                                ? "text-red-300"
                                : "text-amber-300"
                            }`}
                          >
                            {slot.label}
                          </span>
                          <Car className="h-4 w-4 opacity-50" />
                        </div>

                        <div className="mt-5">
                          <StatusPill status={slot.status} />
                        </div>

                        {slot.vehicle && (
                          <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">
                            {slot.vehicle}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-500">
                  No slot status is available yet.
                </div>
              )}
            </section>

            {/* Footer info */}
            <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Automatic status refresh: every 5 seconds
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CircleUserRound className="h-3.5 w-3.5" />
                {user?.email || "Client account"}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
