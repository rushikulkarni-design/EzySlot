import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import api, { apiErr } from "../../lib/api";
import {
  Loader2, CalendarClock, Receipt, MapPin, BadgeCheck, Save,
  Power, Clock3, Coins, ShieldCheck, CheckCircle2, AlertCircle
} from "lucide-react";
import { toast } from "sonner";

const DEFAULT_FARE = {
  enabled: false,
  type: "per_hour",
  currency: "INR",
  per_hour: 40,
  per_interval: 20,
  billing_interval_minutes: 60,
  grace_period_minutes: 0,
  charge_partial_interval: true,
  fixed: 100,
  slabs: [
    { upto_hours: 1, price: 30 },
    { upto_hours: 3, price: 80 },
    { upto_hours: 24, price: 200 },
  ],
};

const inputClass = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100";
const labelClass = "block text-sm font-semibold text-slate-700";

export default function ClientService() {
  const { user } = useAuth();
  const clientId = user?.client_id;
  const [client, setClient] = useState(null);
  const [fare, setFare] = useState(DEFAULT_FARE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      setLoadError("This login is not linked to a client site.");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const [clientResult, fareResult] = await Promise.all([
          api.get("/me/client", { params: { client_id: clientId } }),
          api.get("/fare", { params: { client_id: clientId } }).catch(() => null),
        ]);
        if (cancelled) return;
        const clientData = clientResult.data?.client || null;
        setClient(clientData);
        const savedFare = fareResult?.data?.fare_config || clientData?.fare_config || {};
        setFare({
          ...DEFAULT_FARE,
          ...savedFare,
          slabs: Array.isArray(savedFare.slabs) && savedFare.slabs.length
            ? savedFare.slabs
            : DEFAULT_FARE.slabs,
        });
      } catch (error) {
        if (!cancelled) {
          setLoadError(apiErr(error));
          toast.error("Unable to load service and fare settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const updateFare = (field, value) => setFare((current) => ({ ...current, [field]: value }));

  const preview = useMemo(() => {
    if (!fare.enabled) return 0;
    const hours = 2.5;
    if (fare.type === "fixed") return Number(fare.fixed) || 0;
    if (fare.type === "per_interval") {
      const interval = Math.max(1, Number(fare.billing_interval_minutes) || 60);
      const minutes = Math.max(0, hours * 60 - (Number(fare.grace_period_minutes) || 0));
      const units = fare.charge_partial_interval ? Math.ceil(minutes / interval) : Math.floor(minutes / interval);
      return Math.max(0, units) * (Number(fare.per_interval) || 0);
    }
    if (fare.type === "slabs") {
      const slab = [...(fare.slabs || [])].sort((a, b) => Number(a.upto_hours) - Number(b.upto_hours))
        .find((item) => hours <= Number(item.upto_hours));
      return Number(slab?.price ?? fare.slabs?.[fare.slabs.length - 1]?.price) || 0;
    }
    return Math.ceil(hours) * (Number(fare.per_hour) || 0);
  }, [fare]);

  const saveFare = async () => {
    setSaving(true);
    try {
      const payload = {
        ...fare,
        enabled: Boolean(fare.enabled),
        type: fare.type,
        currency: "INR",
        per_hour: Math.max(0, Number(fare.per_hour) || 0),
        per_interval: Math.max(0, Number(fare.per_interval) || 0),
        billing_interval_minutes: Math.max(1, Number(fare.billing_interval_minutes) || 60),
        grace_period_minutes: Math.max(0, Number(fare.grace_period_minutes) || 0),
        charge_partial_interval: Boolean(fare.charge_partial_interval),
        fixed: Math.max(0, Number(fare.fixed) || 0),
        slabs: (fare.slabs || []).map((slab) => ({
          upto_hours: Math.max(1, Number(slab.upto_hours) || 1),
          price: Math.max(0, Number(slab.price) || 0),
        })),
      };
      const { data } = await api.put("/fare", payload, { params: { client_id: clientId } });
      setFare((current) => ({ ...current, ...(data?.fare_config || payload) }));
      setSavedAt(new Date());
      toast.success("Fare settings saved for this site");
    } catch (error) {
      toast.error(apiErr(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-72 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-orange-500" /></div>;
  }

  if (loadError && !client) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <AlertCircle className="mb-2 h-5 w-5" />{loadError}
      </div>
    );
  }

  const serviceEnd = client?.service_end ? new Date(client.service_end) : null;
  const days = Number(client?.days_remaining ?? 0);
  const expired = Boolean(client?.expired);

  return (
    <div className="min-h-full space-y-6 bg-slate-50/70 p-1 text-slate-900">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-orange-700">
            <Coins className="h-3.5 w-3.5" /> Client billing controls
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Service &amp; Fare</h1>
          <p className="mt-1 text-sm text-slate-500">Configure parking prices for your own site. Changes apply to new billing calculations.</p>
        </div>
        <button onClick={saveFare} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving settings…" : "Save fare settings"}
        </button>
      </header>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-orange-50 text-orange-600"><BadgeCheck className="h-5 w-5" /></div>
            <div><h2 className="text-lg font-extrabold">Service status</h2><p className="text-sm text-slate-500">Your EzySlot site subscription</p></div>
          </div>
          <div className="space-y-4">
            <InfoRow icon={MapPin} label="Site" value={client?.site_location || "Site not specified"} />
            <InfoRow icon={CalendarClock} label="Valid until" value={serviceEnd && !Number.isNaN(serviceEnd.getTime()) ? serviceEnd.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—"} />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Days remaining</p><p className={`mt-2 text-3xl font-black ${expired ? "text-red-600" : "text-emerald-600"}`}>{days}</p></div>
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Service status</p><div className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${expired ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}><span className={`h-1.5 w-1.5 rounded-full ${expired ? "bg-red-500" : "bg-emerald-500"}`} />{expired ? "EXPIRED" : "ACTIVE"}</div></div>
            </div>
          </div>
        </section>

        <section className={`rounded-2xl border p-5 shadow-sm sm:p-6 ${fare.enabled ? "border-orange-200 bg-white" : "border-slate-200 bg-white"}`}>
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-orange-50 text-orange-600"><Receipt className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1"><h2 className="text-lg font-extrabold">Dynamic parking fare</h2><p className="text-sm text-slate-500">You control whether customers are charged</p></div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${fare.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{fare.enabled ? "ENABLED" : "DISABLED"}</span>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <div className={`grid h-10 w-10 place-items-center rounded-lg ${fare.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}><Power className="h-5 w-5" /></div>
              <div><p className="font-bold">Enable fare billing</p><p className="text-xs text-slate-500">Switch on when your rates are ready</p></div>
            </div>
            <button type="button" role="switch" aria-checked={fare.enabled} onClick={() => updateFare("enabled", !fare.enabled)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${fare.enabled ? "bg-emerald-500" : "bg-slate-300"}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${fare.enabled ? "left-6" : "left-1"}`} /></button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div><label className={labelClass}>Pricing model</label><select className={inputClass} value={fare.type} onChange={(e) => updateFare("type", e.target.value)}><option value="per_hour">Per hour</option><option value="per_interval">Per time interval</option><option value="fixed">Fixed charge per visit</option><option value="slabs">Time-based slab rates</option></select></div>
            <div><label className={labelClass}>Currency</label><div className={`${inputClass} flex items-center gap-2 bg-slate-50`}><span className="font-bold text-orange-600">₹</span><span>Indian Rupee (INR)</span></div></div>
          </div>

          {fare.type === "per_hour" && <div className="mt-4"><label className={labelClass}>Price per hour (₹)</label><input type="number" min="0" step="1" className={inputClass} value={fare.per_hour} onChange={(e) => updateFare("per_hour", e.target.value)} /><p className="mt-1 text-xs text-slate-500">The amount is calculated from each vehicle's detected parking duration.</p></div>}

          {fare.type === "per_interval" && <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><label className={labelClass}>Price per interval (₹)</label><input type="number" min="0" step="1" className={inputClass} value={fare.per_interval} onChange={(e) => updateFare("per_interval", e.target.value)} /></div><div><label className={labelClass}>Interval length (minutes)</label><input type="number" min="1" max="1440" className={inputClass} value={fare.billing_interval_minutes} onChange={(e) => updateFare("billing_interval_minutes", e.target.value)} /></div></div>}

          {fare.type === "fixed" && <div className="mt-4"><label className={labelClass}>Fixed price per visit (₹)</label><input type="number" min="0" step="1" className={inputClass} value={fare.fixed} onChange={(e) => updateFare("fixed", e.target.value)} /><p className="mt-1 text-xs text-slate-500">One flat charge for a completed parking visit.</p></div>}

          {fare.type === "slabs" && <div className="mt-4 space-y-3"><p className={labelClass}>Slab rates</p>{(fare.slabs || []).map((slab, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"><div><label className="text-xs text-slate-500">Up to hours</label><input type="number" min="1" className={inputClass} value={slab.upto_hours} onChange={(e) => updateFare("slabs", fare.slabs.map((x, i) => i === index ? { ...x, upto_hours: e.target.value } : x))} /></div><div><label className="text-xs text-slate-500">Price (₹)</label><input type="number" min="0" className={inputClass} value={slab.price} onChange={(e) => updateFare("slabs", fare.slabs.map((x, i) => i === index ? { ...x, price: e.target.value } : x))} /></div><button type="button" onClick={() => updateFare("slabs", fare.slabs.filter((_, i) => i !== index))} className="mb-1 rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-500 hover:border-red-200 hover:text-red-600" aria-label="Remove slab">×</button></div>)}<button type="button" onClick={() => updateFare("slabs", [...(fare.slabs || []), { upto_hours: (fare.slabs?.length || 0) + 1, price: 0 }])} className="rounded-lg border border-orange-200 px-3 py-2 text-sm font-bold text-orange-700 hover:bg-orange-50">+ Add slab</button></div>}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div><label className={labelClass}>Grace period (minutes)</label><input type="number" min="0" max="1440" className={inputClass} value={fare.grace_period_minutes} onChange={(e) => updateFare("grace_period_minutes", e.target.value)} /><p className="mt-1 text-xs text-slate-500">Free time before charging starts.</p></div>
            {fare.type === "per_interval" && <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 accent-orange-500" checked={Boolean(fare.charge_partial_interval)} onChange={(e) => updateFare("charge_partial_interval", e.target.checked)} />Charge for a partially used interval</label>}
          </div>

          <div className="mt-5 rounded-xl border border-orange-100 bg-orange-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-orange-900"><Clock3 className="h-4 w-4" /> Example fare preview</div>
            <p className="mt-1 text-xs leading-relaxed text-orange-800">For a 2.5-hour stay, your current settings estimate:</p>
            <div className="mt-2 text-3xl font-black tracking-tight text-orange-700">{fare.enabled ? `₹${preview.toFixed(2)}` : "₹0.00"}</div>
            <p className="mt-1 text-xs text-orange-800">{fare.enabled ? "Illustrative preview; actual charges use each session's recorded duration." : "Billing is disabled. No fare will be calculated while disabled."}</p>
          </div>

          <div className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />These settings are saved to your authenticated client site. Other clients have their own independent fare rules.</div>
          {savedAt && <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />Saved at {savedAt.toLocaleTimeString()}</p>}
        </section>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="flex items-center gap-2 text-sm text-slate-500"><Icon className="h-4 w-4 text-orange-500" />{label}</span><span className="text-right text-sm font-semibold text-slate-800">{value}</span></div>;
}
