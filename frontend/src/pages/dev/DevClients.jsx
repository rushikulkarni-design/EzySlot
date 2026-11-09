import React, { useEffect, useState } from "react";
import api, { apiErr } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { Loader2, Plus, Building2, Clock, KeyRound, Copy } from "lucide-react";
import { toast } from "sonner";

export default function DevClients() {
  const [clients, setClients] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", site_location: "", contact_email: "", service_days: 180 });

  const load = () => api.get("/clients").then((r) => setClients(r.data.clients));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/clients", form);
      if (data.provisioned_login) {
        toast.success(`Client created. Login: ${data.provisioned_login.email} / ${data.provisioned_login.password}`, { duration: 10000 });
      } else toast.success("Client created");
      setForm({ name: "", site_location: "", contact_email: "", service_days: 180 }); setOpen(false); load();
    } catch (e2) { toast.error(apiErr(e2)); }
  };

  const extend = async (id) => {
    try { await api.put(`/clients/${id}/service`, { service_days: 365 }); toast.success("Service extended by 365 days"); load(); }
    catch (e) { toast.error(apiErr(e)); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold">Clients</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-client-btn" className="bg-sp-accent text-sp-bg hover:bg-sky-400"><Plus className="mr-1 h-4 w-4" />Add Client</Button>
          </DialogTrigger>
          <DialogContent className="border-sp-border bg-sp-card">
            <DialogHeader><DialogTitle className="font-display text-xl">Onboard New Client</DialogTitle></DialogHeader>
            <form onSubmit={create} className="space-y-3">
              <Input required data-testid="client-name" placeholder="Client / venue name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-sp-bg" />
              <Input required data-testid="client-site" placeholder="Site location" value={form.site_location} onChange={(e) => setForm({ ...form, site_location: e.target.value })} className="bg-sp-bg" />
              <Input required type="email" data-testid="client-email" placeholder="Contact email (becomes login)" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="bg-sp-bg" />
              <Input type="number" data-testid="client-days" placeholder="Service days" value={form.service_days} onChange={(e) => setForm({ ...form, service_days: Number(e.target.value) })} className="bg-sp-bg" />
              <Button type="submit" data-testid="client-create-submit" className="w-full bg-sp-accent text-sp-bg">Create Client</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {clients === null ? <Loader2 className="h-6 w-6 animate-spin text-sp-accent" /> :
        clients.length === 0 ? <p className="text-sp-sub">No clients yet.</p> : (
        <div className="grid gap-4 md:grid-cols-2" data-testid="clients-list">
          {clients.map((c) => (
            <div key={c.id} className="rounded-xl border border-sp-border bg-sp-card p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-sp-accent/15 text-sp-accent"><Building2 className="h-5 w-5" /></div>
                  <div>
                    <div className="font-display text-lg font-semibold">{c.name}</div>
                    <div className="text-xs text-sp-sub">{c.site_location}</div>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 font-mono text-xs uppercase ${c.status === "active" ? "bg-sp-free/20 text-sp-free" : "bg-sp-occ/20 text-sp-occ"}`}>{c.status}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-sp-bg px-3 py-2"><div className="text-xs text-sp-sub">Cameras</div><div className="font-mono text-white">{c.camera_count}</div></div>
                <div className="rounded-lg bg-sp-bg px-3 py-2"><div className="text-xs text-sp-sub">Valid until</div><div className="font-mono text-white">{new Date(c.service_end).toLocaleDateString()}</div></div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex flex-1 items-center gap-1.5 truncate rounded-lg bg-sp-bg px-3 py-2 font-mono text-xs text-sp-sub">
                  <KeyRound className="h-3.5 w-3.5" /> <span className="truncate">{c.api_token}</span>
                  <button onClick={() => { navigator.clipboard.writeText(c.api_token); toast.success("Token copied"); }} className="ml-auto hover:text-white"><Copy className="h-3.5 w-3.5" /></button>
                </div>
                <Button data-testid={`extend-service-${c.id}`} size="sm" variant="outline" onClick={() => extend(c.id)} className="border-sp-border"><Clock className="mr-1 h-3.5 w-3.5" />+1yr</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
