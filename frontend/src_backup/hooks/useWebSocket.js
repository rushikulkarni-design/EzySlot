import { useEffect, useRef, useState, useCallback } from "react";
import { wsUrl } from "../lib/api";

export function useOccupancy(clientId) {
  const [occ, setOcc] = useState({}); // cameraId -> payload
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const retryRef = useRef(null);

  const connect = useCallback(() => {
    if (!clientId) return;
    try {
      const ws = new WebSocket(wsUrl(clientId));
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "occupancy") {
            setOcc((prev) => ({ ...prev, [msg.camera_id]: msg }));
          }
        } catch (err) {
          console.warn("WS message parse failed", err);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        retryRef.current = setTimeout(connect, 2500);
      };
      ws.onerror = () => ws.close();
    } catch {
      setConnected(false);
    }
  }, [clientId]);

  useEffect(() => {
    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [connect]);

  return { occ, connected };
}
