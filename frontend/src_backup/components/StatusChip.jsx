import React from "react";

const MAP = {
  FREE: { c: "#10B981", bg: "rgba(16,185,129,0.14)", glow: "glow-free", label: "FREE" },
  OCCUPIED: { c: "#EF4444", bg: "rgba(239,68,68,0.14)", glow: "glow-occ", label: "OCCUPIED" },
  UNKNOWN: { c: "#F59E0B", bg: "rgba(245,158,11,0.14)", glow: "glow-unk", label: "UNKNOWN" },
};

export function StatusChip({ status, count, testid }) {
  const m = MAP[status] || MAP.UNKNOWN;
  return (
    <div data-testid={testid}
      className="flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-sm font-medium"
      style={{ background: m.bg, color: m.c, border: `1px solid ${m.c}44` }}>
      <span className="h-2 w-2 rounded-full animate-pulse-ring" style={{ background: m.c }} />
      {count !== undefined && <span className="font-bold">{count}</span>}
      <span className="tracking-wider text-xs">{m.label}</span>
    </div>
  );
}

export const STATUS_COLORS = MAP;
export default StatusChip;
