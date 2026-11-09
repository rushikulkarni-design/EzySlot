import React, { useEffect, useState, useRef } from "react";
import api, { fileUrl, apiErr } from "../../lib/api";
import PolygonEditor from "../../components/PolygonEditor";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import {
  Loader2,
  Plus,
  Cctv,
  Save,
  Trash2,
  Coins,
  Film,
  CheckCircle2,
  Image as ImageIcon,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
export default function DevCameras() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [cameras, setCameras] = useState([]);
  const [activeCam, setActiveCam] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [liveFrameUrl, setLiveFrameUrl] = useState("");
  const [liveFrameError, setLiveFrameError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [fareOpen, setFareOpen] = useState(false);
  const [newCam, setNewCam] = useState({
    name: "",
    snapshot_url: "",
    rtsp_url: "",
    snapshot_file: null,
  });
  const [fare, setFare] = useState({
    enabled: true,
    type: "per_hour",
    currency: "INR",
    per_hour: 40,
    fixed: 100,
    slabs: [],
  });
  const videoRef = useRef(null);
  const snapshotRef = useRef(null);
  const [clipStatus, setClipStatus] = useState(null);
  const uploadClip = async (file) => {
    if (!file || !activeCam) return;
    setClipStatus({
      status: "processing",
      processed: 0,
      total: 0,
    });
    try {
      const fd = new FormData();
      fd.append("video", file);
      await api.post(`/cameras/${activeCam}/video`, fd, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      const camId = activeCam;
      const poll = setInterval(async () => {
        try {
          const { data } = await api.get(
            `/cameras/${camId}/video/status`
          );
          setClipStatus(data);
          if (
            data.status === "done" ||
            data.status === "error"
          ) {
            clearInterval(poll);
            if (data.status === "done") {
              toast.success(
                `Processed ${data.processed} frames with YOLOv8 — draw slots over the real frame and save`
              );
              await loadCams(clientId);
              await selectCam(camId);
            } else {
              toast.error(
                data.error || "Video processing failed"
              );
            }
          }
        } catch (err) {
          console.warn(
            "clip status poll failed",
            err
          );
        }
      }, 1500);
    } catch (e) {
      setClipStatus(null);
      toast.error(apiErr(e));
    }
  };
  useEffect(() => {
    api
      .get("/clients")
      .then((r) => {
        setClients(r.data.clients);
        if (r.data.clients[0]) {
          setClientId(r.data.clients[0].id);
        }
      })
      .catch((e) => {
        toast.error(apiErr(e));
      });
  }, []);
  const loadCams = async (cid, preferredCameraId = activeCam) => {
    try {
      const { data } = await api.get("/cameras", { params: { client_id: cid } });
      const nextCameras = data.cameras || [];
      setCameras(nextCameras);
      // Preserve the selected camera instead of always jumping to the first.
      const nextId = nextCameras.some((item) => item.id === preferredCameraId)
        ? preferredCameraId
        : (nextCameras[0]?.id || null);
      if (nextId !== activeCam) {
        if (nextId) await selectCam(nextId);
        else {
          setActiveCam(null);
          setSlots([]);
          setLiveFrameUrl("");
          setLiveFrameError("");
        }
      }
    } catch (e) {
      toast.error(apiErr(e));
    }
  };
  useEffect(() => {
    if (clientId) {
      loadCams(clientId);
    }
  }, [clientId]);
  const selectCam = async (camId) => {
    setActiveCam(camId);
    setLiveFrameUrl("");
    setLiveFrameError("");
    setLoading(true);
    try {
      const { data } = await api.get(
        `/cameras/${camId}/slots`
      );
      setSlots(
        data.slots.map((s) => ({
          id: s.id,
          label: s.label,
          polygon: s.polygon,
        }))
      );
    } catch {
      setSlots([]);
    } finally {
      setLoading(false);
    }
  };
  // Poll the selected camera's own RTSP frame; never reuse another camera's image.
  useEffect(() => {
    if (!activeCam) return undefined;
    const selected = cameras.find((item) => item.id === activeCam);
    const status = String(selected?.connection_status || selected?.status || "").toLowerCase();
    if (!["connected", "online", "connecting"].includes(status)) return undefined;

    let cancelled = false;
    let timer;
    let currentObjectUrl = "";

    const pollFrame = async () => {
      try {
        const response = await api.get(`/cameras/${activeCam}/rtsp-frame`, {
          responseType: "blob",
          headers: { "Cache-Control": "no-cache" },
        });
        if (cancelled) return;
        const blob = response.data;
        if (!(blob instanceof Blob) || !blob.type.startsWith("image/") || blob.size === 0) {
          throw new Error("Camera endpoint did not return an image.");
        }
        const nextUrl = URL.createObjectURL(blob);
        if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = nextUrl;
        setLiveFrameUrl(nextUrl);
        setLiveFrameError("");
      } catch (error) {
        if (!cancelled) {
          setLiveFrameError(
            error?.response?.data?.detail || "Waiting for a frame from this camera…"
          );
        }
      } finally {
        if (!cancelled) timer = setTimeout(pollFrame, 1200);
      }
    };

    pollFrame();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [activeCam, cameras]);

  const saveSlots = async () => {
    if (!activeCam) return;
    try {
      await api.put(
        `/cameras/${activeCam}/slots`,
        {
          slots,
        }
      );
      toast.success(
        `Saved ${slots.length} slots`
      );
      loadCams(clientId);
    } catch (e) {
      toast.error(apiErr(e));
    }
  };
  const addCamera = async (e) => {
    e.preventDefault();
    if (!newCam.name.trim()) {
      toast.error("Enter camera name");
      return;
    }
    try {
      const fd = new FormData();
      fd.append(
        "client_id",
        clientId
      );
      fd.append(
        "name",
        newCam.name.trim()
      );
      fd.append(
        "snapshot_url",
        newCam.snapshot_url || ""
      );
      fd.append("rtsp_url", newCam.rtsp_url.trim());
      /*
       IMPORTANT:
       Backend expects "snapshot", NOT "snapshot_file".
      */
      if (newCam.snapshot_file) {
        fd.append(
          "snapshot",
          newCam.snapshot_file
        );
      }
      await api.post(
        "/cameras",
        fd,
        {
          headers: {
            "Content-Type":
              "multipart/form-data",
          },
        }
      );
      toast.success("Camera added");
      setNewCam({
        name: "",
        snapshot_url: "",
        rtsp_url: "",
        snapshot_file: null,
      });
      if (snapshotRef.current) {
        snapshotRef.current.value = "";
      }
      setAddOpen(false);
      loadCams(clientId);
    } catch (e2) {
      toast.error(apiErr(e2));
    }
  };
  const delCamera = async (id) => {
    try {
      await api.delete(
        `/cameras/${id}`
      );
      toast.success(
        "Camera removed"
      );
      loadCams(clientId);
    } catch (e) {
      toast.error(apiErr(e));
    }
  };
  const setCameraConnection = async (camera, action) => {
    if (!camera?.id) return;
    try {
      await api.post(`/cameras/${camera.id}/${action}`);
      toast.success(action === "connect"
        ? `Connection requested for ${camera.name}`
        : `${camera.name} disconnected`);
      setCameras((prev) => prev.map((item) =>
        item.id === camera.id
          ? { ...item, status: action === "connect" ? "connecting" : "offline",
              connection_status: action === "connect" ? "connecting" : "disconnected" }
          : item
      ));
      if (action === "disconnect" && camera.id === activeCam) {
        setLiveFrameUrl("");
        setLiveFrameError("Camera disconnected.");
      } else if (action === "connect" && camera.id === activeCam) {
        setLiveFrameError("Connecting to this camera…");
      }
      // Refresh metadata but preserve the camera the developer clicked.
      await loadCams(clientId, camera.id);
    } catch (e) {
      toast.error(apiErr(e));
    }
  };
  const saveFare = async () => {
    try {
      await api.put(
        `/clients/${clientId}/fare`,
        fare
      );
      toast.success(
        "Fare updated"
      );
      setFareOpen(false);
    } catch (e) {
      toast.error(apiErr(e));
    }
  };
  const cam = cameras.find(
    (c) => c.id === activeCam
  );
  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl font-bold">
          Cameras &amp; Slot Mapping
        </h2>
        <select
          data-testid="client-select"
          value={clientId}
          onChange={(e) =>
            setClientId(e.target.value)
          }
          className="rounded-md border border-sp-border bg-sp-card px-3 py-2 text-sm"
        >
          {clients.map((c) => (
            <option
              key={c.id}
              value={c.id}
            >
              {c.name}
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          {/* FARE CONFIG */}
          <Dialog
            open={fareOpen}
            onOpenChange={setFareOpen}
          >
            <DialogTrigger asChild>
              <Button
                data-testid="fare-config-btn"
                variant="outline"
                className="border-sp-border"
              >
                <Coins className="mr-1 h-4 w-4" />
                Fare Config
              </Button>
            </DialogTrigger>
            <DialogContent className="border-sp-border bg-sp-card">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">
                  Fare Configuration
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
                  <input
                    type="checkbox"
                    checked={fare.enabled}
                    onChange={(e) =>
                      setFare({
                        ...fare,
                        enabled:
                          e.target.checked,
                      })
                    }
                  />
                  Enable fare billing
                </label>
                <select
                  data-testid="fare-type"
                  value={fare.type}
                  onChange={(e) =>
                    setFare({
                      ...fare,
                      type: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-sp-border bg-sp-bg px-3 py-2 text-sm"
                >
                  <option value="per_hour">
                    Per hour
                  </option>
                  <option value="fixed">
                    Fixed
                  </option>
                  <option value="slab">
                    Slab based
                  </option>
                </select>
                <Input
                  type="number"
                  placeholder="Per hour"
                  value={fare.per_hour}
                  onChange={(e) =>
                    setFare({
                      ...fare,
                      per_hour:
                        Number(
                          e.target.value
                        ),
                    })
                  }
                  className="bg-sp-bg"
                />
                <Input
                  type="number"
                  placeholder="Fixed"
                  value={fare.fixed}
                  onChange={(e) =>
                    setFare({
                      ...fare,
                      fixed:
                        Number(
                          e.target.value
                        ),
                    })
                  }
                  className="bg-sp-bg"
                />
                <Button
                  data-testid="save-fare-btn"
                  onClick={saveFare}
                  className="w-full bg-sp-accent text-sp-bg"
                >
                  Save Fare
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          {/* ADD CAMERA */}
          <Dialog
            open={addOpen}
            onOpenChange={setAddOpen}
          >
            <DialogTrigger asChild>
              <Button
                data-testid="add-camera-btn"
                className="bg-sp-accent text-sp-bg hover:bg-sky-400"
              >
                <Plus className="mr-1 h-4 w-4" />
                Add Camera
              </Button>
            </DialogTrigger>
            <DialogContent className="border-sp-border bg-sp-card">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">
                  Add Camera
                </DialogTitle>
              </DialogHeader>
              <form
                onSubmit={addCamera}
                className="space-y-4"
              >
                <Input
                  required
                  data-testid="camera-name"
                  placeholder="Camera name"
                  value={newCam.name}
                  onChange={(e) =>
                    setNewCam({
                      ...newCam,
                      name: e.target.value,
                    })
                  }
                  className="bg-sp-bg"
                />
                <Input
                  data-testid="camera-snapshot-url"
                  placeholder="Snapshot / feed image URL (optional)"
                  value={newCam.snapshot_url}
                  onChange={(e) =>
                    setNewCam({
                      ...newCam,
                      snapshot_url:
                        e.target.value,
                    })
                  }
                  className="bg-sp-bg"
                />
                <div className="space-y-1">
                  <label className="text-sm font-medium">RTSP Stream URL</label>
                  <Input
                    data-testid="camera-rtsp-url"
                    placeholder="rtsp://username:password@camera-ip:port/stream"
                    value={newCam.rtsp_url}
                    onChange={(e) => setNewCam({ ...newCam, rtsp_url: e.target.value })}
                    className="bg-sp-bg font-mono text-xs"
                  />
                  <p className="text-xs text-sp-sub">
                    Optional. A saved RTSP URL enables the backend live-stream connection.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <ImageIcon className="h-4 w-4 text-sp-accent" />
                    Parking Camera Snapshot
                  </label>
                  <p className="text-xs text-sp-sub">
                    Upload the actual parking
                    camera image for slot mapping.
                  </p>
                  <input
                    ref={snapshotRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    data-testid="camera-snapshot-file"
                    onChange={(e) => {
                      const file =
                        e.target.files?.[0] ||
                        null;
                      setNewCam({
                        ...newCam,
                        snapshot_file:
                          file,
                      });
                    }}
                    className="block w-full cursor-pointer rounded-md border border-sp-border bg-sp-bg px-3 py-2 text-sm"
                  />
                  {newCam.snapshot_file && (
                    <div className="rounded-md border border-sp-free/30 bg-sp-free/10 px-3 py-2 text-xs text-sp-free">
                      Selected image:
                      <span className="ml-1 font-medium">
                        {
                          newCam
                            .snapshot_file
                            .name
                        }
                      </span>
                    </div>
                  )}
                </div>
                <Button
                  type="submit"
                  data-testid="camera-create-submit"
                  className="w-full bg-sp-accent text-sp-bg"
                >
                  Add Camera
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {/* CAMERA LIST */}
      <div className="flex flex-wrap gap-2">
        {cameras.map((c) => (
          <div
            key={c.id}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
              activeCam === c.id
                ? "border-sp-accent bg-sp-accent/10"
                : "border-sp-border bg-sp-card"
            }`}
          >
            <button
              data-testid={`dev-camera-tab-${c.id}`}
              onClick={() =>
                selectCam(c.id)
              }
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
            >
              <Cctv className="h-4 w-4 text-sp-accent" />
              <span className="flex flex-col items-start">
                <span>{c.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-sp-sub">
                  {c.connection_status || c.status || "disconnected"} · {c.slot_count ?? 0} slots
                </span>
              </span>
            </button>
            <button
              type="button"
              data-testid={`connect-camera-${c.id}`}
              onClick={() => setCameraConnection(c, "connect")}
              title="Connect camera"
              className="rounded-md p-1.5 text-sp-free hover:bg-sp-free/10"
            >
              <Wifi className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-testid={`disconnect-camera-${c.id}`}
              onClick={() => setCameraConnection(c, "disconnect")}
              title="Disconnect camera"
              className="rounded-md p-1.5 text-sp-sub hover:bg-sp-occ/10 hover:text-sp-occ"
            >
              <WifiOff className="h-4 w-4" />
            </button>
            <button
              data-testid={`delete-camera-${c.id}`}
              onClick={() =>
                delCamera(c.id)
              }
              className="text-sp-sub hover:text-sp-occ"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {cameras.length === 0 && (
          <p className="text-sp-sub">
            No cameras. Add one to start drawing
            slots.
          </p>
        )}
      </div>
      {/* SLOT EDITOR */}
      {activeCam && (
        <div className="rounded-xl border border-sp-border bg-sp-card p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="font-display text-xl font-bold">
                {cam?.name} — Slot Editor
              </div>
              <span className={`rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
                cam?.connection_status === "connected"
                  ? "border-sp-free/40 bg-sp-free/10 text-sp-free"
                  : cam?.connection_status === "connecting"
                    ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                    : "border-sp-border text-sp-sub"
              }`}>
                {cam?.connection_status || cam?.status || "disconnected"}
              </span>
              {cam?.clip_ready && (
                <span className="flex items-center gap-1 rounded-full border border-sp-free/40 bg-sp-free/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-sp-free">
                  <CheckCircle2 className="h-3 w-3" />
                  {cam.clip_frames} real frames
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={videoRef}
                type="file"
                accept="video/*"
                data-testid="clip-upload-input"
                className="hidden"
                onChange={(e) =>
                  uploadClip(
                    e.target.files?.[0]
                  )
                }
              />
              <Button
                data-testid="upload-clip-btn"
                variant="outline"
                disabled={
                  clipStatus?.status ===
                  "processing"
                }
                onClick={() =>
                  videoRef.current?.click()
                }
                className="border-sp-accent/50 text-sp-accent hover:bg-sp-accent/10"
              >
                {clipStatus?.status ===
                "processing" ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    Processing{" "}
                    {clipStatus.processed ||
                      0}{" "}
                    frames…
                  </>
                ) : (
                  <>
                    <Film className="mr-1 h-4 w-4" />
                    Upload Clip
                    (real YOLO)
                  </>
                )}
              </Button>
              <Button
                data-testid="save-polygon-mapping-btn"
                onClick={saveSlots}
                className="bg-sp-free text-white hover:bg-emerald-600"
              >
                <Save className="mr-1 h-4 w-4" />
                Save Slot Map
              </Button>
            </div>
          </div>
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-sp-accent" />
          ) : (
            <div className="space-y-2">
              {liveFrameError && (
                <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                  {liveFrameError}
                </div>
              )}
              <PolygonEditor
                imageUrl={
                  liveFrameUrl ||
                  (!(["connected", "online", "connecting"].includes(
                    String(cam?.connection_status || cam?.status || "").toLowerCase()
                  )) && cam?.snapshot
                    ? fileUrl(cam.snapshot)
                    : "")
                }
                slots={slots}
                setSlots={setSlots}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}