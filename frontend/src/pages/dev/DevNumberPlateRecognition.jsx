
import React, { useCallback, useEffect, useState } from "react";
import {
  ScanLine,
  Upload,
  Image as ImageIcon,
  CarFront,
  ShieldCheck,
  Building2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  UserRound,
  Hash,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import api, { apiErr } from "../../lib/api";

export default function DevNumberPlateRecognition() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState(null);
  const [loadingClients, setLoadingClients] = useState(true);
  const [recognizing, setRecognizing] = useState(false);
  const [scanMode, setScanMode] = useState("full-frame");

  const loadClients = useCallback(async () => {
    setLoadingClients(true);

    try {
      const { data } = await api.get("/clients");
      const list = data.clients || [];

      setClients(list);
      setClientId((current) =>
        current && list.some((client) => client.id === current)
          ? current
          : list[0]?.id || ""
      );
    } catch (error) {
      toast.error(apiErr(error));
    } finally {
      setLoadingClients(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFileChange = (event) => {
    const selected = event.target.files?.[0];
    setResult(null);

    if (!selected) {
      setFile(null);
      return;
    }

    if (!selected.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      event.target.value = "";
      setFile(null);
      return;
    }

    if (selected.size > 10 * 1024 * 1024) {
      toast.error("Image size must be 10 MB or less.");
      event.target.value = "";
      setFile(null);
      return;
    }

    setFile(selected);
  };

  const recognizeVehicle = async (event) => {
    event.preventDefault();

    if (!clientId) {
      toast.error("Select a parking client first.");
      return;
    }

    if (!file) {
      toast.error("Upload an image first.");
      return;
    }

    setRecognizing(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const endpoint =
        scanMode === "full-frame"
          ? "/number-plate/detect-and-recognize"
          : "/number-plate/recognize";

      const { data } = await api.post(endpoint, formData, {
        params: { client_id: clientId },
      });

      setResult(data);

      if (scanMode === "full-frame") {
        const detections = data.results || data.detections || [];

        const matchCount = detections.filter((detection) => {
          const item =
            detection.recognition || detection.result || detection;

          return (
            item.registered === true ||
            item.vehicle?.registered === true
          );
        }).length;

        if (detections.length === 0) {
          toast.warning(
            data.message || "No number plates were detected."
          );
        } else {
          toast.success(
            `${detections.length} plate region(s) detected. ${matchCount} registered vehicle(s) matched.`
          );
        }
      } else if (data.registered) {
        toast.success("Registered vehicle matched.");
      } else {
        toast.warning(
          data.message || "No registered vehicle matched."
        );
      }
    } catch (error) {
      toast.error(apiErr(error));
    } finally {
      setRecognizing(false);
    }
  };

  const resetRecognition = () => {
    setFile(null);
    setResult(null);

    const input = document.getElementById("plate-image-input");
    if (input) input.value = "";
  };

  const selectedClient = clients.find(
    (client) => client.id === clientId
  );

  const classification = result?.classification || "Unknown";
  const matched = result?.registered === true;

  const statusStyle = matched
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    : "border-amber-500/30 bg-amber-500/10 text-amber-400";

  // The full-frame API returns its detections under "results".
  const detections =
    result?.results || result?.detections || [];

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm text-sp-muted">
          <ScanLine size={17} />
          <span>Developer / Vehicle Recognition</span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-sp-text sm:text-3xl">
          Number Plate Recognition
        </h1>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-sp-muted">
          Scan a full parking image to detect multiple plates, or
          upload a close-up plate image. Results are checked against
          the selected client's vehicle registry.
        </p>
      </div>

      <section className="rounded-2xl border border-sp-border bg-sp-card p-5">
        <label
          htmlFor="recognition-client"
          className="mb-3 flex items-center gap-2 text-sm font-semibold text-sp-text"
        >
          <Building2 size={17} />
          Select Parking Client
        </label>

        <div className="flex flex-col gap-3 sm:flex-row">
          <select
            id="recognition-client"
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              setResult(null);
            }}
            disabled={loadingClients}
            className="min-h-11 w-full rounded-xl border border-sp-border bg-sp-bg px-3 text-sm text-sp-text outline-none focus:border-sp-accent sm:max-w-lg"
          >
            <option value="">
              {loadingClients
                ? "Loading clients..."
                : "Select a client"}
            </option>

            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} — {client.site_location}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={loadClients}
            disabled={loadingClients}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sp-border px-4 text-sm font-medium text-sp-text hover:bg-sp-bg disabled:opacity-50"
          >
            <RefreshCw
              size={16}
              className={loadingClients ? "animate-spin" : ""}
            />
            Refresh
          </button>
        </div>

        {selectedClient && (
          <p className="mt-3 text-xs text-sp-muted">
            Recognition will check vehicles registered for{" "}
            <strong>{selectedClient.name}</strong>.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-sp-border bg-sp-card p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-sp-bg text-sp-accent">
              <Upload size={21} />
            </div>

            <div>
              <h2 className="font-bold text-sp-text">
                Upload Plate Image
              </h2>
              <p className="mt-1 text-xs text-sp-muted">
                PNG, JPG, or WebP · Maximum 10 MB
              </p>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setScanMode("full-frame");
                setResult(null);
              }}
              className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                scanMode === "full-frame"
                  ? "border-sp-accent bg-sp-accent/10 text-sp-text"
                  : "border-sp-border text-sp-muted hover:bg-sp-bg"
              }`}
            >
              <span className="block font-semibold">
                Full Parking Image
              </span>
              <span className="mt-1 block text-xs">
                Detect multiple plates automatically
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setScanMode("close-up");
                setResult(null);
              }}
              className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                scanMode === "close-up"
                  ? "border-sp-accent bg-sp-accent/10 text-sp-text"
                  : "border-sp-border text-sp-muted hover:bg-sp-bg"
              }`}
            >
              <span className="block font-semibold">
                Plate Close-up
              </span>
              <span className="mt-1 block text-xs">
                Recognize one clear plate image
              </span>
            </button>
          </div>

          <form onSubmit={recognizeVehicle} className="space-y-5">
            <label
              htmlFor="plate-image-input"
              className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-sp-border bg-sp-bg/50 p-5 text-center transition hover:border-sp-accent"
            >
              {preview ? (
                <img
                  src={preview}
                  alt="Selected parking or number plate image"
                  className="max-h-64 max-w-full rounded-lg object-contain"
                />
              ) : (
                <>
                  <ImageIcon
                    size={35}
                    className="mb-3 text-sp-muted"
                  />
                  <span className="text-sm font-semibold text-sp-text">
                    Choose an image to upload
                  </span>
                  <span className="mt-2 text-xs text-sp-muted">
                    {scanMode === "full-frame"
                      ? "Upload a parking image containing visible vehicles"
                      : "Use a clear, close-up view of the number plate"}
                  </span>
                </>
              )}

              <input
                id="plate-image-input"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>

            {file && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-sp-bg p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-sp-text">
                    {file.name}
                  </p>
                  <p className="mt-1 text-xs text-sp-muted">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>

                <button
                  type="button"
                  onClick={resetRecognition}
                  className="rounded-lg p-2 text-sp-muted hover:bg-sp-card hover:text-sp-text"
                  aria-label="Remove image and reset result"
                >
                  <RotateCcw size={17} />
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={!file || !clientId || recognizing}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sp-accent px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {recognizing ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Recognizing Vehicle...
                </>
              ) : (
                <>
                  <ScanLine size={18} />
                  Recognize Vehicle
                </>
              )}
            </button>
          </form>

          <p className="mt-4 text-xs leading-5 text-sp-muted">
            {scanMode === "full-frame"
              ? "Full-frame mode detects plate regions first, then sends each crop through the existing OCR and registry matching workflow."
              : "Close-up mode sends the selected plate image directly to the existing OCR workflow."}
          </p>
        </section>

        <section className="rounded-2xl border border-sp-border bg-sp-card p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-sp-bg text-sp-accent">
              <ShieldCheck size={21} />
            </div>

            <div>
              <h2 className="font-bold text-sp-text">
                Recognition Result
              </h2>
              <p className="mt-1 text-xs text-sp-muted">
                OCR output and vehicle registry match
              </p>
            </div>
          </div>

          {!result ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-sp-border bg-sp-bg/40 p-6 text-center">
              <ScanLine
                size={38}
                className="mb-3 text-sp-muted"
              />
              <h3 className="font-semibold text-sp-text">
                No result yet
              </h3>
              <p className="mt-2 max-w-xs text-sm leading-6 text-sp-muted">
                Select a client, upload an image, and click Recognize
                Vehicle to see the result here.
              </p>
            </div>
          ) : scanMode === "full-frame" ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-sp-border bg-sp-bg p-4">
                <p className="text-sm font-semibold text-sp-text">
                  Plate Detection Summary
                </p>
                <p className="mt-1 text-sm text-sp-muted">
                  {result.plates_detected ?? detections.length}{" "}
                  plate region(s) detected in this image.
                </p>
                {result.message && (
                  <p className="mt-1 text-xs text-sp-muted">
                    {result.message}
                  </p>
                )}
              </div>

              {detections.length === 0 ? (
                <p className="rounded-xl border border-sp-border p-4 text-sm text-sp-muted">
                  No plates were detected. Try a higher-resolution
                  image with visible vehicle plates.
                </p>
              ) : (
                detections.map((detection, index) => {
                  // Backend response: detection.recognition contains
                  // the OCR and registry result for each detected plate.
                  const item =
                    detection.recognition ||
                    detection.result ||
                    detection;

                  const isMatched = item.registered === true;
                  const plateNumber =
                    item.plate_number || item.text || "";

                  return (
                    <div
                      key={`${index}-${detection.plate_index || ""}-${
                        detection.box?.join("-") || "plate"
                      }`}
                      className="rounded-xl border border-sp-border bg-sp-bg p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs text-sp-muted">
                            Plate {detection.plate_index || index + 1}
                          </p>
                          <p className="mt-1 break-all text-xl font-extrabold tracking-wider text-sp-text">
                            {plateNumber || "Not recognized"}
                          </p>
                        </div>

                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            isMatched
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                          }`}
                        >
                          {isMatched
                            ? item.classification || "Registered"
                            : "Unknown"}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-sp-muted">
                        <p>
                          OCR confidence:{" "}
                          {typeof item.confidence === "number"
                            ? `${(item.confidence * 100).toFixed(1)}%`
                            : "—"}
                        </p>
                        <p>
                          Detection confidence:{" "}
                          {typeof detection.detection_confidence ===
                          "number"
                            ? `${(
                                detection.detection_confidence * 100
                              ).toFixed(1)}%`
                            : typeof detection.confidence === "number"
                              ? `${(
                                  detection.confidence * 100
                                ).toFixed(1)}%`
                              : "—"}
                        </p>
                      </div>

                      {item.vehicle && (
                        <div className="mt-3 space-y-2 rounded-lg border border-sp-border p-3">
                          <ResultRow
                            icon={UserRound}
                            label="Owner"
                            value={
                              item.vehicle.owner_name || "Not provided"
                            }
                          />
                          <ResultRow
                            icon={CarFront}
                            label="Vehicle Type"
                            value={
                              item.vehicle.vehicle_type || "Not provided"
                            }
                          />
                          <ResultRow
                            icon={ShieldCheck}
                            label="Category"
                            value={
                              item.vehicle.category ||
                              item.classification ||
                              "Unknown"
                            }
                          />
                        </div>
                      )}

                      {item.message && (
                        <p className="mt-3 text-xs leading-5 text-sp-muted">
                          {item.message}
                        </p>
                      )}

                      {!plateNumber && item.success === false && (
                        <p className="mt-2 text-xs text-amber-400">
                          The plate region was detected, but OCR could
                          not recognize its number.
                        </p>
                      )}
                    </div>
                  );
                })
              )}

              <button
                type="button"
                onClick={resetRecognition}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-sp-border px-4 text-sm font-semibold text-sp-text hover:bg-sp-bg"
              >
                <RotateCcw size={16} />
                Scan Another Image
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-sp-border bg-sp-bg p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-sp-muted">
                  Detected Number Plate
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sp-card text-sp-accent">
                    <Hash size={21} />
                  </div>
                  <p className="break-all text-2xl font-extrabold tracking-wider text-sp-text sm:text-3xl">
                    {result.plate_number || "Not detected"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-sp-border p-4">
                  <p className="text-xs text-sp-muted">
                    OCR Confidence
                  </p>
                  <p className="mt-2 text-2xl font-bold text-sp-text">
                    {typeof result.confidence === "number"
                      ? `${(result.confidence * 100).toFixed(1)}%`
                      : "—"}
                  </p>
                </div>

                <div className="rounded-xl border border-sp-border p-4">
                  <p className="text-xs text-sp-muted">
                    Registration
                  </p>
                  <p className="mt-2 text-lg font-bold text-sp-text">
                    {matched ? "Matched" : "Not matched"}
                  </p>
                </div>
              </div>

              <div
                className={`flex items-center gap-3 rounded-xl border p-4 ${statusStyle}`}
              >
                {matched ? (
                  <CheckCircle2 size={24} className="shrink-0" />
                ) : (
                  <AlertTriangle size={24} className="shrink-0" />
                )}
                <div>
                  <p className="text-xs font-medium opacity-80">
                    Vehicle Classification
                  </p>
                  <p className="mt-1 text-xl font-bold">
                    {classification}
                  </p>
                </div>
              </div>

              {matched && result.vehicle && (
                <div className="space-y-3 rounded-xl border border-sp-border p-4">
                  <h3 className="text-sm font-semibold text-sp-text">
                    Registered Vehicle Details
                  </h3>

                  <ResultRow
                    icon={UserRound}
                    label="Owner"
                    value={
                      result.vehicle.owner_name || "Not provided"
                    }
                  />

                  <ResultRow
                    icon={CarFront}
                    label="Vehicle Type"
                    value={
                      result.vehicle.vehicle_type || "Not provided"
                    }
                  />

                  <ResultRow
                    icon={ShieldCheck}
                    label="Category"
                    value={
                      result.vehicle.category || classification
                    }
                  />
                </div>
              )}

              <div className="flex items-start gap-2 rounded-lg bg-sp-bg p-3">
                {matched ? (
                  <CheckCircle2
                    size={17}
                    className="mt-0.5 shrink-0 text-emerald-400"
                  />
                ) : (
                  <XCircle
                    size={17}
                    className="mt-0.5 shrink-0 text-amber-400"
                  />
                )}
                <p className="text-sm leading-5 text-sp-muted">
                  {result.message ||
                    (matched
                      ? "Registered vehicle matched."
                      : "No matching vehicle was found.")}
                </p>
              </div>

              <button
                type="button"
                onClick={resetRecognition}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-sp-border px-4 text-sm font-semibold text-sp-text hover:bg-sp-bg"
              >
                <RotateCcw size={16} />
                Recognize Another Vehicle
              </button>
            </div>
          )}
        </section>
      </div>

      <p className="text-xs leading-5 text-sp-muted">
        OCR can misread characters. Verify the plate against the actual
        image before using a recognition result for any physical access
        decision.
      </p>
    </div>
  );
}

function ResultRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-sm text-sp-muted">
        <Icon size={15} />
        {label}
      </span>
      <span className="text-right text-sm font-medium capitalize text-sp-text">
        {String(value).replaceAll("-", " ")}
      </span>
    </div>
  );
}
