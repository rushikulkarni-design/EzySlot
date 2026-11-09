import React, { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useOccupancy } from "../../hooks/useWebSocket";
import api, { fileUrl } from "../../lib/api";
import SlotCanvas from "../../components/SlotCanvas";
import StatusChip from "../../components/StatusChip";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import {
  Video,
  VideoOff,
  Camera,
  MapPin,
  Loader2,
  Wifi,
  WifiOff,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Car,
  Activity,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

export default function ClientLive() {
  const { user } = useAuth();
  const clientId = user?.client_id;
  const { occ, connected } = useOccupancy(clientId);

  const [cameras, setCameras] = useState(null);
  const [active, setActive] = useState(null);
  const [webcam, setWebcam] = useState(false);
  const videoRef = React.useRef(null);
  const streamRef = React.useRef(null);

  const [clip, setClip] = useState(null);
  const [clipIdx, setClipIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [plateScanning, setPlateScanning] = useState(false);
  const [plateScanResult, setPlateScanResult] = useState(null);
  const [plateScanError, setPlateScanError] = useState("");
  const [testImage, setTestImage] = useState(null);
  const [testImageUrl, setTestImageUrl] = useState("");

  // RTSP feed state
  const [rtspFrameUrl, setRtspFrameUrl] = useState("");
  const [rtspStatus, setRtspStatus] = useState("connecting");

  /* LOAD CAMERAS */
  useEffect(() => {
    if (!clientId) return;

    api
      .get("/cameras", { params: { client_id: clientId } })
      .then((r) => {
        const list = r.data?.cameras || [];
        setCameras(list);
        if (list.length > 0) setActive(list[0].id);
      })
      .catch(() => {
        toast.error("Unable to load cameras");
        setCameras([]);
      });
  }, [clientId]);

  /* WEBCAM */
  useEffect(() => {
    if (webcam) {
      navigator.mediaDevices
        ?.getUserMedia({ video: true })
        .then((stream) => {
          streamRef.current = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
        })
        .catch(() => {
          toast.error("Webcam access denied");
          setWebcam(false);
        });
    } else if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [webcam]);

  /* LOAD YOLO CLIP */
  useEffect(() => {
    const camera = cameras?.find((x) => x.id === active);

    if (camera?.clip_ready) {
      api
        .get(`/cameras/${active}/clip`)
        .then((r) => {
          if (r.data?.clip && r.data?.frames?.length) {
            setClip(r.data.frames);
            setClipIdx(0);
            setPlaying(true);
          } else {
            setClip(null);
          }
        })
        .catch(() => setClip(null));
    } else {
      setClip(null);
    }
  }, [active, cameras]);

  /* CLIP PLAYBACK */
  useEffect(() => {
    if (!clip || !playing) return;

    const timer = setInterval(() => {
      setClipIdx((index) => (index + 1) % clip.length);
    }, 1500);

    return () => clearInterval(timer);
  }, [clip, playing]);

  /* REAL RTSP CAMERA FRAME POLLING */
  useEffect(() => {
    if (!active || webcam || clip) {
      setRtspFrameUrl("");
      setRtspStatus("connecting");
      return;
    }

    let cancelled = false;
    let timer = null;
    let currentObjectUrl = null;

    setRtspFrameUrl("");
    setRtspStatus("connecting");

    const fetchFrame = async () => {
      try {
        const response = await api.get(
          `/cameras/${active}/rtsp-frame`,
          { responseType: "blob" }
        );

        if (cancelled) return;

        if (
          !response.data ||
          !response.data.type?.startsWith("image/")
        ) {
          throw new Error("RTSP endpoint did not return an image.");
        }

        const nextObjectUrl = URL.createObjectURL(response.data);

        if (currentObjectUrl) {
          URL.revokeObjectURL(currentObjectUrl);
        }

        currentObjectUrl = nextObjectUrl;
        setRtspFrameUrl(nextObjectUrl);
        setRtspStatus("live");
      } catch {
        if (!cancelled) setRtspStatus("waiting");
      } finally {
        if (!cancelled) {
          timer = setTimeout(fetchFrame, 800);
        }
      }
    };

    fetchFrame();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [active, webcam, clip]);

  /* TEST IMAGE PREVIEW */
  useEffect(() => {
    if (!testImage) {
      setTestImageUrl("");
      return;
    }

    const url = URL.createObjectURL(testImage);
    setTestImageUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [testImage]);

  const handleTestImageChange = (event) => {
    const selected = event.target.files?.[0];
    setPlateScanResult(null);
    setPlateScanError("");

    if (!selected) {
      setTestImage(null);
      return;
    }

    if (!selected.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      event.target.value = "";
      setTestImage(null);
      return;
    }

    if (selected.size > 10 * 1024 * 1024) {
      toast.error("Image must be 10 MB or smaller.");
      event.target.value = "";
      setTestImage(null);
      return;
    }

    setTestImage(selected);
    toast.success("Test image loaded. Click Scan Number Plates to analyze it.");
  };

  /* NUMBER PLATE SCAN */
  const scanCurrentFrame = async () => {
    if (!clientId) {
      toast.error("Your client account is not linked to a parking site.");
      return;
    }

    setPlateScanning(true);
    setPlateScanError("");
    setPlateScanResult(null);

    try {
      let imageBlob;

      // A manually selected test image has priority.
      if (testImage) {
        imageBlob = testImage;
      } else if (
        webcam &&
        videoRef.current &&
        videoRef.current.videoWidth > 0
      ) {
        const video = videoRef.current;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const context = canvas.getContext("2d");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        imageBlob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            (blob) =>
              blob
                ? resolve(blob)
                : reject(new Error("Could not capture webcam frame.")),
            "image/jpeg",
            0.92
          );
        });
      } else if (!isClip && rtspStatus === "live") {
        // Capture a fresh frame from the real camera.
        const response = await api.get(
          `/cameras/${active}/rtsp-frame`,
          { responseType: "blob" }
        );
        imageBlob = response.data;
      } else {
        const imagePath = live?.frame_url || cam?.snapshot;

        if (!imagePath) {
          throw new Error(
            "No camera snapshot is available. Select a camera with an image or enable Webcam."
          );
        }

        const response = await api.get(fileUrl(imagePath), {
          responseType: "blob",
        });
        imageBlob = response.data;
      }

      if (!imageBlob || !imageBlob.type.startsWith("image/")) {
        throw new Error("The current feed did not provide a valid image.");
      }

      const formData = new FormData();
      const uploadName =
        testImage?.name || `parking-frame-${Date.now()}.jpg`;

      formData.append("file", imageBlob, uploadName);

      const { data } = await api.post(
        "/number-plate/detect-and-recognize",
        formData,
        { params: { client_id: clientId } }
      );

      setPlateScanResult(data);

      const results = Array.isArray(data.results) ? data.results : [];
      const registeredCount = results.filter(
        (item) => item?.recognition?.registered === true
      ).length;

      if (registeredCount) {
        toast.success(
          `Scan complete: ${results.length} plate(s), ${registeredCount} registered.`
        );
      } else if (results.length) {
        toast.warning(
          `Scan complete: ${results.length} plate(s) detected; none matched registered vehicles.`
        );
      } else {
        toast.info(data.message || "No number plates detected in this frame.");
      }
    } catch (error) {
      const detail = error?.response?.data?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : error?.message || "Number-plate scan failed.";

      setPlateScanError(message);
      toast.error(message);
    } finally {
      setPlateScanning(false);
    }
  };

    /* LOADING */
  if (cameras === null) {
    return (
      <Center>
        <Loader2 className="h-6 w-6 animate-spin text-sp-accent" />
      </Center>
    );
  }

  if (cameras.length === 0) {
    return (
      <Center>
        <p className="text-sp-sub">No cameras provisioned yet.</p>
      </Center>
    );
  }

  /* ACTIVE CAMERA */
  const cam = cameras.find((c) => c.id === active);
  const wsLive = occ?.[active];

  const clipFrame = clip
    ? clip[Math.min(clipIdx, clip.length - 1)]
    : null;

  const isClip = !!clipFrame;
  const live = clipFrame || wsLive;
  const slots = live?.slots || [];

  /* SLOT DETAILS */
  const occupiedSlots = slots
    .filter((slot) => slot.status === "OCCUPIED")
    .sort((a, b) => {
      const aNum = Number(String(a.id || "").replace(/\D/g, "")) || 0;
      const bNum = Number(String(b.id || "").replace(/\D/g, "")) || 0;
      return aNum - bNum;
    });

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* LEFT SIDE */}
      <div className="lg:col-span-8">
        {/* HEADER */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-display text-xl font-bold">
            <Camera className="h-5 w-5 text-sp-accent" />
            {cam?.name}

            {rtspStatus === "live" && !isClip && !webcam ? (
              <span
                data-testid="feed-source-badge"
                className="rounded-full border border-sp-free/40 bg-sp-free/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-sp-free"
              >
                Real RTSP
              </span>
            ) : live?.source === "clip" || live?.source === "yolo" ? (
              <span
                data-testid="feed-source-badge"
                className="rounded-full border border-sp-free/40 bg-sp-free/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-sp-free"
              >
                Real YOLO
              </span>
            ) : (
              <span
                data-testid="feed-source-badge"
                className="rounded-full border border-sp-unk/40 bg-sp-unk/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-sp-unk"
              >
                Simulated
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span
              data-testid="ws-status"
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs ${
                isClip
                  ? "border-sp-accent/40 text-sp-accent"
                  : rtspStatus === "live"
                    ? "border-sp-free/40 text-sp-free"
                    : connected
                      ? "border-sp-free/40 text-sp-free"
                      : "border-sp-unk/40 text-sp-unk"
              }`}
            >
              {isClip ? (
                <Play className="h-3.5 w-3.5" />
              ) : rtspStatus === "live" || connected ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}

              {isClip
                ? "PLAYBACK"
                : rtspStatus === "live"
                  ? "RTSP LIVE"
                  : connected
                    ? "LIVE"
                    : "RECONNECT"}
            </span>

            <div className="flex items-center gap-2">
              {webcam ? (
                <Video className="h-4 w-4 text-sp-accent" />
              ) : (
                <VideoOff className="h-4 w-4 text-sp-sub" />
              )}

              <Switch
                data-testid="webcam-toggle"
                checked={webcam}
                onCheckedChange={setWebcam}
              />

              <span className="text-xs text-sp-sub">Webcam</span>
            </div>
          </div>
        </div>

        {/* CAMERA IMAGE */}
        {webcam ? (
          <div
            className="relative overflow-hidden rounded-xl border border-sp-accent/50 bg-black"
            style={{ aspectRatio: "16/9" }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-contain"
            />

            <div className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 font-mono text-xs text-sp-accent">
              LIVE WEBCAM
            </div>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-xl border border-sp-border bg-black">
            <SlotCanvas
              testid="live-slot-canvas"
              imageUrl={
                !isClip && rtspFrameUrl
                  ? rtspFrameUrl
                  : live?.frame_url
                    ? fileUrl(live.frame_url)
                    : fileUrl(cam?.snapshot)
              }
              slots={slots}
              detections={live?.detections || []}
            />

            <div
              className={`absolute left-3 top-3 rounded px-3 py-1 font-mono text-xs ${
                isClip
                  ? "bg-black/75 text-white"
                  : rtspStatus === "live"
                    ? "bg-emerald-500/90 text-black"
                    : "bg-black/75 text-white"
              }`}
            >
              {isClip
                ? "CLIP PLAYBACK"
                : rtspStatus === "live"
                  ? "● REAL RTSP CAMERA"
                  : rtspStatus === "waiting"
                    ? "Waiting for camera frames..."
                    : "Connecting to camera..."}
            </div>
          </div>
        )}

        {/* CLIP CONTROLS */}
        {isClip && !webcam && (
          <div
            data-testid="clip-playback-controls"
            className="mt-3 flex items-center gap-3 rounded-lg border border-sp-border bg-sp-card px-4 py-3"
          >
            <Button
              data-testid="clip-prev-btn"
              size="icon"
              variant="outline"
              className="h-8 w-8 border-sp-border"
              onClick={() => {
                setPlaying(false);
                setClipIdx((i) => (i - 1 + clip.length) % clip.length);
              }}
            >
              <SkipBack className="h-4 w-4" />
            </Button>

            <Button
              data-testid="clip-playpause-btn"
              size="icon"
              className="h-9 w-9 bg-sp-accent text-sp-bg hover:bg-sky-400"
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>

            <Button
              data-testid="clip-next-btn"
              size="icon"
              variant="outline"
              className="h-8 w-8 border-sp-border"
              onClick={() => {
                setPlaying(false);
                setClipIdx((i) => (i + 1) % clip.length);
              }}
            >
              <SkipForward className="h-4 w-4" />
            </Button>

            <input
              data-testid="clip-scrubber"
              type="range"
              min={0}
              max={clip.length - 1}
              value={clipIdx}
              onChange={(e) => {
                setPlaying(false);
                setClipIdx(Number(e.target.value));
              }}
              className="flex-1 accent-sky-400"
            />

            <span className="w-14 text-right font-mono text-xs text-sp-sub">
              {clipIdx + 1}/{clip.length}
            </span>
          </div>
        )}

        {/* NEAREST FREE */}
        {live?.nearest_free && (
          <div
            data-testid="nearest-free-slot-banner"
            className="mt-4 flex items-center gap-2 rounded-lg border border-sp-free/40 bg-sp-free/10 px-4 py-3 glow-free"
          >
            <MapPin className="h-4 w-4 text-sp-free" />
            <span className="text-sm">
              Nearest free slot:{" "}
              <span className="font-mono font-bold text-sp-free">
                {live.nearest_free}
              </span>
            </span>
          </div>
        )}

                {/* DETECTION DETAILS */}
        <div className="mt-4 rounded-xl border border-sp-border bg-sp-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-sp-accent" />
              <div className="font-mono text-xs uppercase tracking-widest text-sp-sub">
                YOLO Detection Details
              </div>
            </div>
            <span className="rounded-full border border-sp-border px-2 py-1 font-mono text-[10px] text-sp-sub">
              {occupiedSlots.length} detected
            </span>
          </div>

          {occupiedSlots.length === 0 ? (
            <div className="rounded-lg border border-sp-free/30 bg-sp-free/5 px-4 py-4 text-center text-sm text-sp-free">
              No occupied slots detected.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {occupiedSlots.map((slot) => {
                const confidence = Number(
                  slot.conf || slot.confidence || 0
                );
                const vehicle =
                  slot.vehicle || slot.vehicle_type || "Vehicle";

                return (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between rounded-lg border border-sp-border bg-sp-bg/60 px-3 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-sp-accent/10">
                        <Car className="h-4 w-4 text-sp-accent" />
                      </div>
                      <div>
                        <div className="font-mono text-sm font-bold text-white">
                          {slot.id}
                        </div>
                        <div className="text-xs capitalize text-sp-sub">
                          {vehicle}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-sp-free">
                        {confidence
                          ? `${Math.round(confidence * 100)}%`
                          : "—"}
                      </div>
                      <div className="text-[10px] uppercase text-sp-sub">
                        confidence
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* NUMBER PLATE RECOGNITION */}
        <section className="mt-4 rounded-xl border border-sp-border bg-sp-card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-sp-sub">
                <ScanLine className="h-4 w-4 text-sp-accent" />
                Number Plate Recognition
              </div>
              <p className="mt-2 text-sm text-sp-sub">
                Load a test parking image or scan a snapshot of the selected camera/webcam. Results are saved to Plate Scan History.
              </p>
            </div>

            <Button
              data-testid="scan-number-plates-btn"
              onClick={scanCurrentFrame}
              disabled={plateScanning}
              className="shrink-0 bg-sp-accent text-sp-bg hover:bg-sky-400"
            >
              {plateScanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning frame...
                </>
              ) : (
                <>
                  <ScanLine className="mr-2 h-4 w-4" />
                  Scan current frame
                </>
              )}
            </Button>
          </div>

          <div className="mt-4 rounded-lg border border-dashed border-sp-border bg-sp-bg/50 p-3">
            <label
              htmlFor="live-plate-test-image"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-sp-border px-4 py-3 text-sm font-medium text-sp-text hover:border-sp-accent hover:bg-sp-card"
            >
              <Upload className="h-4 w-4 text-sp-accent" />
              {testImage ? "Choose a different test image" : "Load Test Image"}
              <input
                id="live-plate-test-image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleTestImageChange}
                className="sr-only"
              />
            </label>

            {testImage && (
              <div className="mt-3 space-y-2">
                {testImageUrl && (
                  <img
                    src={testImageUrl}
                    alt="Selected test parking frame"
                    className="max-h-64 w-full rounded-lg border border-sp-border object-contain"
                  />
                )}
                <div className="flex items-center justify-between gap-2 text-xs text-sp-sub">
                  <span className="min-w-0 truncate">
                    Test image: {testImage.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTestImage(null);
                      setPlateScanResult(null);
                    }}
                    className="inline-flex shrink-0 items-center gap-1 text-sp-accent hover:underline"
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            )}

            <p className="mt-2 text-xs text-sp-sub">
              A selected test image is used instead of the current camera frame.
            </p>
          </div>

          {plateScanError && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{plateScanError}</span>
            </div>
          )}

          {plateScanResult && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-sp-bg p-3">
                  <div className="text-xs text-sp-sub">Plates detected</div>
                  <div className="mt-1 text-2xl font-bold text-white">
                    {plateScanResult.plates_detected ??
                      plateScanResult.results?.length ??
                      0}
                  </div>
                </div>

                <div className="rounded-lg bg-sp-bg p-3">
                  <div className="text-xs text-sp-sub">Registered</div>
                  <div className="mt-1 text-2xl font-bold text-emerald-400">
                    {(plateScanResult.results || []).filter(
                      (item) => item?.recognition?.registered === true
                    ).length}
                  </div>
                </div>

                <div className="rounded-lg bg-sp-bg p-3">
                  <div className="text-xs text-sp-sub">Unknown</div>
                  <div className="mt-1 text-2xl font-bold text-amber-400">
                    {(plateScanResult.results || []).filter(
                      (item) =>
                        item?.recognition?.success &&
                        item?.recognition?.registered !== true
                    ).length}
                  </div>
                </div>
              </div>

              {(plateScanResult.results || []).length === 0 ? (
                <div className="rounded-lg border border-sp-border p-4 text-sm text-sp-sub">
                  No number plates were found in this frame. Try a clearer image or a closer camera view.
                </div>
              ) : (
                <div className="space-y-2">
                  {(plateScanResult.results || []).map((item) => {
                    const recognition = item?.recognition || {};
                    const registered = recognition.registered === true;
                    const plate =
                      recognition.plate_number ||
                      recognition.raw_plate_number ||
                      "Plate not read";

                    return (
                      <div
                        key={`${plate}-${item.plate_index}`}
                        className="flex flex-col gap-3 rounded-lg border border-sp-border bg-sp-bg/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-base font-bold text-white">
                            {plate}
                          </div>
                          <div className="mt-1 text-xs text-sp-sub">
                            Plate #{item.plate_index} · OCR{" "}
                            {Math.round(Number(recognition.confidence || 0) * 100)}%
                            {" "}· Detection{" "}
                            {Math.round(Number(item.detection_confidence || 0) * 100)}%
                          </div>

                          {recognition.vehicle?.owner_name && (
                            <div className="mt-1 text-xs text-sp-sub">
                              {recognition.vehicle.owner_name} ·{" "}
                              {recognition.vehicle.vehicle_type || "Vehicle"}
                            </div>
                          )}

                          {recognition.message && (
                            <div className="mt-1 text-xs text-sp-sub">
                              {recognition.message}
                            </div>
                          )}
                        </div>

                        <span
                          className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            registered
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-400"
                          }`}
                        >
                          {registered ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          {registered
                            ? recognition.classification || "Registered"
                            : "Unknown"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {plateScanResult.scan_id && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-sp-sub">
                  <Clock className="h-3.5 w-3.5" />
                  Scan saved to history · ID {plateScanResult.scan_id}
                  <button
                    type="button"
                    className="ml-auto text-sp-accent underline underline-offset-4"
                    onClick={() => {
                      window.location.href = "/ops/number-plate-history";
                    }}
                  >
                    View scan history
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

            {/* RIGHT SIDE */}
      <div className="space-y-4 lg:col-span-4">
        {/* LIVE OCCUPANCY */}
        <div className="rounded-xl border border-sp-border bg-sp-card p-5">
          <div className="mb-3 font-mono text-xs uppercase tracking-widest text-sp-sub">
            Live Occupancy
          </div>

          <div className="grid grid-cols-3 gap-2">
            <StatusChip
              testid="free-slots-count-chip"
              status="FREE"
              count={live?.free ?? 0}
            />
            <StatusChip
              testid="occupied-slots-count-chip"
              status="OCCUPIED"
              count={live?.occupied ?? 0}
            />
            <StatusChip
              testid="unknown-slots-count-chip"
              status="UNKNOWN"
              count={live?.unknown ?? 0}
            />
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-sp-bg">
            <div className="flex h-full">
              <div
                style={{
                  width: `${pct(live?.free, live?.total)}%`,
                  background: "#10B981",
                }}
              />
              <div
                style={{
                  width: `${pct(live?.occupied, live?.total)}%`,
                  background: "#EF4444",
                }}
              />
              <div
                style={{
                  width: `${pct(live?.unknown, live?.total)}%`,
                  background: "#F59E0B",
                }}
              />
            </div>
          </div>

          <div className="mt-2 text-center font-mono text-xs text-sp-sub">
            {live?.total ?? 0} total slots
          </div>
        </div>

        {/* CAMERAS */}
        <div className="rounded-xl border border-sp-border bg-sp-card p-5">
          <div className="mb-3 font-mono text-xs uppercase tracking-widest text-sp-sub">
            Cameras
          </div>

          <div className="space-y-2">
            {cameras.map((c) => {
              const o = occ?.[c.id];

              return (
                <button
                  key={c.id}
                  data-testid={`camera-switcher-btn-${c.id}`}
                  onClick={() => setActive(c.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                    active === c.id
                      ? "border-sp-accent bg-sp-accent/10"
                      : "border-sp-border hover:bg-sp-cardh"
                  }`}
                >
                  <img
                    src={fileUrl(c.snapshot)}
                    alt={c.name}
                    className="h-12 w-16 rounded object-cover"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">
                      {c.name}
                    </div>

                    <div className="font-mono text-xs text-sp-sub">
                      {o
                        ? `${o.free} free · ${o.occupied} occ`
                        : `${c.slot_count} slots`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* HELPERS */
const pct = (a, b) => {
  if (!b) return 0;
  return Math.round((a / b) * 100);
};

const Center = ({ children }) => (
  <div className="flex h-64 items-center justify-center">
    {children}
  </div>
);