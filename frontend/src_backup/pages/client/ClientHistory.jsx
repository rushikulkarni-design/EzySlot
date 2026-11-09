import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../../context/AuthContext";

import api from "../../lib/api";

import {

  AreaChart,

  Area,

  XAxis,

  YAxis,

  Tooltip,

  ResponsiveContainer,

  CartesianGrid,

} from "recharts";

import { Button } from "../../components/ui/button";

import {

  Activity,

  BarChart3,

  CalendarDays,

  Car,

  Clock3,

  History,

  Loader2,

  RefreshCw,

  ScanText,

  TrendingUp,

} from "lucide-react";

const COLORS = {

  free: "#10B981",

  occupied: "#EF4444",

  unknown: "#F59E0B",

};

const formatDate = (timestamp) => {

  if (!timestamp) return "—";

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString([], {

    day: "2-digit",

    month: "short",

    year: "numeric",

  });

};

const formatTime = (timestamp) => {

  if (!timestamp) return "—";

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleTimeString([], {

    hour: "2-digit",

    minute: "2-digit",

    second: "2-digit",

  });

};

const formatDateTime = (timestamp) => {

  if (!timestamp) return "—";

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "—";

  return `${date.toLocaleDateString([], {

    day: "2-digit",

    month: "short",

    year: "numeric",

  })} · ${date.toLocaleTimeString([], {

    hour: "2-digit",

    minute: "2-digit",

  })}`;

};

const occupancyPercent = (occupied, total) => {

  if (!total) return 0;

  return Math.round((Number(occupied || 0) / Number(total)) * 100);

};

