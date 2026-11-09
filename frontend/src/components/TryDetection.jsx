import React, { useEffect, useRef, useState } from "react";
import api, { fileUrl, apiErr } from "../lib/api";
import { Button } from "./ui/button";
import { UploadCloud, Loader2, Scan } from "lucide-react";
import { toast } from "sonner";

export default function TryDetection() {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [samples, setSamples] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    api.get("/public/demo-images").then((r) => setSamples(r.data.images)).catch(() => {});
  }, []);

  const runDetect = async (file) => {
    setLoading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/detect", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(data);
    } catch (e) {
      toast.error(apiErr(e));
    } finally { setLoading(false); }
  };

  const onFile = (file) => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    runDetect(file);
  };

  const applySample = async (url) => {
    setPreview(url);
    setLoading(true); setResult(null);
    try {
      const blob = await (await fetch(url)).blob();
      await runDetect(new File([blob], "sample.jpg", { type: blob.type || "image/jpeg" }));
    } catch { toast.error("Could not load sample"); setLoading(false); }
  };

  const shown = result?.annotated_url ? fileUrl(result.annotated_url) : preview;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <div onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
          data-testid="try-detection-dropzone"
          className="group relative flex aspect-video cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-sp-border bg-sp-card transition-colors hover:border-sp-accent">
          {shown ? (
            <img src={shown} alt="detection" className="absolute inset-0 h-full w-full object-contain" />
          ) : (
            <div className="text-center text-sp-sub">
              <UploadCloud className="mx-auto mb-3 h-10 w-10 text-sp-accent" />
              <p className="font-medium text-white">Drop a parking image or click to upload</p>
              <p className="text-xs">YOLOv8n runs live on CPU</p>
            </div>
          )}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-sp-bg/70">
              <div className="flex items-center gap-2 font-mono text-sp-accent">
                <Loader2 className="h-5 w-5 animate-spin" /> Running inference…
              </div>
            </div>
          )}
        </div>
        <input ref={inputRef} data-testid="try-detection-upload-input" type="file" accept="image/*"
          className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-widest text-sp-sub">Try a sample:</span>
          {samples.slice(0, 3).map((s, i) => (
            <button key={i} data-testid={`sample-image-${i}`} onClick={() => applySample(s)}
              className="h-10 w-16 overflow-hidden rounded border border-sp-border hover:border-sp-accent">
              <img src={s} alt="sample" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-sp-border bg-sp-card p-6">
        <div className="mb-4 flex items-center gap-2 font-display text-xl font-bold">
          <Scan className="h-5 w-5 text-sp-accent" /> Detection Result
        </div>
        {!result && !loading && <p className="text-sm text-sp-sub">Upload an image to see YOLOv8 detect vehicles in real time.</p>}
        {result && (
          <div data-testid="detection-result" className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[["Vehicles", result.counts.vehicles, "#38BDF8"], ["High conf", result.counts.high_conf, "#10B981"], ["Low conf", result.counts.low_conf, "#F59E0B"]].map(([k, v, c]) => (
                <div key={k} className="rounded-lg border border-sp-border bg-sp-bg p-3 text-center">
                  <div className="font-mono text-2xl font-bold" style={{ color: c }}>{v}</div>
                  <div className="text-xs text-sp-sub">{k}</div>
                </div>
              ))}
            </div>
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {result.detections.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-md bg-sp-bg px-3 py-1.5 font-mono text-xs">
                  <span className="capitalize text-white">{d.label}</span>
                  <span style={{ color: d.conf >= 0.4 ? "#10B981" : "#F59E0B" }}>{Math.round(d.conf * 100)}%</span>
                </div>
              ))}
              {result.detections.length === 0 && <p className="text-sm text-sp-sub">No vehicles detected in this image.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
