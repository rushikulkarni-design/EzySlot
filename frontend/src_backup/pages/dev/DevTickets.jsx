import React, { useEffect, useState } from "react";
import api, { apiErr } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Loader2, Ticket, Send } from "lucide-react";
import { toast } from "sonner";

const STATUS = { open: "#F59E0B", in_progress: "#38BDF8", resolved: "#10B981" };

export default function DevTickets() {
  const [tickets, setTickets] = useState(null);
  const [reply, setReply] = useState({});

  const load = () => api.get("/tickets").then((r) => setTickets(r.data.tickets));
  useEffect(() => { load(); }, []);

  const update = async (id, body) => {
    try { await api.put(`/tickets/${id}`, body); toast.success("Ticket updated"); setReply({ ...reply, [id]: "" }); load(); }
    catch (e) { toast.error(apiErr(e)); }
  };

  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-bold">Support Tickets</h2>
      {tickets === null ? <Loader2 className="h-6 w-6 animate-spin text-sp-accent" /> :
        tickets.length === 0 ? <p className="text-sp-sub">No tickets.</p> : (
        <div className="space-y-3" data-testid="dev-tickets-list">
          {tickets.map((t) => (
            <div key={t.id} className="rounded-xl border border-sp-border bg-sp-card p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <Ticket className="mt-1 h-5 w-5 text-sp-accent" />
                  <div>
                    <div className="font-display text-lg font-semibold">{t.subject}</div>
                    <p className="mt-1 text-sm text-sp-sub">{t.description}</p>
                    <div className="mt-1 font-mono text-xs text-sp-muted">by {t.created_by} · {t.priority} priority</div>
                  </div>
                </div>
                <select data-testid={`ticket-status-${t.id}`} value={t.status} onChange={(e) => update(t.id, { status: e.target.value })}
                  className="rounded-md border border-sp-border bg-sp-bg px-2 py-1 font-mono text-xs uppercase" style={{ color: STATUS[t.status] }}>
                  <option value="open">open</option><option value="in_progress">in_progress</option><option value="resolved">resolved</option>
                </select>
              </div>
              {t.responses?.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-sp-border pt-3">
                  {t.responses.map((r, i) => (
                    <div key={i} className="rounded-lg bg-sp-bg px-3 py-2 text-sm"><span className="font-mono text-xs text-sp-accent">{r.role}: </span>{r.text}</div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <Input data-testid={`ticket-reply-${t.id}`} placeholder="Reply to client…" value={reply[t.id] || ""} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} className="bg-sp-bg" />
                <Button data-testid={`ticket-send-${t.id}`} onClick={() => reply[t.id] && update(t.id, { response: reply[t.id], status: "in_progress" })} className="bg-sp-accent text-sp-bg"><Send className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
