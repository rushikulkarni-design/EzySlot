import React, { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import api from "../../lib/api";
import {
  Plus,
  MessageSquare,
  Send,
  X,
  RefreshCw,
  Clock3,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Ticket,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { toast } from "sonner";

const STATUS_META = {
  open: {
    label: "OPEN",
    className: "border-sky-400/30 bg-sky-400/10 text-sky-400",
    icon: Clock3,
  },
  in_progress: {
    label: "IN PROGRESS",
    className: "border-yellow-400/30 bg-yellow-400/10 text-yellow-400",
    icon: AlertCircle,
  },
  resolved: {
    label: "RESOLVED",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-400",
    icon: CheckCircle2,
  },
};

const PRIORITY_META = {
  low: "text-emerald-400",
  medium: "text-sky-400",
  high: "text-orange-400",
  critical: "text-red-400",
};

const emptyForm = {
  subject: "",
  description: "",
  priority: "medium",
};

export default function ClientTickets() {
  const { user } = useAuth();

  const [tickets, setTickets] = useState(null);
  const [selected, setSelected] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const clientId = user?.client_id;

  const loadTickets = async (silent = false) => {
    try {
      if (!silent) setRefreshing(true);

      const response = await api.get("/tickets", {
        params: {
          client_id: clientId,
        },
      });

      const list = response.data?.tickets || [];
      setTickets(list);

      // Keep selected ticket synchronized with latest backend data.
      if (selected) {
        const updated = list.find((t) => t.id === selected.id);
        if (updated) {
          setSelected(updated);
        }
      }
    } catch (error) {
      console.error(error);
      toast.error("Unable to load support tickets");
      if (tickets === null) setTickets([]);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (clientId) {
      loadTickets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const createTicket = async (event) => {
    event.preventDefault();

    if (!form.subject.trim()) {
      toast.error("Please enter a subject");
      return;
    }

    if (!form.description.trim()) {
      toast.error("Please describe the issue");
      return;
    }

    try {
      setCreating(true);

      const response = await api.post("/tickets", {
        subject: form.subject.trim(),
        description: form.description.trim(),
        priority: form.priority,
      });

      const newTicket = response.data?.ticket;

      if (newTicket) {
        setTickets((prev) => [newTicket, ...(prev || [])]);
        setSelected(newTicket);
      }

      setForm(emptyForm);
      setShowCreate(false);

      toast.success("Support ticket created");
    } catch (error) {
      console.error(error);
      toast.error(
        error?.response?.data?.detail || "Failed to create support ticket"
      );
    } finally {
      setCreating(false);
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;

    try {
      setSending(true);

      const response = await api.put(`/tickets/${selected.id}`, {
        response: reply.trim(),
      });

      const updatedTicket = response.data?.ticket;

      if (updatedTicket) {
        setSelected(updatedTicket);

        setTickets((prev) =>
          (prev || []).map((ticket) =>
            ticket.id === updatedTicket.id ? updatedTicket : ticket
          )
        );
      }

      setReply("");
      toast.success("Reply sent");
    } catch (error) {
      console.error(error);
      toast.error(
        error?.response?.data?.detail || "Failed to send reply"
      );
    } finally {
      setSending(false);
    }
  };

  const getStatus = (status) => {
    return STATUS_META[status] || STATUS_META.open;
  };

  const getPriorityClass = (priority) => {
    return PRIORITY_META[priority] || PRIORITY_META.medium;
  };

  const formatDate = (value) => {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleString([], {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getResponseCount = (ticket) => {
    return Array.isArray(ticket?.responses)
      ? ticket.responses.length
      : 0;
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-sp-accent/30 bg-sp-accent/10">
              <MessageSquare className="h-5 w-5 text-sp-accent" />
            </div>

            <div>
              <h1 className="font-display text-3xl font-bold text-white">
                Support Center
              </h1>

              <p className="mt-1 text-sm text-sp-sub">
                Raise issues, contact the EzySlot team and track your requests.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            data-testid="refresh-tickets-btn"
            variant="outline"
            disabled={refreshing}
            onClick={() => loadTickets()}
            className="border-sp-border bg-sp-card hover:bg-sp-cardh"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${
                refreshing ? "animate-spin" : ""
              }`}
            />
            Refresh
          </Button>

          <Button
            data-testid="new-ticket-btn"
            onClick={() => setShowCreate(true)}
            className="bg-sp-accent text-sp-bg hover:bg-sky-400"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Ticket
          </Button>
        </div>
      </div>

      {/* SUMMARY */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Total Tickets"
          value={tickets?.length ?? 0}
          icon={<Ticket className="h-5 w-5" />}
        />

        <SummaryCard
          label="Open"
          value={
            tickets
              ? tickets.filter(
                  (ticket) =>
                    ticket.status === "open" ||
                    ticket.status === "in_progress"
                ).length
              : 0
          }
          icon={<Clock3 className="h-5 w-5" />}
        />

        <SummaryCard
          label="Resolved"
          value={
            tickets
              ? tickets.filter((ticket) => ticket.status === "resolved")
                  .length
              : 0
          }
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
      </div>

      {/* MAIN CONTENT */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* TICKET LIST */}
        <div className="lg:col-span-5">
          <div className="overflow-hidden rounded-xl border border-sp-border bg-sp-card">
            <div className="flex items-center justify-between border-b border-sp-border px-5 py-4">
              <div>
                <div className="font-display text-lg font-bold text-white">
                  My Tickets
                </div>
                <div className="mt-1 text-xs text-sp-sub">
                  Your support requests
                </div>
              </div>

              <span className="rounded-full border border-sp-border bg-sp-bg px-3 py-1 font-mono text-xs text-sp-sub">
                {tickets?.length ?? 0}
              </span>
            </div>

            <div className="max-h-[650px] overflow-y-auto">
              {tickets === null ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-sp-accent" />
                </div>
              ) : tickets.length === 0 ? (
                <EmptyTickets onCreate={() => setShowCreate(true)} />
              ) : (
                <div className="divide-y divide-sp-border">
                  {tickets.map((ticket) => {
                    const status = getStatus(ticket.status);
                    const StatusIcon = status.icon;

                    return (
                      <button
                        key={ticket.id}
                        data-testid={`ticket-${ticket.id}`}
                        onClick={() => setSelected(ticket)}
                        className={`w-full p-4 text-left transition-colors hover:bg-sp-cardh ${
                          selected?.id === ticket.id
                            ? "bg-sp-accent/10"
                            : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sp-bg">
                            <MessageSquare className="h-4 w-4 text-sp-accent" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="truncate text-sm font-semibold text-white">
                                {ticket.subject}
                              </div>

                              <ChevronRight className="h-4 w-4 shrink-0 text-sp-muted" />
                            </div>

                            <div className="mt-1 line-clamp-2 text-xs text-sp-sub">
                              {ticket.description}
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span
                                className={`flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10px] ${status.className}`}
                              >
                                <StatusIcon className="h-3 w-3" />
                                {status.label}
                              </span>

                              <span
                                className={`font-mono text-[10px] uppercase ${getPriorityClass(
                                  ticket.priority
                                )}`}
                              >
                                {ticket.priority || "medium"}
                              </span>

                              {getResponseCount(ticket) > 0 && (
                                <span className="font-mono text-[10px] text-sp-sub">
                                  {getResponseCount(ticket)}{" "}
                                  {getResponseCount(ticket) === 1
                                    ? "reply"
                                    : "replies"}
                                </span>
                              )}
                            </div>

                            <div className="mt-2 font-mono text-[10px] text-sp-muted">
                              {formatDate(ticket.created_at)}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* TICKET DETAILS */}
        <div className="lg:col-span-7">
          {!selected ? (
            <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-dashed border-sp-border bg-sp-card p-8 text-center">
              <div className="max-w-sm">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-sp-border bg-sp-bg">
                  <MessageSquare className="h-7 w-7 text-sp-muted" />
                </div>

                <h2 className="font-display text-xl font-bold text-white">
                  Select a ticket
                </h2>

                <p className="mt-2 text-sm leading-6 text-sp-sub">
                  Select a support ticket from the left to view its details
                  and conversation.
                </p>
              </div>
            </div>
          ) : (
            <TicketDetails
              ticket={selected}
              reply={reply}
              setReply={setReply}
              sending={sending}
              onSendReply={sendReply}
              formatDate={formatDate}
              getStatus={getStatus}
              getPriorityClass={getPriorityClass}
            />
          )}
        </div>
      </div>

      {/* CREATE TICKET MODAL */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowCreate(false);
            }
          }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-sp-border bg-sp-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-sp-border px-6 py-5">
              <div>
                <div className="font-display text-xl font-bold text-white">
                  Create Support Ticket
                </div>
                <div className="mt-1 text-xs text-sp-sub">
                  Tell us what you need help with.
                </div>
              </div>

              <button
                onClick={() => setShowCreate(false)}
                className="rounded-lg p-2 text-sp-sub transition-colors hover:bg-sp-bg hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={createTicket} className="space-y-5 p-6">
              <div>
                <label className="mb-2 block font-mono text-xs uppercase tracking-wider text-sp-sub">
                  Subject
                </label>

                <input
                  data-testid="ticket-subject-input"
                  value={form.subject}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      subject: event.target.value,
                    }))
                  }
                  placeholder="Example: Camera feed is not updating"
                  className="w-full rounded-lg border border-sp-border bg-sp-bg px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-sp-muted focus:border-sp-accent"
                />
              </div>

              <div>
                <label className="mb-2 block font-mono text-xs uppercase tracking-wider text-sp-sub">
                  Priority
                </label>

                <select
                  data-testid="ticket-priority-select"
                  value={form.priority}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      priority: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-sp-border bg-sp-bg px-4 py-3 text-sm text-white outline-none focus:border-sp-accent"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block font-mono text-xs uppercase tracking-wider text-sp-sub">
                  Description
                </label>

                <textarea
                  data-testid="ticket-description-input"
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  rows={6}
                  placeholder="Describe the problem, what you expected, and what happened..."
                  className="w-full resize-none rounded-lg border border-sp-border bg-sp-bg px-4 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-sp-muted focus:border-sp-accent"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreate(false)}
                  className="border-sp-border"
                >
                  Cancel
                </Button>

                <Button
                  data-testid="submit-ticket-btn"
                  type="submit"
                  disabled={creating}
                  className="bg-sp-accent text-sp-bg hover:bg-sky-400"
                >
                  {creating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Create Ticket
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------
   Ticket details
------------------------------------------------------- */

function TicketDetails({
  ticket,
  reply,
  setReply,
  sending,
  onSendReply,
  formatDate,
  getStatus,
  getPriorityClass,
}) {
  const status = getStatus(ticket.status);
  const StatusIcon = status.icon;

  return (
    <div className="overflow-hidden rounded-xl border border-sp-border bg-sp-card">
      {/* HEADER */}
      <div className="border-b border-sp-border p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-sp-accent">
                #{ticket.id?.slice(0, 8)}
              </span>

              <span
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[10px] ${status.className}`}
              >
                <StatusIcon className="h-3 w-3" />
                {status.label}
              </span>

              <span
                className={`font-mono text-[10px] uppercase ${getPriorityClass(
                  ticket.priority
                )}`}
              >
                {ticket.priority || "medium"} priority
              </span>
            </div>

            <h2 className="font-display text-2xl font-bold text-white">
              {ticket.subject}
            </h2>

            <p className="mt-2 text-xs text-sp-muted">
              Created {formatDate(ticket.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* DESCRIPTION */}
      <div className="border-b border-sp-border p-6">
        <div className="mb-2 font-mono text-xs uppercase tracking-widest text-sp-sub">
          Issue Description
        </div>

        <div className="rounded-lg border border-sp-border bg-sp-bg p-4 text-sm leading-7 text-sp-sub">
          {ticket.description}
        </div>
      </div>

      {/* CONVERSATION */}
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="font-mono text-xs uppercase tracking-widest text-sp-sub">
            Conversation
          </div>

          <span className="font-mono text-xs text-sp-muted">
            {Array.isArray(ticket.responses)
              ? ticket.responses.length
              : 0}{" "}
            replies
          </span>
        </div>

        <div className="space-y-3">
          {Array.isArray(ticket.responses) &&
          ticket.responses.length > 0 ? (
            ticket.responses.map((response, index) => {
              const isClient = response.role === "client";

              return (
                <div
                  key={`${response.at || "reply"}-${index}`}
                  className={`rounded-xl border p-4 ${
                    isClient
                      ? "ml-8 border-sp-accent/20 bg-sp-accent/5"
                      : "mr-8 border-sp-border bg-sp-bg"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full ${
                          isClient
                            ? "bg-sp-accent/15 text-sp-accent"
                            : "bg-sp-free/15 text-sp-free"
                        }`}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </div>

                      <span className="text-xs font-semibold text-white">
                        {isClient ? "You" : "EzySlot Support"}
                      </span>
                    </div>

                    <span className="font-mono text-[10px] text-sp-muted">
                      {formatDate(response.at)}
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-6 text-sp-sub">
                    {response.text}
                  </p>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-sp-border bg-sp-bg p-6 text-center">
              <MessageSquare className="mx-auto mb-2 h-5 w-5 text-sp-muted" />

              <p className="text-sm text-sp-sub">
                No replies yet. Our support team will respond here.
              </p>
            </div>
          )}
        </div>

        {/* REPLY BOX */}
        {ticket.status !== "resolved" && (
          <div className="mt-5">
            <div className="mb-2 font-mono text-xs uppercase tracking-widest text-sp-sub">
              Add Reply
            </div>

            <div className="rounded-xl border border-sp-border bg-sp-bg p-3">
              <textarea
                data-testid="ticket-reply-input"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={4}
                placeholder="Write a message to the EzySlot support team..."
                className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-white outline-none placeholder:text-sp-muted"
              />

              <div className="mt-2 flex justify-end">
                <Button
                  data-testid="send-ticket-reply-btn"
                  disabled={sending || !reply.trim()}
                  onClick={onSendReply}
                  className="bg-sp-accent text-sp-bg hover:bg-sky-400"
                >
                  {sending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Send Reply
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {ticket.status === "resolved" && (
          <div className="mt-5 flex items-center gap-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-4 py-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />

            <div>
              <div className="text-sm font-semibold text-emerald-400">
                Ticket Resolved
              </div>

              <div className="mt-0.5 text-xs text-sp-sub">
                This support request has been marked as resolved.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   Summary card
------------------------------------------------------- */

function SummaryCard({ label, value, icon }) {
  return (
    <div className="rounded-xl border border-sp-border bg-sp-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-widest text-sp-sub">
            {label}
          </div>

          <div className="mt-3 font-display text-3xl font-bold text-white">
            {value}
          </div>
        </div>

        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sp-accent/10 text-sp-accent">
          {icon}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------
   Empty state
------------------------------------------------------- */

function EmptyTickets({ onCreate }) {
  return (
    <div className="flex min-h-[380px] flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-sp-border bg-sp-bg">
        <Ticket className="h-7 w-7 text-sp-muted" />
      </div>

      <h3 className="font-display text-xl font-bold text-white">
        No support tickets
      </h3>

      <p className="mt-2 max-w-sm text-sm leading-6 text-sp-sub">
        You haven't created any support requests yet. If something isn't
        working, create a ticket and the EzySlot team will help you.
      </p>

      <Button
        data-testid="empty-new-ticket-btn"
        onClick={onCreate}
        className="mt-5 bg-sp-accent text-sp-bg hover:bg-sky-400"
      >
        <Plus className="mr-2 h-4 w-4" />
        Create Your First Ticket
      </Button>
    </div>
  );
}