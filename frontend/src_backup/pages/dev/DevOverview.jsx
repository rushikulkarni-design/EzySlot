import React, { useEffect, useState } from "react";
import api from "../../lib/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts";
import { Loader2, Users, Cctv, Ticket, Inbox, Cpu, Gauge } from "lucide-react";

export default function DevOverview() {
  const [s, setS] = useState(null);
  useEffect(() => {
    const load = () => api.get("/stats/overview").then((r) => setS(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!s) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-sp-accent" /></div>;

  const kpis = [
    { icon: Users, label: "Active Clients", value: s.clients, c: "#38BDF8" },
    { icon: Cctv, label: "Cameras Online", value: s.cameras, c: "#06B6D4" },
    { icon: Inbox, label: "New Enquiries", value: s.new_enquiries, c: "#F59E0B" },
    { icon: Ticket, label: "Open Tickets", value: s.open_tickets, c: "#EF4444" },
  ];
  const pie = [
    { name: "Free", value: s.occupancy.free, c: "#10B981" },
    { name: "Occupied", value: s.occupancy.occupied, c: "#EF4444" },
    { name: "Unknown", value: s.occupancy.unknown, c: "#F59E0B" },
  ];
  const bar = (s.recent_snapshots || []).slice(0, 10).reverse().map((r) => ({ name: (r.camera_name || "").split("—")[0].trim().slice(0, 8), occ: r.occupied, free: r.free }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} data-testid={`kpi-${k.label.toLowerCase().replace(/ /g, "-")}`} className="rounded-xl border border-sp-border bg-sp-card p-5 transition-colors hover:bg-sp-cardh">
            <div className="flex items-center justify-between">
              <k.icon className="h-6 w-6" style={{ color: k.c }} />
              <span className="font-mono text-3xl font-bold" style={{ color: k.c }}>{k.value}</span>
            </div>
            <div className="mt-2 font-mono text-xs uppercase tracking-widest text-sp-sub">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-sp-border bg-sp-card p-6 lg:col-span-1">
          <div className="mb-4 flex items-center gap-2 font-display text-lg font-bold"><Gauge className="h-5 w-5 text-sp-accent" />Fleet Occupancy</div>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {pie.map((p, i) => <Cell key={i} fill={p.c} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#0F1420", border: "1px solid #1E293B", borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4">
            {pie.map((p) => <div key={p.name} className="flex items-center gap-1.5 font-mono text-xs"><span className="h-2 w-2 rounded-full" style={{ background: p.c }} />{p.name} {p.value}</div>)}
          </div>
        </div>

        <div className="rounded-xl border border-sp-border bg-sp-card p-6 lg:col-span-2">
          <div className="mb-4 font-display text-lg font-bold">Recent Camera Snapshots</div>
          {bar.length === 0 ? <p className="text-sp-sub">Awaiting detections…</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={bar}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="name" tick={{ fill: "#64748B", fontSize: 10 }} />
                <YAxis tick={{ fill: "#64748B", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#0F1420", border: "1px solid #1E293B", borderRadius: 8 }} cursor={{ fill: "#161F33" }} />
                <Bar dataKey="occ" stackId="a" fill="#EF4444" radius={[0, 0, 0, 0]} />
                <Bar dataKey="free" stackId="a" fill="#10B981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-sp-border bg-sp-card p-6">
        <div className="mb-3 flex items-center gap-2 font-display text-lg font-bold"><Cpu className="h-5 w-5 text-sp-accent" />System Telemetry</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Tele label="YOLOv8 Model" value={s.model_ready ? "READY" : "LOADING"} c={s.model_ready ? "#10B981" : "#F59E0B"} />
          <Tele label="Inference latency" value={`${s.inference_ms} ms`} c="#38BDF8" />
          <Tele label="CV backend" value="CPU · yolov8n" c="#06B6D4" />
        </div>
      </div>
    </div>
  );
}

const Tele = ({ label, value, c }) => (
  <div className="rounded-lg border border-sp-border bg-sp-bg p-4">
    <div className="font-mono text-xs uppercase tracking-widest text-sp-sub">{label}</div>
    <div className="mt-1 font-mono text-xl font-bold" style={{ color: c }}>{value}</div>
  </div>
);
