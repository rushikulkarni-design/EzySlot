import React, { useEffect, useState } from "react";
import api, { apiErr } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Loader2, Inbox, MapPin, Cctv, Trash2, Save, RefreshCw, Mail, Phone, FileText, AlertTriangle, Send, BadgeCheck } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "new", label: "Pending" },
  { value: "under_review", label: "Under Review" },
  { value: "verified", label: "Reviewed" },
  { value: "rejected", label: "Rejected" },
];
const STATUS_STYLES = {
  new: "bg-amber-500/15 text-amber-500",
  under_review: "bg-blue-500/15 text-blue-500",
  verified: "bg-emerald-500/15 text-emerald-500",
  proposal_sent: "bg-indigo-500/15 text-indigo-500",
  payment_claimed: "bg-orange-500/15 text-orange-500",
  considering: "bg-blue-500/15 text-blue-500",
  declined: "bg-red-500/15 text-red-500",
  payment_verified: "bg-teal-500/15 text-teal-500",
  rejected: "bg-red-500/15 text-red-500",
  converted: "bg-purple-500/15 text-purple-500",
};
const STATUS_LABELS = {
  new: "Pending", under_review: "Under Review", verified: "Reviewed",
  proposal_sent: "Proposal Sent", payment_claimed: "Payment Claimed — Verify Manually",
  considering: "Considering", declined: "Proposal Declined", payment_verified: "Payment Verified",
  rejected: "Rejected", converted: "Activated",
};
const emptyProposal = (enquiry) => ({
  name: enquiry.company || enquiry.name || "",
  site_location: enquiry.site_location || "",
  contact_email: enquiry.email || "",
  plan_duration: "6 months",
  amount: "",
  has_compatible_cameras: ["yes", "true", "compatible"].includes(String(enquiry.has_smart_cameras || "").toLowerCase()),
  notes: "",
});
export default function DevEnquiries() {
  const [items, setItems] = useState(null);
  const [proposalTarget, setProposalTarget] = useState(null);
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [form, setForm] = useState(null);
  const [payment, setPayment] = useState({ transaction_reference: "", internal_notes: "" });

  const load = async () => {
    try {
      const { data } = await api.get("/enquiries");
      setItems(data.enquiries || []);
    } catch (e) {
      toast.error(apiErr(e));
      setItems((prev) => prev ?? []);
    }
  };
  useEffect(() => { load(); }, []);
  const updateLocal = (id, changes) => setItems((prev) => prev.map((item) => item.id === id ? { ...item, ...changes } : item));

  const saveReview = async (enquiry) => {
    setSavingId(enquiry.id);
    try {
      const { data } = await api.patch(`/enquiries/${enquiry.id}/review`, {
        status: enquiry.status || "new", internal_notes: enquiry.internal_notes || "",
      });
      updateLocal(enquiry.id, { status: data.status, internal_notes: data.internal_notes });
      toast.success("Review saved");
    } catch (e) { toast.error(apiErr(e)); }
    finally { setSavingId(null); }
  };
  const deleteEnquiry = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      await api.delete(`/enquiries/${deleteTarget.id}`);
      setItems((prev) => prev.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null); toast.success("Enquiry deleted");
    } catch (e) { toast.error(apiErr(e)); }
    finally { setDeletingId(null); }
  };
  const openProposal = (enquiry) => {
    if (!["verified", "proposal_sent"].includes(enquiry.status || "new")) {
      toast.error("Save the review as Reviewed before sending a proposal."); return;
    }
    setProposalTarget(enquiry);
    setForm({ ...emptyProposal(enquiry), ...(enquiry.proposal || {}) });
  };
  const sendProposal = async (event) => {
    event.preventDefault();
    if (!proposalTarget || !form) return;
    if (form.amount === "" || !Number.isFinite(Number(form.amount)) || Number(form.amount) < 0) {
      toast.error("Enter a valid proposal price."); return;
    }
    setBusy(true);
    try {
      await api.post(`/enquiries/${proposalTarget.id}/proposal`, {
        ...form, amount: Number(form.amount), has_compatible_cameras: Boolean(form.has_compatible_cameras),
      });
      toast.success("Proposal email sent successfully");
      setProposalTarget(null); setForm(null); await load();
    } catch (e) { toast.error(apiErr(e)); }
    finally { setBusy(false); }
  };
  const openPayment = (enquiry) => {
    setPaymentTarget(enquiry); setPayment({ transaction_reference: "", internal_notes: "" });
  };
  const verifyPayment = async (event) => {
    event.preventDefault();
    if (!paymentTarget) return;
    if (!window.confirm("Confirm you personally checked the UPI transaction and the full amount has been received?")) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/enquiries/${paymentTarget.id}/verify-payment`, payment);
      if (data.activated) toast.success(`Payment verified; client activated. Credentials email: ${data.credentials_email_status || "unknown"}`);
      else toast.warning(data.message || "Payment recorded, but client activation needs manual account linking.");
      setPaymentTarget(null); await load();
    } catch (e) { toast.error(apiErr(e)); }
    finally { setBusy(false); }
  };

  const visibleItems = (items || []).filter((enquiry) => {
    const status = enquiry.status || "new", query = search.trim().toLowerCase();
    const matchesStatus = filterStatus === "all" || status === filterStatus;
    const values = [enquiry.company, enquiry.name, enquiry.email, enquiry.contact_number, enquiry.site_location];
    return matchesStatus && (!query || values.filter(Boolean).some((v) => String(v).toLowerCase().includes(query)));
  });
  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-display text-2xl font-bold">Enquiry Management</h2>
        <p className="mt-1 text-sm text-sp-sub">Review enquiries, send flexible-price proposals, and activate only after manual UPI verification.</p></div>
      <Button variant="outline" onClick={load} className="border-sp-border"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Input placeholder="Search company, contact, email or location..." value={search} onChange={(e) => setSearch(e.target.value)} className="border-sp-border bg-sp-card" />
      <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="h-10 rounded-md border border-sp-border bg-sp-card px-3 text-sm">
        <option value="all">All statuses</option>
        {[...STATUS_OPTIONS, {value:"proposal_sent",label:"Proposal Sent"},{value:"payment_claimed",label:"Payment Claimed"},{value:"considering",label:"Considering"},{value:"declined",label:"Declined"},{value:"payment_verified",label:"Payment Verified"},{value:"converted",label:"Activated"}].map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </div>
    {items === null ? <Loader2 className="h-6 w-6 animate-spin text-sp-accent" /> : visibleItems.length === 0 ?
      <div className="rounded-xl border border-dashed border-sp-border bg-sp-card p-12 text-center text-sp-sub"><Inbox className="mx-auto mb-2 h-8 w-8" />No matching enquiries found.</div> :
      <div className="space-y-4" data-testid="enquiries-list">{visibleItems.map((enquiry) => {
        const status = enquiry.status || "new";
        return <div key={enquiry.id} className="space-y-4 rounded-xl border border-sp-border bg-sp-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-lg font-semibold">{enquiry.company || enquiry.name}</h3>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.new}`}>{STATUS_LABELS[status] || status}</span></div>
            {enquiry.proposal && <div className="rounded-lg border border-sp-border bg-sp-muted/30 p-3 text-sm space-y-1">
              <div className="font-semibold">Proposal: {enquiry.proposal.plan_duration} · ₹{Number(enquiry.proposal.amount || 0).toLocaleString("en-IN")}</div>
              <div>Customer response: {String(enquiry.proposal.customer_response || "awaiting_response").replaceAll("_", " ")}</div>
              {enquiry.proposal.transaction_reference_submitted && <div className="break-all"><b>Submitted UPI reference:</b> {enquiry.proposal.transaction_reference_submitted}</div>}
              {enquiry.proposal.customer_note && <div><b>Customer note:</b> {enquiry.proposal.customer_note}</div>}
              {status === "payment_claimed" && <div className="font-semibold text-amber-600">Action required: verify the actual bank/UPI transaction before activation.</div>}
            </div>}
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-sp-sub"><span>{enquiry.name}</span>
              {enquiry.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{enquiry.email}</span>}
              {enquiry.contact_number && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{enquiry.contact_number}</span>}
              {enquiry.site_location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{enquiry.site_location}</span>}
              <span className="flex items-center gap-1"><Cctv className="h-3.5 w-3.5" />{enquiry.camera_count ?? "N/A"} cameras</span></div>
            {enquiry.has_smart_cameras && <p className="text-xs text-sp-sub">Smart cameras: {enquiry.has_smart_cameras}</p>}
            {enquiry.message && <div className="rounded-lg bg-sp-bg p-3 text-sm"><p className="mb-1 font-medium">Requirements</p><p className="whitespace-pre-wrap text-sp-sub">{enquiry.message}</p></div>}
            {enquiry.proposal && <div className="rounded-lg border border-sp-border p-3 text-sm"><p className="font-semibold">Proposal: {enquiry.proposal.plan_duration} · ₹{Number(enquiry.proposal.amount || 0).toLocaleString("en-IN")}</p><p className="text-sp-sub">To: {enquiry.proposal.contact_email} · Payment: {enquiry.proposal.payment_status || "pending"}</p>{enquiry.proposal.transaction_reference && <p className="text-sp-sub">UPI reference: {enquiry.proposal.transaction_reference}</p>}</div>}
          </div><Button type="button" variant="outline" disabled={deletingId === enquiry.id || savingId !== null} onClick={() => setDeleteTarget(enquiry)} className="border-red-500/40 text-red-500 hover:bg-red-500/10"><Trash2 className="mr-2 h-4 w-4" />Delete</Button></div>
          {!["converted", "rejected"].includes(status) && <div className="grid gap-4 border-t border-sp-border pt-4 md:grid-cols-2">
            <div className="space-y-2"><label className="text-sm font-medium">Review status</label>
              <select value={status} onChange={(e) => updateLocal(enquiry.id, {status:e.target.value})} className="h-10 w-full rounded-md border border-sp-border bg-sp-bg px-3 text-sm">
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select><p className="text-xs text-sp-sub">Save status as Reviewed before sending the proposal.</p></div>
            <div className="space-y-2"><label className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4" />Internal notes</label>
              <textarea rows={3} value={enquiry.internal_notes || ""} onChange={(e) => updateLocal(enquiry.id, {internal_notes:e.target.value})} placeholder="Record verification findings or follow-up..." className="w-full resize-y rounded-md border border-sp-border bg-sp-bg p-3 text-sm outline-none focus:ring-2 focus:ring-sp-accent" /></div>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button type="button" onClick={() => saveReview(enquiry)} disabled={savingId === enquiry.id} className="bg-sp-accent text-sp-bg">{savingId === enquiry.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Review</Button>
              {status === "verified" && <Button type="button" onClick={() => openProposal(enquiry)} className="bg-indigo-600 text-white hover:bg-indigo-700"><Send className="mr-2 h-4 w-4" />Send Proposal</Button>}
              {status === "proposal_sent" && <Button type="button" onClick={() => openProposal(enquiry)} variant="outline" className="border-sp-border"><Send className="mr-2 h-4 w-4" />Resend / Edit Proposal</Button>}
              {status === "payment_claimed" && <Button type="button" onClick={() => openPayment(enquiry)} className="bg-emerald-600 text-white hover:bg-emerald-700"><BadgeCheck className="mr-2 h-4 w-4" />Verify Payment & Activate</Button>}
              {status === "payment_verified" && <Button type="button" onClick={() => openPayment(enquiry)} className="bg-emerald-600 text-white hover:bg-emerald-700"><BadgeCheck className="mr-2 h-4 w-4" />Finish Activation</Button>}
            </div>
          </div>}
          {status === "converted" && <p className="border-t border-sp-border pt-3 text-sm text-sp-sub">Payment verified and client activated. Client ID: {enquiry.client_id || "available in client management"}.</p>}
        </div>;
      })}</div>}

    <Dialog open={!!proposalTarget} onOpenChange={(open) => { if (!open && !busy) {setProposalTarget(null);setForm(null);} }}>
      <DialogContent className="border-sp-border bg-sp-card sm:max-w-xl"><DialogHeader><DialogTitle className="font-display text-xl">Send Subscription Proposal</DialogTitle></DialogHeader>
        {form && <form onSubmit={sendProposal} className="space-y-3">
          <Input required placeholder="Company / client name" value={form.name} onChange={(e) => setField("name",e.target.value)} className="bg-sp-bg" />
          <Input required placeholder="Site location" value={form.site_location} onChange={(e) => setField("site_location",e.target.value)} className="bg-sp-bg" />
          <Input required type="email" placeholder="Contact email" value={form.contact_email} onChange={(e) => setField("contact_email",e.target.value)} className="bg-sp-bg" />
          <label className="block text-sm font-medium">Subscription duration</label>
          <select required value={form.plan_duration} onChange={(e) => setField("plan_duration",e.target.value)} className="h-10 w-full rounded-md border border-sp-border bg-sp-bg px-3 text-sm">
            {["3 months","6 months","1 year","5 years"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <Input required type="number" min="0" step="0.01" placeholder="Flexible proposal price (INR)" value={form.amount} onChange={(e) => setField("amount",e.target.value)} className="bg-sp-bg" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(form.has_compatible_cameras)} onChange={(e) => setField("has_compatible_cameras",e.target.checked)} />Company already has compatible smart cameras</label>
          <textarea rows={3} placeholder="Optional proposal notes" value={form.notes || ""} onChange={(e) => setField("notes",e.target.value)} className="w-full rounded-md border border-sp-border bg-sp-bg p-3 text-sm" />
          <div className="rounded-lg bg-sp-bg p-3 text-sm"><p><b>UPI:</b> reva.patki2004@oksbi</p><p className="text-sp-sub">The proposal email includes manual payment instructions. No payment gateway is used.</p></div>
          <Button type="submit" disabled={busy} className="w-full bg-sp-accent text-sp-bg">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy ? "Sending Proposal..." : "Email Proposal"}</Button>
        </form>}
      </DialogContent>
    </Dialog>

    <Dialog open={!!paymentTarget} onOpenChange={(open) => {if (!open && !busy) setPaymentTarget(null);}}>
      <DialogContent className="border-sp-border bg-sp-card"><DialogHeader><DialogTitle className="font-display text-xl">Verify Manual UPI Payment</DialogTitle></DialogHeader>
        <form onSubmit={verifyPayment} className="space-y-3">
          <p className="text-sm text-sp-sub">Check your bank/UPI app first. This action activates the subscription and provisions credentials.</p>
          <Input placeholder="UPI transaction reference (recommended)" value={payment.transaction_reference} onChange={(e) => setPayment({...payment,transaction_reference:e.target.value})} className="bg-sp-bg" />
          <textarea rows={3} placeholder="Internal payment verification notes" value={payment.internal_notes} onChange={(e) => setPayment({...payment,internal_notes:e.target.value})} className="w-full rounded-md border border-sp-border bg-sp-bg p-3 text-sm" />
          <Button type="submit" disabled={busy} className="w-full bg-emerald-600 text-white">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy ? "Verifying..." : "Confirm Payment & Activate"}</Button>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={!!deleteTarget} onOpenChange={(open) => {if (!open && !deletingId) setDeleteTarget(null);}}>
      <DialogContent className="border-sp-border bg-sp-card sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2 font-display text-xl"><AlertTriangle className="h-5 w-5 text-red-500" />Delete Enquiry?</DialogTitle></DialogHeader>
        <div className="space-y-5"><p className="text-sm leading-6 text-sp-sub">Permanently delete the enquiry from <span className="font-semibold text-sp-text">{deleteTarget?.company || deleteTarget?.name}</span>? This cannot be undone.</p>
          <div className="flex justify-end gap-3"><Button type="button" variant="outline" disabled={!!deletingId} onClick={() => setDeleteTarget(null)} className="border-sp-border">Cancel</Button>
            <Button type="button" disabled={!!deletingId} onClick={deleteEnquiry} className="bg-red-600 text-white hover:bg-red-700">{deletingId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}{deletingId ? "Deleting..." : "Delete Enquiry"}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}