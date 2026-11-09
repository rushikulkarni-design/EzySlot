import React, { useEffect, useState, useCallback } from "react";
import api, { apiErr } from "../../lib/api";
import { toast } from "sonner";
import {
  CarFront, Plus, Search, Trash2, RefreshCw, Users, ShieldCheck, X,
  Loader2, Hash, UserRound, Building2, FileText, FileSpreadsheet, Download,
  Upload, CheckCircle2, AlertTriangle
} from "lucide-react";

const INITIAL_FORM = { plate_number: "", owner_name: "", category: "staff", vehicle_type: "car", notes: "" };
const VEHICLE_TYPES = ["car", "motorcycle", "scooter", "bicycle", "bus", "truck", "auto-rickshaw", "other"];
const inputClass = "min-h-11 w-full rounded-xl border border-sp-border bg-sp-bg px-3 py-2 text-sm text-sp-text outline-none transition placeholder:text-sp-muted/70 focus:border-sp-accent";

export default function DevKnownVehicles() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const loadClients = useCallback(async () => {
    try {
      const { data } = await api.get("/clients");
      const list = data.clients || [];
      setClients(list);
      setClientId((current) => current && list.some((c) => c.id === current) ? current : (list[0]?.id || ""));
    } catch (error) { toast.error(apiErr(error)); }
  }, []);

  const loadVehicles = useCallback(async (cid) => {
    if (!cid) { setVehicles([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await api.get("/known-vehicles", { params: { client_id: cid } });
      setVehicles(data.vehicles || []);
    } catch (error) { toast.error(apiErr(error)); setVehicles([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);
  useEffect(() => { if (clientId) loadVehicles(clientId); else { setVehicles([]); setLoading(false); } }, [clientId, loadVehicles]);

  const updateField = (event) => setForm((v) => ({ ...v, [event.target.name]: event.target.value }));
  const resetForm = () => { setForm(INITIAL_FORM); setFormOpen(false); };

  const addVehicle = async (event) => {
    event.preventDefault();
    if (!clientId) return toast.error("Select a client first.");
    if (!form.plate_number.trim() || !form.owner_name.trim()) return toast.error("Enter both plate number and owner name.");
    setSaving(true);
    try {
      const { data } = await api.post("/known-vehicles", {
        plate_number: form.plate_number.trim().toUpperCase(),
        owner_name: form.owner_name.trim(), category: form.category,
        vehicle_type: form.vehicle_type, notes: form.notes.trim()
      }, { params: { client_id: clientId } });
      toast.success(`Vehicle ${data.vehicle?.plate_number || form.plate_number} registered.`);
      resetForm(); await loadVehicles(clientId);
    } catch (error) { toast.error(apiErr(error)); }
    finally { setSaving(false); }
  };

  const downloadTemplate = async (type) => {
    try {
      const response = await api.get(`/known-vehicles/template.${type}`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement("a");
      a.href = url; a.download = `ezyslot_vehicle_template.${type}`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast.success(`${type.toUpperCase()} template downloaded.`);
    } catch (error) { toast.error(apiErr(error)); }
  };

  const importVehicles = async () => {
    if (!clientId) return toast.error("Select a parking client first.");
    if (!uploadFile) return toast.error("Choose an .xlsx or .csv file first.");
    const ext = uploadFile.name.toLowerCase();
    if (!ext.endsWith(".xlsx") && !ext.endsWith(".csv")) return toast.error("Only .xlsx and .csv files are supported.");
    const body = new FormData(); body.append("file", uploadFile);
    setImporting(true); setImportResult(null);
    try {
      const { data } = await api.post("/known-vehicles/import", body, {
        params: { client_id: clientId },
        headers: { "Content-Type": "multipart/form-data" }
      });
      setImportResult(data);
      toast.success(`Imported ${data.imported_count} vehicles. ${data.duplicate_count} duplicates and ${data.invalid_count} invalid rows skipped.`);
      setUploadFile(null);
      const picker = document.getElementById("known-vehicle-import-file");
      if (picker) picker.value = "";
      await loadVehicles(clientId);
    } catch (error) { toast.error(apiErr(error)); }
    finally { setImporting(false); }
  };

  const deleteVehicle = async (vehicle) => {
    if (!window.confirm(`Remove ${vehicle.plate_number} from the authorized vehicle list?`)) return;
    setDeletingId(vehicle.id);
    try { await api.delete(`/known-vehicles/${vehicle.id}`); toast.success(`${vehicle.plate_number} removed.`); await loadVehicles(clientId); }
    catch (error) { toast.error(apiErr(error)); }
    finally { setDeletingId(""); }
  };

  const filteredVehicles = vehicles.filter((v) => {
    const term = search.trim().toLowerCase();
    return !term || [v.plate_number, v.owner_name, v.category, v.vehicle_type, v.notes].some((x) => String(x || "").toLowerCase().includes(term));
  });
  const staffCount = vehicles.filter((v) => v.category === "staff").length;
  const authorizedCount = vehicles.filter((v) => v.category === "authorized").length;
  const selectedClient = clients.find((c) => c.id === clientId);

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-sp-muted"><ShieldCheck size={16}/><span>Developer / Vehicle Access Management</span></div>
        <h1 className="text-2xl font-bold tracking-tight text-sp-text sm:text-3xl">Known Vehicles</h1>
        <p className="mt-2 max-w-2xl text-sm text-sp-muted">Register vehicles manually or import a client fleet from the standard Excel/CSV template.</p>
      </div>
      <button type="button" onClick={() => { if (!clientId) return toast.error("Select a client first."); setFormOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sp-accent px-5 py-3 text-sm font-semibold text-white hover:opacity-90"><Plus size={18}/> Register Vehicle</button>
    </div>

    <section className="rounded-2xl border border-sp-border bg-sp-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-sp-text"><Building2 size={17}/> Select Parking Client</div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <select value={clientId} onChange={(e) => { setClientId(e.target.value); setImportResult(null); }} className={`${inputClass} sm:max-w-lg`}>
          <option value="">Select a client...</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.site_location}</option>)}
        </select>
        <button type="button" onClick={() => loadVehicles(clientId)} disabled={!clientId || loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sp-border px-4 text-sm font-medium text-sp-text hover:bg-sp-bg disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/> Refresh</button>
      </div>
      {selectedClient && <p className="mt-3 text-xs text-sp-muted">Managing vehicles for <strong>{selectedClient.name}</strong>. Imports are isolated to this client.</p>}
    </section>

    <section className="rounded-2xl border border-sp-border bg-sp-card p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-2"><FileSpreadsheet className="text-sp-accent" size={21}/><div><h2 className="text-lg font-bold text-sp-text">Bulk Import Vehicles</h2><p className="text-sm text-sp-muted">Use the same standard format for every client.</p></div></div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => downloadTemplate("xlsx")} className="inline-flex items-center gap-2 rounded-xl border border-sp-border px-4 py-3 text-sm font-semibold text-sp-text hover:bg-sp-bg"><Download size={17}/> Download Excel Template</button>
        <button type="button" onClick={() => downloadTemplate("csv")} className="inline-flex items-center gap-2 rounded-xl border border-sp-border px-4 py-3 text-sm font-semibold text-sp-text hover:bg-sp-bg"><Download size={17}/> Download CSV Template</button>
      </div>
      <div className="rounded-xl border border-dashed border-sp-border p-4 space-y-3">
        <label htmlFor="known-vehicle-import-file" className="block text-sm font-semibold text-sp-text">Choose completed template (.xlsx or .csv)</label>
        <input id="known-vehicle-import-file" type="file" accept=".xlsx,.csv" onChange={(e) => { setUploadFile(e.target.files?.[0] || null); setImportResult(null); }} className="block w-full text-sm text-sp-muted file:mr-3 file:rounded-lg file:border-0 file:bg-sp-accent file:px-4 file:py-2 file:font-semibold file:text-white"/>
        {uploadFile && <p className="text-sm text-sp-muted">Selected: <strong className="text-sp-text">{uploadFile.name}</strong></p>}
        <button type="button" onClick={importVehicles} disabled={!clientId || !uploadFile || importing} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sp-accent px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {importing ? <Loader2 size={17} className="animate-spin"/> : <Upload size={17}/>} {importing ? "Validating and importing..." : "Validate & Import Vehicles"}
        </button>
        <p className="text-xs text-sp-muted">Required columns: <code>plate_number</code>, <code>owner_name</code>, <code>category</code>, <code>vehicle_type</code>. Category must be <code>staff</code> or <code>authorized</code>. Duplicate plates for this client are skipped.</p>
      </div>
      {importResult && <div className="rounded-xl border border-sp-border bg-sp-bg p-4 space-y-3">
        <h3 className="font-bold text-sp-text">Import Summary</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Summary icon={CheckCircle2} label="Imported" value={importResult.imported_count} color="text-emerald-400"/>
          <Summary icon={AlertTriangle} label="Duplicates skipped" value={importResult.duplicate_count} color="text-amber-400"/>
          <Summary icon={X} label="Invalid rows" value={importResult.invalid_count} color="text-red-400"/>
        </div>
        {[["Invalid rows", importResult.invalid], ["Duplicates", importResult.duplicates]].map(([label, rows]) => rows?.length > 0 && <details key={label} className="text-sm"><summary className="cursor-pointer font-semibold text-sp-text">{label} ({rows.length})</summary><div className="mt-2 space-y-1">{rows.map((r, i) => <p key={`${r.row}-${i}`} className="text-sp-muted">Row {r.row}: {r.plate_number || "—"} — {r.reason}</p>)}</div></details>)}
      </div>}
    </section>

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard icon={CarFront} label="Total Vehicles" value={vehicles.length} description="Registered for this client"/>
      <StatCard icon={Users} label="Staff Vehicles" value={staffCount} description="Vehicles categorized as staff"/>
      <StatCard icon={ShieldCheck} label="Authorized Vehicles" value={authorizedCount} description="Other approved vehicles"/>
    </div>

    {formOpen && <section className="rounded-2xl border border-sp-border bg-sp-card p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-sp-text">Register a Vehicle</h2><p className="mt-1 text-sm text-sp-muted">Client: {selectedClient?.name || "Selected client"}</p></div><button type="button" onClick={resetForm} className="rounded-lg p-2 text-sp-muted hover:bg-sp-bg" aria-label="Close form"><X size={19}/></button></div>
      <form onSubmit={addVehicle} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Number Plate" icon={Hash} required><input name="plate_number" value={form.plate_number} onChange={updateField} placeholder="e.g. MH12AB1234" required maxLength={20} className={inputClass}/></Field>
          <Field label="Owner Name" icon={UserRound} required><input name="owner_name" value={form.owner_name} onChange={updateField} placeholder="Owner's name" required maxLength={100} className={inputClass}/></Field>
          <Field label="Category" icon={ShieldCheck} required><select name="category" value={form.category} onChange={updateField} className={inputClass}><option value="staff">Staff</option><option value="authorized">Authorized</option></select></Field>
          <Field label="Vehicle Type" icon={CarFront} required><select name="vehicle_type" value={form.vehicle_type} onChange={updateField} className={inputClass}>{VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t.split("-").map((p) => p[0].toUpperCase()+p.slice(1)).join(" ")}</option>)}</select></Field>
          <div className="md:col-span-2"><Field label="Notes (Optional)" icon={FileText}><textarea name="notes" value={form.notes} onChange={updateField} rows={3} maxLength={500} className={`${inputClass} resize-y`}/></Field></div>
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-sp-border pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={resetForm} disabled={saving} className="rounded-xl border border-sp-border px-5 py-3 text-sm font-semibold text-sp-text">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sp-accent px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? <Loader2 size={17} className="animate-spin"/> : <Plus size={17}/>} {saving ? "Registering..." : "Register Vehicle"}</button></div>
      </form>
    </section>}

    <section className="overflow-hidden rounded-2xl border border-sp-border bg-sp-card">
      <div className="flex flex-col gap-4 border-b border-sp-border p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-bold text-sp-text">Registered Vehicles</h2><p className="mt-1 text-sm text-sp-muted">{filteredVehicles.length} vehicle{filteredVehicles.length === 1 ? "" : "s"} shown</p></div><div className="relative w-full sm:max-w-xs"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-sp-muted"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plate, owner..." className={`${inputClass} pl-10`}/></div></div>
      {!clientId ? <Empty title="Select a parking client" description="Choose a client above to manage its vehicles."/> : loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-sp-muted"><Loader2 size={20} className="animate-spin"/> Loading vehicles...</div> : filteredVehicles.length === 0 ? <Empty title={search ? "No matching vehicles" : "No vehicles registered yet"} description={search ? "Try another search term." : "Register or import vehicles to get started."}/> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-sp-bg/70 text-xs uppercase tracking-wide text-sp-muted"><tr>{["Vehicle","Owner","Category","Type","Notes","Action"].map((x) => <th key={x} className="px-5 py-4 font-semibold">{x}</th>)}</tr></thead><tbody className="divide-y divide-sp-border">{filteredVehicles.map((v) => <tr key={v.id} className="transition hover:bg-sp-bg/40"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sp-bg text-sp-accent"><CarFront size={20}/></div><div className="font-bold tracking-wide text-sp-text">{v.plate_number}</div></div></td><td className="px-5 py-4 font-medium text-sp-text">{v.owner_name}</td><td className="px-5 py-4"><span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400">{v.category === "staff" ? "Staff" : "Authorized"}</span></td><td className="px-5 py-4 capitalize text-sp-muted">{(v.vehicle_type || "car").replaceAll("-", " ")}</td><td className="max-w-48 px-5 py-4 text-sp-muted"><span className="block truncate" title={v.notes}>{v.notes || "—"}</span></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => deleteVehicle(v)} disabled={deletingId === v.id} title="Remove vehicle" className="inline-flex items-center justify-center rounded-lg border border-red-500/20 p-2 text-red-400 hover:bg-red-500/10 disabled:opacity-50">{deletingId === v.id ? <Loader2 size={17} className="animate-spin"/> : <Trash2 size={17}/>}</button></td></tr>)}</tbody></table></div>}
    </section>
    <p className="text-xs leading-relaxed text-sp-muted">All imported vehicles are stored under the selected client and are available to the existing registry matching workflow.</p>
  </div>;
}

function Field({ label, icon: Icon, required, children }) { return <label className="block space-y-2"><span className="flex items-center gap-2 text-sm font-medium text-sp-text"><Icon size={15} className="text-sp-muted"/>{label}{required && <span className="text-red-400">*</span>}</span>{children}</label>; }
function StatCard({ icon: Icon, label, value, description }) { return <div className="rounded-2xl border border-sp-border bg-sp-card p-5"><div className="flex items-center justify-between gap-3"><p className="text-sm text-sp-muted">{label}</p><div className="grid h-10 w-10 place-items-center rounded-xl bg-sp-bg text-sp-accent"><Icon size={20}/></div></div><div className="mt-3 text-3xl font-bold text-sp-text">{value}</div><p className="mt-1 text-xs text-sp-muted">{description}</p></div>; }
function Empty({ title, description }) { return <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center"><div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-sp-bg text-sp-muted"><CarFront size={27}/></div><h3 className="font-semibold text-sp-text">{title}</h3><p className="mt-2 max-w-md text-sm text-sp-muted">{description}</p></div>; }
function Summary({ icon: Icon, label, value, color }) { return <div className="rounded-xl border border-sp-border p-3"><div className={`flex items-center gap-2 text-sm ${color}`}><Icon size={16}/>{label}</div><div className="mt-2 text-2xl font-bold text-sp-text">{value}</div></div>; }
