import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  History,
  RefreshCw,
  Loader2,
  Search,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock3,
  CarFront,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "../../lib/api";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function plateOf(item) {
  return item?.recognition?.plate_number || item?.recognition?.raw_plate_number || "Unreadable";
}

export default function DevNumberPlateHistory() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingClients, setLoadingClients] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState("");

  const loadClients = useCallback(async () => {
    setLoadingClients(true);
    try {
      const { data } = await api.get("/clients");
      const list = data.clients || [];
      setClients(list);
      setClientId((current) => current && list.some((c) => c.id === current) ? current : list[0]?.id || "");
    } catch (error) {
      toast.error(apiErr(error));
    } finally {
      setLoadingClients(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!clientId) {
      setScans([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get("/number-plate/history", {
        params: { client_id: clientId, limit: 200 },
      });
      setScans(data.scans || []);
    } catch (error) {
      toast.error(`Could not load scan history: ${apiErr(error)}`);
      setScans([]);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadClients(); }, [loadClients]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const selectedClient = clients.find((client) => client.id === clientId);
  const allResults = scans.flatMap((scan) => scan.results || []);
  const registeredCount = allResults.filter((item) => item.recognition?.registered).length;
  const unknownCount = allResults.filter((item) => item.recognition?.success && !item.recognition?.registered).length;

  const filteredScans = useMemo(() => {
    const term = query.trim().toLowerCase();
    return scans.filter((scan) => {
      const scanResults = scan.results || [];
      const matchesQuery = !term || [scan.scanned_by, scan.id, ...scanResults.map((item) => plateOf(item))]
        .some((value) => String(value || "").toLowerCase().includes(term));
      const matchesFilter = filter === "all" || scanResults.some((item) => {
        const recognition = item.recognition || {};
        if (filter === "registered") return recognition.registered === true;
        if (filter === "unknown") return recognition.success === true && recognition.registered !== true;
        if (filter === "failed") return recognition.success !== true;
        return true;
      });
      return matchesQuery && matchesFilter;
    });
  }, [scans, query, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-sp-muted">
            <History size={17} /><span>Developer / Vehicle Recognition</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-sp-text sm:text-3xl">Number Plate Scan History</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-sp-muted">Review saved scans, detected registration plates, and registered versus unknown vehicle matches.</p>
        </div>
        <button onClick={loadHistory} disabled={loading || !clientId} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-sp-border px-4 text-sm font-semibold text-sp-text hover:bg-sp-bg disabled:opacity-50">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh history
        </button>
      </div>

      <section className="rounded-2xl border border-sp-border bg-sp-card p-5">
        <label htmlFor="history-client" className="mb-2 flex items-center gap-2 text-sm font-semibold text-sp-text"><Building2 size={17} /> Select Parking Client</label>
        <select id="history-client" value={clientId} onChange={(event) => { setClientId(event.target.value); setExpanded(""); }} disabled={loadingClients || !clients.length} className="min-h-11 w-full rounded-xl border border-sp-border bg-sp-bg px-3 text-sm text-sp-text outline-none focus:border-sp-accent sm:max-w-xl">
          <option value="">{loadingClients ? "Loading clients…" : "Select a client"}</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.site_location ? ` — ${client.site_location}` : ""}</option>)}
        </select>
        {selectedClient && <p className="mt-2 text-xs text-sp-muted">Showing scans for <strong>{selectedClient.name}</strong>.</p>}
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-sp-border bg-sp-card p-5"><p className="text-sm text-sp-muted">Saved scans</p><p className="mt-2 text-3xl font-bold text-sp-text">{scans.length}</p><p className="mt-1 text-xs text-sp-muted">For selected client</p></div>
        <div className="rounded-2xl border border-sp-border bg-sp-card p-5"><p className="text-sm text-sp-muted">Registered matches</p><p className="mt-2 text-3xl font-bold text-emerald-400">{registeredCount}</p><p className="mt-1 text-xs text-sp-muted">Plates matched to known vehicles</p></div>
        <div className="rounded-2xl border border-sp-border bg-sp-card p-5"><p className="text-sm text-sp-muted">Unknown vehicles</p><p className="mt-2 text-3xl font-bold text-amber-400">{unknownCount}</p><p className="mt-1 text-xs text-sp-muted">Successfully read, not registered</p></div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-sp-border bg-sp-card">
        <div className="flex flex-col gap-3 border-b border-sp-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-bold text-sp-text">Saved scan records</h2><p className="mt-1 text-xs text-sp-muted">Newest scans appear first.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-sp-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plate or user…" className="min-h-10 w-full rounded-xl border border-sp-border bg-sp-bg pl-9 pr-3 text-sm text-sp-text outline-none focus:border-sp-accent sm:w-56" /></div>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className="min-h-10 rounded-xl border border-sp-border bg-sp-bg px-3 text-sm text-sp-text outline-none"><option value="all">All results</option><option value="registered">Has registered match</option><option value="unknown">Has unknown vehicle</option><option value="failed">Has failed recognition</option></select>
          </div>
        </div>

        {loading ? <div className="flex items-center justify-center gap-2 p-12 text-sm text-sp-muted"><Loader2 size={20} className="animate-spin" /> Loading scan history…</div> : filteredScans.length === 0 ? <div className="p-12 text-center"><ScanLine size={30} className="mx-auto text-sp-muted" /><p className="mt-3 font-semibold text-sp-text">No scan records found</p><p className="mt-1 text-sm text-sp-muted">Run a number-plate scan for this client, then refresh this page.</p></div> : <div className="divide-y divide-sp-border">
          {filteredScans.map((scan) => {
            const results = scan.results || [];
            const matched = results.filter((item) => item.recognition?.registered).length;
            const isOpen = expanded === scan.id;
            return <div key={scan.id}>
              <button type="button" onClick={() => setExpanded(isOpen ? "" : scan.id)} className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-sp-bg/60 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex min-w-0 items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sp-bg text-sp-accent"><Clock3 size={19} /></div><div className="min-w-0"><p className="font-semibold text-sp-text">{formatDate(scan.created_at)}</p><p className="mt-1 truncate text-xs text-sp-muted">By {scan.scanned_by || "Unknown user"} · Scan ID: {scan.id}</p></div></div>
                <div className="flex items-center gap-2 sm:justify-end"><span className="rounded-lg bg-sp-bg px-3 py-1.5 text-xs font-semibold text-sp-text">{scan.plates_detected ?? results.length} plates</span><span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400">{matched} registered</span>{isOpen ? <ChevronUp size={18} className="text-sp-muted" /> : <ChevronDown size={18} className="text-sp-muted" />}</div>
              </button>
              {isOpen && <div className="border-t border-sp-border bg-sp-bg/40 p-4 sm:p-5"><div className="mb-3 flex items-center gap-2 text-xs text-sp-muted"><CarFront size={15} /> Detected plates and recognition outcomes</div><div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {results.map((item, index) => {
                  const recognition = item.recognition || {};
                  const registered = recognition.registered === true;
                  const failed = recognition.success !== true;
                  return <div key={`${scan.id}-${item.plate_index ?? index}`} className="rounded-xl border border-sp-border bg-sp-card p-4">
                    <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-sp-muted">Plate #{item.plate_index ?? index + 1}</p><p className="mt-1 font-mono text-lg font-bold tracking-wide text-sp-text">{plateOf(item)}</p></div><span className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${registered ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : failed ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>{registered ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{registered ? "Staff / Registered" : failed ? "Recognition failed" : "Unknown"}</span></div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-sp-bg p-2"><p className="text-sp-muted">OCR confidence</p><p className="mt-1 font-semibold text-sp-text">{typeof recognition.confidence === "number" ? `${Math.round(recognition.confidence * 100)}%` : "—"}</p></div><div className="rounded-lg bg-sp-bg p-2"><p className="text-sp-muted">Detection confidence</p><p className="mt-1 font-semibold text-sp-text">{typeof item.detection_confidence === "number" ? `${Math.round(item.detection_confidence * 100)}%` : "—"}</p></div></div>
                    {recognition.vehicle && <p className="mt-3 text-xs text-sp-muted">Owner: <strong className="text-sp-text">{recognition.vehicle.owner_name || "—"}</strong> · Type: {recognition.vehicle.vehicle_type || "—"}</p>}
                    {recognition.message && <p className="mt-2 text-xs leading-5 text-sp-muted">{recognition.message}</p>}
                    {Array.isArray(item.box) && <p className="mt-2 text-[11px] text-sp-muted">Box: [{item.box.join(", ")}]</p>}
                  </div>;
                })}
              </div></div>}
            </div>;
          })}
        </div>}
      </section>
    </div>
  );
}
