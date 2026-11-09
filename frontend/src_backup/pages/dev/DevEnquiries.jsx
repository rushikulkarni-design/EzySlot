import React, { useEffect, useState } from "react";
import api, { apiErr } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Loader2, Inbox, MapPin, Cctv, ArrowRightCircle } from "lucide-react";
import { toast } from "sonner";

export default function DevEnquiries() {
  const [items, setItems] = useState(null);
  const [convert, setConvert] = useState(null);
  const [form, setForm] = useState({ name: "", site_location: "", contact_email: "", service_days: 180 });

  const load = () => api.get("/enquiries").then((r) => setItems(r.data.enquiries));
  useEffect(() => { load(); }, []);

  const openConvert = (e) => {
    setConvert(e);
    setForm({ name: e.company || e.name, site_location: e.site_location, contact_email: e.email, service_days: 180 });
  };

  const doConvert = async (ev) => {
    ev.preventDefault();
    try {
      const { data } = await api.post(`/enquiries/${convert.id}/convert`, form);
      if (data.provisioned_login) toast.success(`Client created. Login: ${data.provisioned_login.email} / ${data.provisioned_login.password}`, { duration: 10000 });
      else toast.success("Converted to client");
      setConvert(null); load();
    } catch (e) { toast.error(apiErr(e)); }
  };

  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-bold">Service Enquiries</h2>
      {items === null ? <Loader2 className="h-6 w-6 animate-spin text-sp-accent" /> :
        items.length === 0 ? <div className="rounded-xl border border-dashed border-sp-border bg-sp-card p-12 text-center text-sp-sub"><Inbox className="mx-auto mb-2 h-8 w-8" />No enquiries yet.</div> : (
        <div className="space-y-3" data-testid="enquiries-list">
          {items.map((e) => (
            <div key={e.id} className="rounded-xl border border-sp-border bg-sp-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg font-semibold">{e.company || e.name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 font-mono text-xs uppercase ${e.status === "new" ? "bg-sp-unk/20 text-sp-unk" : "bg-sp-free/20 text-sp-free"}`}>{e.status}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-4 text-xs text-sp-sub">
                    <span>{e.name} · {e.email}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{e.site_location}</span>
                    <span className="flex items-center gap-1"><Cctv className="h-3 w-3" />{e.camera_count} cameras</span>
                  </div>
                  {e.message && <p className="mt-2 max-w-2xl text-sm text-sp-sub">{e.message}</p>}
                </div>
                {e.status === "new" && (
                  <Button data-testid={`developer-convert-client-btn-${e.id}`} onClick={() => openConvert(e)} className="bg-sp-accent text-sp-bg hover:bg-sky-400">
                    <ArrowRightCircle className="mr-1 h-4 w-4" />Convert to Client
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!convert} onOpenChange={(o) => !o && setConvert(null)}>
        <DialogContent className="border-sp-border bg-sp-card">
          <DialogHeader><DialogTitle className="font-display text-xl">Convert Enquiry → Client</DialogTitle></DialogHeader>
          <form onSubmit={doConvert} className="space-y-3">
            <Input required placeholder="Client name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-sp-bg" />
            <Input required placeholder="Site location" value={form.site_location} onChange={(e) => setForm({ ...form, site_location: e.target.value })} className="bg-sp-bg" />
            <Input required type="email" placeholder="Contact email (login)" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} className="bg-sp-bg" />
            <Input type="number" placeholder="Service days" value={form.service_days} onChange={(e) => setForm({ ...form, service_days: Number(e.target.value) })} className="bg-sp-bg" />
            <Button type="submit" data-testid="confirm-convert-btn" className="w-full bg-sp-accent text-sp-bg">Create Client Account</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
