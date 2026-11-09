import React, { useEffect, useState } from "react";
import api from "../../lib/api";
import { Loader2, HeartPulse, Database, Wifi, Mail, Cpu, Cctv } from "lucide-react";

export default function DevHealth() {
  const [h, setH] = useState(null);
  const [activity, setActivity] = useState([]);
  useEffect(() => {
    const load = () => { api.get("/system/health").then((r) => setH(r.data)); api.get("/activity", { params: { limit: 40 } }).then((r) => setActivity(r.data.activity)); };
    load(); const t = setInterval(load, 5000); return () => clearInterval(t);
  }, []);

  if (!h) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-sp-accent" /></div>;

  const cards = [
    { icon: Cpu, label: "YOLOv8 Model", value: h.model_ready ? "READY" : "LOADING", c: h.model_ready ? "#10B981" : "#F59E0B" },
    { icon: Database, label: "Database", value: h.db, c: "#10B981" },
    { icon: Wifi, label: "WebSocket rooms", value: h.websocket_rooms, c: "#38BDF8" },
    { icon: Mail, label: "Email backlog", value: h.email_backlog, c: h.email_backlog > 0 ? "#F59E0B" : "#10B981" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2"><HeartPulse className="h-6 w-6 text-sp-accent" /><h2 className="font-display text-2xl font-bold">System Health</h2></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-sp-border bg-sp-card p-5">
            <c.icon className="mb-3 h-6 w-6" style={{ color: c.c }} />
            <div className="font-mono text-2xl font-bold uppercase" style={{ color: c.c }}>{String(c.value)}</div>
            <div className="mt-1 font-mono text-xs uppercase tracking-widest text-sp-sub">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-sp-border bg-sp-card p-6">
          <div className="mb-4 flex items-center gap-2 font-display text-lg font-bold"><Cctv className="h-5 w-5 text-sp-accent" />Camera Feeds</div>
          <div className="space-y-2">
            {h.cameras.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-sp-bg px-4 py-2.5 text-sm">
                <span>{c.name}</span>
                <span className="flex items-center gap-1.5 font-mono text-xs text-sp-free"><span className="h-2 w-2 rounded-full bg-sp-free animate-pulse-ring" />{c.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-sp-border bg-sp-card p-6">
          <div className="mb-4 font-display text-lg font-bold">Activity Log</div>
          <div className="max-h-80 space-y-1.5 overflow-y-auto" data-testid="activity-log">
            {activity.length === 0 ? <p className="text-sp-sub">No activity.</p> : activity.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg bg-sp-bg px-3 py-2 font-mono text-xs">
                <span className="text-sp-accent">{a.action}</span>
                <span className="truncate px-2 text-sp-sub">{a.detail}</span>
                <span className="text-sp-muted">{new Date(a.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
