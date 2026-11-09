import React from "react";
import { STATUS_COLORS } from "./StatusChip";

function centroid(poly) {
  const x = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const y = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  return [x, y];
}

// Renders a camera background with normalized slot polygons + vehicle boxes overlaid.
export default function SlotCanvas({ imageUrl, slots = [], detections = [], showBoxes = true, testid }) {
  return (
    <div data-testid={testid} className="relative w-full overflow-hidden rounded-xl border border-sp-border bg-sp-card scanlines"
      style={{ aspectRatio: "16 / 9" }}>
      {imageUrl ? (
        <img src={imageUrl} alt="camera feed" className="absolute inset-0 h-full w-full object-cover opacity-70" />
      ) : (
        <div className="absolute inset-0 grid-bg" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {slots.map((s) => {
          const st = STATUS_COLORS[s.status] || STATUS_COLORS.UNKNOWN;
          const pts = s.polygon.map((p) => `${p[0] * 100},${p[1] * 100}`).join(" ");
          return (
            <g key={s.slot_id || s.id}>
              <polygon points={pts} fill={st.bg} stroke={st.c} strokeWidth="0.4"
                style={{ transition: "fill 0.5s, stroke 0.5s" }} />
              {showBoxes && s.box && s.status === "OCCUPIED" && (
                <rect x={s.box[0] * 100} y={s.box[1] * 100}
                  width={(s.box[2] - s.box[0]) * 100} height={(s.box[3] - s.box[1]) * 100}
                  fill="none" stroke="#06B6D4" strokeWidth="0.3" strokeDasharray="1.2 0.8" />
              )}
            </g>
          );
        })}
        {showBoxes && detections.map((d, i) => {
          const b = d.nbox;
          if (!b) return null;
          return (
            <rect key={"det" + i} x={b[0] * 100} y={b[1] * 100}
              width={(b[2] - b[0]) * 100} height={(b[3] - b[1]) * 100}
              fill="none" stroke="#06B6D4" strokeWidth="0.35"
              style={{ filter: "drop-shadow(0 0 2px rgba(6,182,212,0.8))" }} />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0">
        {slots.map((s) => {
          const [cx, cy] = centroid(s.polygon);
          const st = STATUS_COLORS[s.status] || STATUS_COLORS.UNKNOWN;
          return (
            <div key={(s.slot_id || s.id) + "-lbl"}
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
              style={{ left: `${cx * 100}%`, top: `${cy * 100}%`, color: st.c, background: "rgba(7,9,14,0.65)", border: `1px solid ${st.c}55` }}>
              {s.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
