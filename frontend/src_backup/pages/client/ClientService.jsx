import React, { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";
import { Loader2, CalendarClock, Receipt, MapPin, BadgeCheck } from "lucide-react";

export default function ClientService() {
  const { user } = useAuth();
  const [client, setClient] = useState(null);

  useEffect(() => {
    api.get("/me/client", { params: { client_id: user.client_id } }).then((r) => setClient(r.data.client));
  }, [user.client_id]);

  if (!client) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-sp-accent" /></div>;
  const fare = client.fare_config || {};

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border border-sp-border bg-sp-card p-6">
        <div className="mb-4 flex items-center gap-2 font-display text-xl font-bold"><BadgeCheck className="h-5 w-5 text-sp-accent" />Service Status</div>
        <div className="space-y-3 text-sm">
          <Row icon={MapPin} label="Site" value={client.site_location} />
          <Row icon={CalendarClock} label="Valid until" value={new Date(client.service_end).toLocaleDateString()} />
          <div className="flex items-center justify-between rounded-lg bg-sp-bg px-4 py-3">
            <span className="text-sp-sub">Days remaining</span>
            <span data-testid="days-remaining" className={`font-mono text-2xl font-bold ${client.expired ? "text-sp-occ" : "text-sp-free"}`}>{client.days_remaining}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sp-sub">Status</span>
            <span className={`rounded-full px-3 py-1 font-mono text-xs uppercase ${client.expired ? "bg-sp-occ/20 text-sp-occ" : "bg-sp-free/20 text-sp-free"}`}>
              {client.expired ? "expired" : "active"}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-sp-border bg-sp-card p-6">
        <div className="mb-4 flex items-center gap-2 font-display text-xl font-bold"><Receipt className="h-5 w-5 text-sp-accent" />Fare Information</div>
        {!fare.enabled ? <p className="text-sp-sub">Fare billing is not enabled for this site.</p> : (
          <div data-testid="fare-info" className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-sp-bg px-4 py-3">
              <span className="text-sp-sub">Model</span><span className="font-mono uppercase text-sp-accent">{fare.type}</span>
            </div>
            {fare.type === "per_hour" && <FareRow label="Per hour" value={`${fare.currency} ${fare.per_hour}`} />}
            {fare.type === "fixed" && <FareRow label="Fixed" value={`${fare.currency} ${fare.fixed}`} />}
            {fare.type === "slab" && (fare.slabs || []).map((s, i) => (
              <FareRow key={i} label={`Up to ${s.upto_hours}h`} value={`${fare.currency} ${s.price}`} />
            ))}
            {fare.slabs?.length > 0 && fare.type !== "slab" && (
              <div className="mt-3 border-t border-sp-border pt-3">
                <div className="mb-2 font-mono text-xs uppercase tracking-widest text-sp-sub">Slab rates</div>
                {fare.slabs.map((s, i) => <FareRow key={i} label={`Up to ${s.upto_hours}h`} value={`${fare.currency} ${s.price}`} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const Row = ({ icon: Icon, label, value }) => (
  <div className="flex items-center justify-between">
    <span className="flex items-center gap-2 text-sp-sub"><Icon className="h-4 w-4" />{label}</span>
    <span className="text-white">{value}</span>
  </div>
);
const FareRow = ({ label, value }) => (
  <div className="flex items-center justify-between rounded-lg bg-sp-bg px-4 py-2.5 text-sm">
    <span className="text-sp-sub">{label}</span><span className="font-mono font-bold text-white">{value}</span>
  </div>
);