export default function ClientHistory() {

  const { user } = useAuth();

  const cid = user?.client_id;

  const [tab, setTab] = useState("snapshots");

  const [snaps, setSnaps] = useState(null);

  const [events, setEvents] = useState(null);
  const [scans, setScans] = useState(null);

  const [loading, setLoading] = useState(false);

  const [lastUpdated, setLastUpdated] = useState(null);

  const loadHistory = useCallback(async () => {

    if (!cid) return;

    setLoading(true);

    try {

      const [snapshotResult, eventResult, scanResult] = await Promise.allSettled([
        api.get("/history", { params: { client_id: cid, kind: "snapshots", limit: 100 } }),
        api.get("/history", { params: { client_id: cid, kind: "events", limit: 100 } }),
        api.get("/number-plate/history", { params: { client_id: cid, limit: 100 } }),
      ]);

      const snapshotResponse = snapshotResult.status === "fulfilled" ? snapshotResult.value : { data: {} };
      const eventResponse = eventResult.status === "fulfilled" ? eventResult.value : { data: {} };

      if (scanResult.status === "fulfilled") {
        const scanData = scanResult.value.data;
        setScans(Array.isArray(scanData?.scans) ? scanData.scans : []);
      } else {
        console.error("Number plate scan history loading failed:", scanResult.reason);
        setScans([]);
      }

      const snapshotItems = Array.isArray(snapshotResponse.data?.items)

        ? snapshotResponse.data.items

        : [];

      const eventItems = Array.isArray(eventResponse.data?.items)

        ? eventResponse.data.items

        : [];

      /*

       * Backend returns newest first.

       * For the chart we want oldest -> newest.

       */

      setSnaps([...snapshotItems].reverse());

      /*

       * Events remain newest first because this is easier

       * for the client to read as a recent activity feed.

       */

      setEvents(eventItems);

      setLastUpdated(new Date());

    } catch (error) {

      console.error("History loading failed:", error);

      setSnaps([]);

      setEvents([]);

    } finally {

      setLoading(false);

    }

  }, [cid]);

  useEffect(() => {

    loadHistory();

  }, [loadHistory]);

  /*

   * Prepare chart data.

   */

  const chart = useMemo(() => {

    if (!snaps?.length) return [];

    return snaps.map((snapshot, index) => {

      const total =

        Number(snapshot.total) ||

        Number(snapshot.free || 0) +

          Number(snapshot.occupied || 0) +

          Number(snapshot.unknown || 0);

      return {

        index,

        timestamp: snapshot.timestamp,

        time: formatTime(snapshot.timestamp),

        free: Number(snapshot.free || 0),

        occupied: Number(snapshot.occupied || 0),

        unknown: Number(snapshot.unknown || 0),

        total,

        occupancy: occupancyPercent(snapshot.occupied, total),

        camera:

          snapshot.camera_name ||

          snapshot.camera ||

          snapshot.name ||

          "Parking Camera",

      };

    });

  }, [snaps]);

  /*

   * Latest snapshot.

   */

  const latest = useMemo(() => {

    if (!snaps?.length) return null;

    return snaps[snaps.length - 1];

  }, [snaps]);

  const latestTotal = latest

    ? Number(latest.total) ||

      Number(latest.free || 0) +

        Number(latest.occupied || 0) +

        Number(latest.unknown || 0)

    : 0;

  const latestFree = Number(latest?.free || 0);

  const latestOccupied = Number(latest?.occupied || 0);

  const latestUnknown = Number(latest?.unknown || 0);

  const latestOccupancy = occupancyPercent(

    latestOccupied,

    latestTotal

  );

  /*

   * Event statistics.

   */

  const eventStats = useMemo(() => {

    if (!events?.length) {

      return {

        total: 0,

        occupied: 0,

        free: 0,

        unknown: 0,

      };

    }

    return {

      total: events.length,

      occupied: events.filter(

        (event) => event.to_status === "OCCUPIED"

      ).length,

      free: events.filter(

        (event) => event.to_status === "FREE"

      ).length,

      unknown: events.filter(

        (event) => event.to_status === "UNKNOWN"

      ).length,

    };

  }, [events]);

  return (

    <div className="space-y-6">

      {/* ========================================================= */}

      {/* HEADER */}

      {/* ========================================================= */}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

        <div>

          <div className="flex items-center gap-3">

            <History className="h-6 w-6 text-sp-accent" />

            <h1 className="font-display text-2xl font-bold">

              Parking History

            </h1>

          </div>

          <p className="mt-1 text-sm text-sp-sub">

            Review historical parking occupancy and slot activity.

          </p>

        </div>

        <div className="flex items-center gap-3">

          {lastUpdated && (

            <div className="hidden items-center gap-2 text-xs text-sp-sub md:flex">

              <Clock3 className="h-3.5 w-3.5" />

              Updated{" "}

              {lastUpdated.toLocaleTimeString([], {

                hour: "2-digit",

                minute: "2-digit",

              })}

            </div>

          )}

          <Button

            data-testid="history-refresh-btn"

            variant="outline"

            disabled={loading}

            onClick={loadHistory}

            className="border-sp-border"

          >

            <RefreshCw

              className={`mr-2 h-4 w-4 ${

                loading ? "animate-spin" : ""

              }`}

            />

            Refresh

          </Button>

        </div>

      </div>

      {/* ========================================================= */}

      {/* SUMMARY CARDS */}

      {/* ========================================================= */}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

        {/* Latest Occupancy */}

        <div className="rounded-xl border border-sp-border bg-sp-card p-5">

          <div className="flex items-center justify-between">

            <span className="font-mono text-xs uppercase tracking-widest text-sp-sub">

              Current Occupancy

            </span>

            <TrendingUp className="h-4 w-4 text-sp-accent" />

          </div>

          <div className="mt-4 font-display text-3xl font-bold">

            {latest ? `${latestOccupancy}%` : "—"}

          </div>

          <p className="mt-1 text-xs text-sp-sub">

            Based on latest YOLO analysis

          </p>

        </div>

        {/* Free */}

        <div className="rounded-xl border border-sp-free/20 bg-sp-card p-5">

          <div className="flex items-center justify-between">

            <span className="font-mono text-xs uppercase tracking-widest text-sp-sub">

              Free Slots

            </span>

            <div

              className="flex h-8 w-8 items-center justify-center rounded-lg"

              style={{

                background: `${COLORS.free}15`,

              }}

            >

              <Car

                className="h-4 w-4"

                style={{ color: COLORS.free }}

              />

            </div>

          </div>

          <div

            className="mt-4 font-display text-3xl font-bold"

            style={{ color: COLORS.free }}

          >

            {latest ? latestFree : "—"}

          </div>

          <p className="mt-1 text-xs text-sp-sub">

            Currently available

          </p>

        </div>

        {/* Occupied */}

        <div className="rounded-xl border border-sp-occupied/20 bg-sp-card p-5">

          <div className="flex items-center justify-between">

            <span className="font-mono text-xs uppercase tracking-widest text-sp-sub">

              Occupied

            </span>

            <Activity className="h-4 w-4 text-red-400" />

          </div>

          <div

            className="mt-4 font-display text-3xl font-bold"

            style={{ color: COLORS.occupied }}

          >

            {latest ? latestOccupied : "—"}

          </div>

          <p className="mt-1 text-xs text-sp-sub">

            Currently occupied

          </p>

        </div>

        {/* Total */}

        <div className="rounded-xl border border-sp-border bg-sp-card p-5">

          <div className="flex items-center justify-between">

            <span className="font-mono text-xs uppercase tracking-widest text-sp-sub">

              Total Slots

            </span>

            <BarChart3 className="h-4 w-4 text-sp-accent" />

          </div>

          <div className="mt-4 font-display text-3xl font-bold">

            {latest ? latestTotal : "—"}

          </div>

          <p className="mt-1 text-xs text-sp-sub">

            Configured parking slots

          </p>

        </div>

      </div>

      {/* ========================================================= */}

      {/* TABS */}

      {/* ========================================================= */}

      <div className="flex flex-wrap gap-2">

        <Button

          data-testid="history-tab-snapshots"

          variant={

            tab === "snapshots"

              ? "default"

              : "outline"

          }

          onClick={() => setTab("snapshots")}

          className={

            tab === "snapshots"

              ? "bg-sp-accent text-sp-bg"

              : "border-sp-border"

          }

        >

          <BarChart3 className="mr-2 h-4 w-4" />

          Occupancy Trend

        </Button>

        <Button

          data-testid="history-tab-events"

          variant={

            tab === "events"

              ? "default"

              : "outline"

          }

          onClick={() => setTab("events")}

          className={

            tab === "events"

              ? "bg-sp-accent text-sp-bg"

              : "border-sp-border"

          }

        >

          <Activity className="mr-2 h-4 w-4" />

          Slot Events
        </Button>

        <Button
          data-testid="history-tab-scans"
          variant={tab === "scans" ? "default" : "outline"}
          onClick={() => setTab("scans")}
          className={tab === "scans" ? "bg-sp-accent text-sp-bg" : "border-sp-border"}
        >
          <ScanText className="mr-2 h-4 w-4" />
          Scan History
          {Array.isArray(scans) && scans.length > 0 && (
            <span className="ml-2 rounded-full bg-black/10 px-2 py-0.5 text-xs">{scans.length}</span>
          )}
        </Button>
      </div>

      {/* ========================================================= */}

      {/* OCCUPANCY TREND */}

      {/* ========================================================= */}

      {tab === "snapshots" && (

        <div className="rounded-xl border border-sp-border bg-sp-card p-6">

          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">

            <div>

              <div className="font-display text-xl font-bold">

                Occupancy Trend

              </div>

              <p className="mt-1 text-xs text-sp-sub">

                Historical parking utilization recorded by EzySlot AI.

              </p>

            </div>

            {chart.length > 0 && (

              <div className="font-mono text-xs text-sp-sub">

                {chart.length} records

              </div>

            )}

          </div>

          {loading && !snaps ? (

            <div className="flex h-80 items-center justify-center">

              <Loader2 className="h-7 w-7 animate-spin text-sp-accent" />

            </div>

          ) : chart.length === 0 ? (

            <div className="flex h-80 flex-col items-center justify-center text-center">

              <BarChart3 className="mb-4 h-10 w-10 text-sp-muted" />

              <p className="font-medium">

                No occupancy history yet

              </p>

              <p className="mt-1 max-w-md text-sm text-sp-sub">

                Run YOLO analysis or allow the live monitoring

                service to generate occupancy records.

              </p>

            </div>

          ) : (

            <ResponsiveContainer width="100%" height={360}>

              <AreaChart

                data={chart}

                margin={{

                  top: 10,

                  right: 10,

                  left: 0,

                  bottom: 5,

                }}

              >

                <defs>

                  <linearGradient

                    id="historyFreeGradient"

                    x1="0"

                    y1="0"

                    x2="0"

                    y2="1"

                  >

                    <stop

                      offset="5%"

                      stopColor={COLORS.free}

                      stopOpacity={0.45}

                    />

                    <stop

                      offset="95%"

                      stopColor={COLORS.free}

                      stopOpacity={0}

                    />

                  </linearGradient>

                  <linearGradient

                    id="historyOccupiedGradient"

                    x1="0"

                    y1="0"

                    x2="0"

                    y2="1"

                  >

                    <stop

                      offset="5%"

                      stopColor={COLORS.occupied}

                      stopOpacity={0.45}

                    />

                    <stop

                      offset="95%"

                      stopColor={COLORS.occupied}

                      stopOpacity={0}

                    />

                  </linearGradient>

                  <linearGradient

                    id="historyUnknownGradient"

                    x1="0"

                    y1="0"

                    x2="0"

                    y2="1"

                  >

                    <stop

                      offset="5%"

                      stopColor={COLORS.unknown}

                      stopOpacity={0.45}

                    />

                    <stop

                      offset="95%"

                      stopColor={COLORS.unknown}

                      stopOpacity={0}

                    />

                  </linearGradient>

                </defs>

                <CartesianGrid

                  strokeDasharray="3 3"

                  stroke="#1E293B"

                />

                <XAxis

                  dataKey="time"

                  tick={{

                    fill: "#64748B",

                    fontSize: 10,

                  }}

                  minTickGap={45}

                />

                <YAxis

                  allowDecimals={false}

                  tick={{

                    fill: "#64748B",

                    fontSize: 10,

                  }}

                />

                <Tooltip

                  contentStyle={{

                    background: "#0F1420",

                    border: "1px solid #1E293B",

                    borderRadius: 10,

                    color: "#fff",

                  }}

                  labelStyle={{

                    color: "#94A3B8",

                    marginBottom: 6,

                  }}

                  formatter={(value, name) => [

                    value,

                    name === "occupied"

                      ? "Occupied"

                      : name === "free"

                      ? "Free"

                      : "Unknown",

                  ]}

                />

                <Area

                  type="monotone"

                  dataKey="free"

                  stroke={COLORS.free}

                  fill="url(#historyFreeGradient)"

                  strokeWidth={2}

                  stackId="1"

                />

                <Area

                  type="monotone"

                  dataKey="occupied"

                  stroke={COLORS.occupied}

                  fill="url(#historyOccupiedGradient)"

                  strokeWidth={2}

                  stackId="1"

                />

                <Area

                  type="monotone"

                  dataKey="unknown"

                  stroke={COLORS.unknown}

                  fill="url(#historyUnknownGradient)"

                  strokeWidth={2}

                  stackId="1"

                />

              </AreaChart>

            </ResponsiveContainer>

          )}

          {/* Chart Legend */}

          {chart.length > 0 && (

            <div className="mt-5 flex flex-wrap items-center gap-5 border-t border-sp-border pt-4">

              <div className="flex items-center gap-2 text-xs text-sp-sub">

                <span

                  className="h-2.5 w-2.5 rounded-full"

                  style={{ background: COLORS.free }}

                />

                Free

              </div>

              <div className="flex items-center gap-2 text-xs text-sp-sub">

                <span

                  className="h-2.5 w-2.5 rounded-full"

                  style={{ background: COLORS.occupied }}

                />

                Occupied

              </div>

              <div className="flex items-center gap-2 text-xs text-sp-sub">

                <span

                  className="h-2.5 w-2.5 rounded-full"

                  style={{ background: COLORS.unknown }}

                />

                Unknown

              </div>

            </div>

          )}

        </div>

      )}

      {/* ========================================================= */}

      {/* SLOT EVENTS */}

      {/* ========================================================= */}

      {tab === "events" && (

        <div className="rounded-xl border border-sp-border bg-sp-card p-6">

          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">

            <div>

              <div className="font-display text-xl font-bold">

                Slot Activity

              </div>

              <p className="mt-1 text-xs text-sp-sub">

                Changes detected in individual parking slots.

              </p>

            </div>

            <div className="font-mono text-xs text-sp-sub">

              {eventStats.total} events

            </div>

          </div>

          {/* Event Summary */}

          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">

            <div className="rounded-lg border border-sp-border bg-sp-bg p-4">

              <div className="text-xs text-sp-sub">

                Total Events

              </div>

              <div className="mt-1 font-display text-xl font-bold">

                {eventStats.total}

              </div>

            </div>

            <div className="rounded-lg border border-sp-occupied/20 bg-sp-bg p-4">

              <div className="text-xs text-sp-sub">

                Became Occupied

              </div>

              <div

                className="mt-1 font-display text-xl font-bold"

                style={{ color: COLORS.occupied }}

              >

                {eventStats.occupied}

              </div>

            </div>

            <div className="rounded-lg border border-sp-free/20 bg-sp-bg p-4">

              <div className="text-xs text-sp-sub">

                Became Free

              </div>

              <div

                className="mt-1 font-display text-xl font-bold"

                style={{ color: COLORS.free }}

              >

                {eventStats.free}

              </div>

            </div>

            <div className="rounded-lg border border-sp-unk/20 bg-sp-bg p-4">

              <div className="text-xs text-sp-sub">

                Unknown

              </div>

              <div

                className="mt-1 font-display text-xl font-bold"

                style={{ color: COLORS.unknown }}

              >

                {eventStats.unknown}

              </div>

            </div>

          </div>

          {loading && !events ? (

            <div className="flex h-64 items-center justify-center">

              <Loader2 className="h-7 w-7 animate-spin text-sp-accent" />

            </div>

          ) : !events?.length ? (

            <div className="flex h-64 flex-col items-center justify-center text-center">

              <Activity className="mb-4 h-10 w-10 text-sp-muted" />

              <p className="font-medium">

                No slot events yet

              </p>

              <p className="mt-1 text-sm text-sp-sub">

                Slot changes will appear here automatically.

              </p>

            </div>

          ) : (

            <div

              className="max-h-[520px] space-y-2 overflow-y-auto pr-1"

              data-testid="events-list"

            >

              {events.map((event, index) => {

                const fromColor =

                  COLORS[event.from_status] || "#94A3B8";

                const toColor =

                  COLORS[event.to_status] || "#94A3B8";

                return (

                  <div

                    key={

                      event.id ||

                      `${event.timestamp}-${event.label}-${index}`

                    }

                    className="rounded-lg border border-sp-border bg-sp-bg p-4 transition-colors hover:border-sp-accent/30"

                  >

                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">

                      {/* Left */}

                      <div className="flex items-center gap-3">

                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sp-accent/10">

                          <Activity className="h-4 w-4 text-sp-accent" />

                        </div>

                        <div>

                          <div className="flex items-center gap-2">

                            <span className="font-mono text-sm font-bold text-sp-accent">

                              {event.label || event.slot_id || "Slot"}

                            </span>

                            <span className="text-xs text-sp-sub">

                              {event.camera_name || "Camera"}

                            </span>

                          </div>

                          <div className="mt-1 flex items-center gap-2 text-xs text-sp-muted">

                            <CalendarDays className="h-3.5 w-3.5" />

                            {formatDateTime(event.timestamp)}

                          </div>

                        </div>

                      </div>

                      {/* Right */}

                      <div className="flex items-center gap-2 pl-13 md:pl-0">

                        <span

                          className="rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold"

                          style={{

                            color: fromColor,

                            borderColor: `${fromColor}55`,

                            background: `${fromColor}10`,

                          }}

                        >

                          {event.from_status || "—"}

                        </span>

                        <span className="text-sp-muted">

                          →

                        </span>

                        <span

                          className="rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold"

                          style={{

                            color: toColor,

                            borderColor: `${toColor}55`,

                            background: `${toColor}10`,

                          }}

                        >

                          {event.to_status || "—"}

                        </span>

                      </div>

                    </div>

                  </div>

                );

              })}

            </div>

          )}

        </div>

      )}

      {/* ========================================================= */}

      {/* NUMBER PLATE SCAN HISTORY */}
      {tab === "scans" && (
        <div className="rounded-xl border border-sp-border bg-sp-card p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 font-display text-xl font-bold">
                <ScanText className="h-5 w-5 text-sp-accent" />
                Number Plate Scan History
              </div>
              <p className="mt-1 text-sm text-sp-sub">
                Review previous number plate scans and recognition results for your parking facility.
              </p>
            </div>
            <div className="font-mono text-xs text-sp-sub">
              {Array.isArray(scans) ? `${scans.length} scans` : "Loading scans…"}
            </div>
          </div>

          {scans === null ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-sp-accent" />
            </div>
          ) : scans.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <ScanText className="mb-4 h-10 w-10 text-sp-muted" />
              <p className="font-medium">No number plate scans yet</p>
              <p className="mt-2 max-w-md text-sm text-sp-sub">
                Scans created from Client Live Monitor will appear here after detection and recognition.
              </p>
            </div>
          ) : (
            <div className="max-h-[620px] space-y-3 overflow-y-auto pr-1" data-testid="scan-history-list">
              {scans.map((scan, index) => {
                const results = Array.isArray(scan.results) ? scan.results : [];
                const scanId = scan.id || scan.scan_id || `${scan.created_at || "scan"}-${index}`;
                return (
                  <div key={scanId} className="rounded-xl border border-sp-border bg-sp-bg p-4 transition-colors hover:border-sp-accent/30">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sp-accent/10">
                          <ScanText className="h-5 w-5 text-sp-accent" />
                        </div>
                        <div>
                          <div className="font-semibold">Scan #{scans.length - index}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sp-sub">
                            <span className="inline-flex items-center gap-1">
                              <CalendarDays className="h-3.5 w-3.5" />
                              {formatDateTime(scan.created_at || scan.timestamp)}
                            </span>
                            {scan.scanned_by && <span>By {scan.scanned_by}</span>}
                          </div>
                        </div>
                      </div>
                      <span className="rounded-full border border-sp-accent/30 bg-sp-accent/10 px-3 py-1 font-mono text-xs text-sp-accent">
                        {Number(scan.plates_detected ?? results.length)} plates detected
                      </span>
                    </div>

                    {results.length ? (
                      <div className="mt-4 grid gap-2 md:grid-cols-2">
                        {results.map((item, resultIndex) => {
                          const recognition = item.recognition || item;
                          const match = recognition.match || recognition.matched_vehicle || recognition.vehicle || {};
                          const plate =
                            recognition.plate_number ||
                            recognition.recognized_plate ||
                            recognition.number_plate ||
                            recognition.plate ||
                            recognition.text ||
                            match.registration_number ||
                            match.plate_number ||
                            "Plate not recognized";
                          const owner =
                            recognition.owner_name || recognition.owner ||
                            match.owner_name || match.owner || "";
                          const status =
                            recognition.status || recognition.match_status ||
                            ((recognition.matched || recognition.is_registered) ? "Matched" : "");
                          return (
                            <div key={`${scanId}-${item.plate_index || resultIndex}`} className="rounded-lg border border-sp-border p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="break-all font-mono text-sm font-bold">{String(plate)}</div>
                                  {owner && <div className="mt-1 text-xs text-sp-sub">Owner: {String(owner)}</div>}
                                </div>
                                <span className="shrink-0 rounded-full bg-sp-card px-2 py-1 text-[10px] text-sp-sub">
                                  Plate {item.plate_index || resultIndex + 1}
                                </span>
                              </div>
                              {status && (
                                <div className="mt-2 flex items-center gap-1 text-xs text-sp-sub">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-sp-accent" />
                                  {String(status)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg border border-dashed border-sp-border p-3 text-sm text-sp-sub">
                        No plates were detected in this scan.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* FOOTER INFO */}

      {/* ========================================================= */}

      <div className="rounded-xl border border-sp-border bg-sp-card px-5 py-4">

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">

          <div className="flex items-center gap-2 text-xs text-sp-sub">

            <Activity className="h-4 w-4 text-sp-accent" />

            History is generated from EzySlot AI occupancy analysis.

          </div>

          <div className="font-mono text-[10px] uppercase tracking-wider text-sp-muted">

            Client ID: {cid ? `${cid.slice(0, 8)}...` : "—"}

          </div>

        </div>

      </div>

    </div>

  );

}