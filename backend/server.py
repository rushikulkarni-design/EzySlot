from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
import os
import uuid
import secrets
import asyncio
import csv
import io
import random
import logging
import threading
import time
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Set
import jwt
import bcrypt
from fastapi import (FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile,
                     File, Form, WebSocket, WebSocketDisconnect, Query, Response, Header)
from fastapi.responses import StreamingResponse, HTMLResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import tempfile
from number_plate import read_number_plate, normalize_plate
import detection
import storage
from email_service import send_email
from io import BytesIO
from starlette.datastructures import Headers
import plate_detector
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("EzySlot")

# ---------------- per-camera RTSP bridge ----------------
# EZYSLOT_RTSP_URL is an optional fallback for the single local test camera.
# Production cameras should each store their own rtsp_url in MongoDB.
RTSP_URL = os.environ.get("EZYSLOT_RTSP_URL", "").strip()
_rtsp_lock = threading.Lock()
_rtsp_frames: Dict[str, bytes] = {}
_rtsp_workers: Dict[str, threading.Thread] = {}
_rtsp_stop_events: Dict[str, threading.Event] = {}
_rtsp_last_frame_at: Dict[str, float] = {}

def _rtsp_capture_worker(camera_id: str, url: str, stop_event: threading.Event):
    """Continuously pull and cache frames for one camera only."""
    import cv2
    while not stop_event.is_set():
        cap = None
        try:
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                logger.warning("RTSP camera %s could not be opened; retrying", camera_id)
                time.sleep(2)
                continue
            while not stop_event.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    logger.warning("RTSP frame read failed for camera %s; reconnecting", camera_id)
                    break
                h, w = frame.shape[:2]
                if w > 1280:
                    frame = cv2.resize(frame, (1280, int(h * 1280 / w)))
                ok_jpg, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
                if ok_jpg:
                    with _rtsp_lock:
                        _rtsp_frames[camera_id] = encoded.tobytes()
                        _rtsp_last_frame_at[camera_id] = time.time()
        except Exception as exc:
            logger.warning("RTSP worker error for camera %s: %s", camera_id, exc)
        finally:
            if cap is not None:
                cap.release()
        if not stop_event.is_set():
            time.sleep(1)

def _start_rtsp_worker(camera_id: str, url: str):
    if not url:
        raise HTTPException(status_code=400, detail="No RTSP URL configured for this camera.")
    with _rtsp_lock:
        current = _rtsp_workers.get(camera_id)
        if current and current.is_alive():
            return
        stop_event = threading.Event()
        thread = threading.Thread(
            target=_rtsp_capture_worker, args=(camera_id, url, stop_event),
            name=f"ezyslot-rtsp-{camera_id[:8]}", daemon=True,
        )
        _rtsp_stop_events[camera_id] = stop_event
        _rtsp_workers[camera_id] = thread
        thread.start()

def _stop_rtsp_worker(camera_id: str):
    with _rtsp_lock:
        stop_event = _rtsp_stop_events.pop(camera_id, None)
        if stop_event:
            stop_event.set()
        _rtsp_workers.pop(camera_id, None)
        _rtsp_frames.pop(camera_id, None)
        _rtsp_last_frame_at.pop(camera_id, None)

def _get_rtsp_frame(camera_id: str):
    with _rtsp_lock:
        frame = _rtsp_frames.get(camera_id)
        seen = _rtsp_last_frame_at.get(camera_id, 0)
    # Treat a stalled stream as unavailable rather than presenting a stale frame as live.
    if not frame or time.time() - seen > 5:
        return None
    return frame

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = "HS256"
app = FastAPI(title="EzySlot AI")
api = APIRouter(prefix="/api")
swagger_bearer = HTTPBearer(auto_error=False)
DEMO_IMAGES = [
    "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwxfHxhZXJpYWwlMjBwYXJraW5nJTIwbG90JTIwY2FycyUyMHRvcCUyMHZpZXclMjBvdmVyaGVhZHxlbnwwfHx8fDE3OTAwMDk2Mjl8MA&ixlib=rb-4.1.0&q=85",
    "https://images.unsplash.com/photo-1593280405106-e438ebe93f5b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwyfHxhZXJpYWwlMjBwYXJraW5nJTIwbG90JTIwY2FycyUyMHRvcCUyMHZpZXclMjBvdmVyaGVhZHxlbnwwfHx8fDE3OTAwMDk2Mjl8MA&ixlib=rb-4.1.0&q=85",
    "https://images.pexels.com/photos/15984741/pexels-photo-15984741.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
]
# ---------------- auth helpers ----------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False
def create_token(user: dict) -> str:
    payload = {
        "sub": user["id"], "email": user["email"], "role": user["role"],
        "client_id": user.get("client_id"),
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)
async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(swagger_bearer),
) -> dict:
    token = None
    # Prefer the Swagger/API Bearer token when provided.
    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    # Preserve the existing Authorization-header and cookie fallback.
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one(
        {"id": payload["sub"]},
        {"_id": 0, "password_hash": 0},
    )
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
async def require_developer(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "developer":
        raise HTTPException(status_code=403, detail="Developer access required")
    return user
def scope_client_id(user: dict, requested: Optional[str]) -> str:
    """Fail-closed tenant scope: developers must choose a client; clients are locked to their own."""
    role = user.get("role")
    if role == "developer":
        if not requested:
            raise HTTPException(status_code=400, detail="client_id required")
        return requested
    if role != "client":
        raise HTTPException(status_code=403, detail="Unsupported account role")
    own_client_id = user.get("client_id")
    if not isinstance(own_client_id, str) or not own_client_id.strip():
        raise HTTPException(status_code=403, detail="Client account is not linked to a client")
    if requested and requested != own_client_id:
        raise HTTPException(status_code=403, detail="Cross-client access denied")
    return own_client_id
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
async def log_activity(client_id: str, actor: str, action: str, detail: str):
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()), "client_id": client_id, "actor": actor,
        "action": action, "detail": detail, "timestamp": now_iso(),
    })
# ---------------- models ----------------
class LoginBody(BaseModel):
    email: EmailStr
    password: str
class TicketBody(BaseModel):
    subject: str
    description: str
    priority: str = "medium"
class TicketUpdate(BaseModel):
    status: Optional[str] = None
    response: Optional[str] = None
class ClientCreate(BaseModel):
    name: str
    site_location: str
    contact_email: EmailStr
    service_days: int = Field(default=180, ge=1, le=1825)
    subscription_plan: str = "growth"
    subscription_amount: float = Field(default=0, ge=0)
class ProposalBody(BaseModel):
    name: str
    site_location: str
    contact_email: EmailStr
    plan_duration: str
    amount: float = Field(ge=0)
    has_compatible_cameras: bool = True
    notes: str = ""

class PaymentVerifyBody(BaseModel):
    transaction_reference: str = ""
    internal_notes: str = ""
class SlotSaveBody(BaseModel):
    slots: List[dict]
class FareBody(BaseModel):
    enabled: bool = True
    type: str = "per_hour"  # per_hour | per_interval | fixed | slabs
    currency: str = "INR"
    per_hour: float = Field(default=40, ge=0)
    per_interval: float = Field(default=20, ge=0)
    billing_interval_minutes: int = Field(default=60, ge=1, le=1440)
    grace_period_minutes: int = Field(default=0, ge=0, le=1440)
    charge_partial_interval: bool = True
    fixed: float = Field(default=100, ge=0)
    slabs: List[dict] = Field(default_factory=list)
class ServiceBody(BaseModel):
    service_days: int
class KnownVehicleCreate(BaseModel):
    plate_number: str
    owner_name: str
    category: str = "staff"
    vehicle_type: str = "car"
    notes: str = ""
# ---------------- realtime engine ----------------
class ConnManager:
    def __init__(self):
        self.rooms: Dict[str, Set[WebSocket]] = {}
    async def connect(self, client_id: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(client_id, set()).add(ws)
    def disconnect(self, client_id: str, ws: WebSocket):
        if client_id in self.rooms:
            self.rooms[client_id].discard(ws)
    async def broadcast(self, client_id: str, message: dict):
        for ws in list(self.rooms.get(client_id, set())):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(client_id, ws)
manager = ConnManager()
# in-memory occupancy state: camera_id -> {slot_id: {status, conf, box}}
OCC: Dict[str, Dict[str, dict]] = {}
# real-clip playback: camera_id -> {"frames": [payload,...], "idx": int}
CLIP: Dict[str, dict] = {}
LAST_CLIP_STATE: Dict[str, dict] = {}
VIDEO_JOBS: Dict[str, dict] = {}
MAX_CLIP_FRAMES = 24
CLIP_FRAME_STEP_SEC = 1.5
def _slot_box(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
    pad_x = (x2 - x1) * 0.12
    pad_y = (y2 - y1) * 0.12
    return [x1 + pad_x, y1 + pad_y, x2 - pad_x, y2 - pad_y]
async def _init_occupancy():
    OCC.clear()
    cameras = await db.cameras.find({}, {"_id": 0}).to_list(1000)
    for cam in cameras:
        if cam.get("clip_ready"):
            continue  # clip-backed cameras play real detections, not simulation
        slots = await db.slots.find({"camera_id": cam["id"]}, {"_id": 0}).to_list(1000)
        # Do not seed fabricated occupancy. Real camera/clip analysis populates OCC.
        # Empty state intentionally means "no current analysis available".
        OCC.pop(cam["id"], None)
def _snapshot_payload(cam, state):
    slots = []
    free = occ = unk = 0
    for sid, v in state.items():
        slots.append({"slot_id": sid, "label": v["label"], "polygon": v["polygon"],
                      "status": v["status"], "conf": v["conf"], "box": v["box"]})
        if v["status"] == "FREE":
            free += 1
        elif v["status"] == "OCCUPIED":
            occ += 1
        else:
            unk += 1
    nearest = next((s["label"] for s in sorted(slots, key=lambda x: x["label"]) if s["status"] == "FREE"), None)
    return {
        "camera_id": cam["id"], "camera_name": cam["name"],
        "slots": slots, "free": free, "occupied": occ, "unknown": unk,
        "total": len(slots), "nearest_free": nearest, "timestamp": now_iso(),
    }
def _extract_and_detect(video_path: str, max_frames: int):
    """Blocking: sample frames from a video and run YOLOv8 on each. Returns [(jpg_bytes, boxes)]."""
    import cv2
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(fps * CLIP_FRAME_STEP_SEC))
    out = []
    fidx = 0
    while len(out) < max_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fidx)
        ret, frame = cap.read()
        if not ret:
            break
        h, w = frame.shape[:2]
        if w > 960:
            frame = cv2.resize(frame, (960, int(h * 960 / w)))
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if ok:
            jb = buf.tobytes()
            boxes, _, _ = detection.detect_vehicles(jb)
            out.append((jb, boxes))
        fidx += step
    cap.release()
    return out
async def recompute_and_cache(camera_id: str):
    """Rebuild the playback sequence by mapping stored per-frame detections onto current slots."""
    cam = await db.cameras.find_one({"id": camera_id}, {"_id": 0})
    if not cam:
        return
    slots = await db.slots.find({"camera_id": camera_id}, {"_id": 0}).to_list(1000)
    frames = await db.clip_frames.find({"camera_id": camera_id}, {"_id": 0}).sort("index", 1).to_list(1000)
    if not frames:
        CLIP.pop(camera_id, None)
        return
    seq = []
    for fr in frames:
        statuses = detection.compute_slot_status(slots, fr["detections"]) if slots else {}
        slot_list = []
        free = occ = unk = 0
        for s in slots:
            st = statuses.get(s["id"], {"status": "FREE", "conf": 0.0, "box": None})
            slot_list.append({"slot_id": s["id"], "label": s["label"], "polygon": s["polygon"],
                              "status": st["status"], "conf": st["conf"], "box": st["box"]})
            if st["status"] == "FREE":
                free += 1
            elif st["status"] == "OCCUPIED":
                occ += 1
            else:
                unk += 1
        nearest = next((x["label"] for x in sorted(slot_list, key=lambda z: z["label"]) if x["status"] == "FREE"), None)
        seq.append({"camera_id": camera_id, "camera_name": cam["name"], "frame_url": fr["frame_url"],
                    "detections": fr["detections"], "slots": slot_list, "free": free, "occupied": occ,
                    "unknown": unk, "total": len(slot_list), "nearest_free": nearest, "source": "clip"})
    CLIP[camera_id] = {"frames": seq, "idx": 0}
    LAST_CLIP_STATE.pop(camera_id, None)
async def load_clips():
    cams = await db.cameras.find({"clip_ready": True}, {"_id": 0}).to_list(1000)
    for cam in cams:
        await recompute_and_cache(cam["id"])
async def process_video(camera_id: str, video_bytes: bytes):
    import tempfile
    import os as _os
    VIDEO_JOBS[camera_id] = {"status": "processing", "processed": 0, "total": MAX_CLIP_FRAMES}
    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp.write(video_bytes)
    tmp.close()
    try:
        cam = await db.cameras.find_one({"id": camera_id})
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, _extract_and_detect, tmp.name, MAX_CLIP_FRAMES)
        if not results:
            VIDEO_JOBS[camera_id] = {"status": "error", "error": "No frames could be decoded from the video"}
            return
        await db.clip_frames.delete_many({"camera_id": camera_id})
        first_url = None
        for i, (jb, boxes) in enumerate(results):
            path = f"{storage.APP_NAME}/clips/{camera_id}/{i}.jpg"
            url = f"/api/files/{path}"
            try:
                storage.put_object(path, jb, "image/jpeg")
            except Exception as e:
                logger.warning(f"clip frame upload failed: {e}")
            if i == 0:
                first_url = url
            await db.clip_frames.insert_one({"id": str(uuid.uuid4()), "camera_id": camera_id,
                                             "client_id": cam["client_id"], "index": i,
                                             "frame_url": url, "detections": boxes})
            VIDEO_JOBS[camera_id]["processed"] = i + 1
        upd = {"clip_ready": True, "clip_frames": len(results)}
        if first_url:
            upd["snapshot"] = first_url
        await db.cameras.update_one({"id": camera_id}, {"$set": upd})
        OCC.pop(camera_id, None)
        await recompute_and_cache(camera_id)
        VIDEO_JOBS[camera_id] = {"status": "done", "processed": len(results), "total": len(results)}
        await log_activity(cam["client_id"], "system", "clip.processed", f"{len(results)} frames on {cam['name']}")
    except Exception as e:
        logger.error(f"process_video error: {e}")
        VIDEO_JOBS[camera_id] = {"status": "error", "error": str(e)[:200]}
    finally:
        try:
            _os.unlink(tmp.name)
        except Exception:
            pass
async def occupancy_loop():
    await asyncio.sleep(3)
    try:
        await _init_occupancy()
    except Exception as e:
        logger.warning(f"occupancy init failed: {e}")
    try:
        await load_clips()
    except Exception as e:
        logger.warning(f"clip load failed: {e}")
    tick = 0
    while True:
        try:
            tick += 1
            cameras = await db.cameras.find({}, {"_id": 0}).to_list(1000)
            for cam in cameras:
                # ---- clip-backed cameras: play back real YOLO detections ----
                if cam["id"] in CLIP and CLIP[cam["id"]]["frames"]:
                    c = CLIP[cam["id"]]
                    c["idx"] = (c["idx"] + 1) % len(c["frames"])
                    payload = dict(c["frames"][c["idx"]])
                    payload["type"] = "occupancy"
                    payload["timestamp"] = now_iso()
                    await _sync_parking_sessions(cam, payload)
                    await manager.broadcast(cam["client_id"], payload)
                    prev = LAST_CLIP_STATE.get(cam["id"], {})
                    cur = {s["slot_id"]: (s["status"], s["label"]) for s in payload["slots"]}
                    for sid, (st, lbl) in cur.items():
                        old = prev.get(sid)
                        if old and old != st:
                            await db.slot_events.insert_one({
                                "id": str(uuid.uuid4()), "client_id": cam["client_id"], "camera_id": cam["id"],
                                "camera_name": cam["name"], "slot_id": sid, "label": lbl,
                                "from_status": old, "to_status": st, "timestamp": now_iso()})
                    LAST_CLIP_STATE[cam["id"]] = {sid: st for sid, (st, _l) in cur.items()}
                    if tick % 5 == 0:
                        await db.detections.insert_one({
                            "id": str(uuid.uuid4()), "client_id": cam["client_id"], "camera_id": cam["id"],
                            "camera_name": cam["name"], "free": payload["free"], "occupied": payload["occupied"],
                            "unknown": payload["unknown"], "total": payload["total"], "timestamp": now_iso()})
                    continue
                # ---- live RTSP camera: analyse real frames only ----
                if cam.get("connection_status") == "disconnected":
                    continue
                if cam.get("connection_status") == "disconnected":
                    continue
                camera_url = str(cam.get("rtsp_url") or "").strip()
                if not camera_url:
                    continue
                try:
                    _start_rtsp_worker(cam["id"], camera_url)
                    live_frame = _get_rtsp_frame(cam["id"])
                    if not live_frame:
                        continue  # no current frame means no occupancy claim
                    payload = await _analyse_rtsp_occupancy(cam, live_frame)
                    await _sync_parking_sessions(cam, payload)
                    await manager.broadcast(cam["client_id"], payload)
                    if tick % 5 == 0:
                        await db.detections.insert_one({
                            "id": str(uuid.uuid4()), "client_id": cam["client_id"], "camera_id": cam["id"],
                            "camera_name": cam["name"], "free": payload["free"], "occupied": payload["occupied"],
                            "unknown": payload["unknown"], "total": payload["total"],
                            "source": "rtsp", "timestamp": now_iso(),
                        })
                except Exception as exc:
                    logger.warning("Live RTSP analysis failed for camera %s: %s", cam["id"], exc)
        except Exception as e:
            logger.warning(f"occupancy loop error: {e}")
        await asyncio.sleep(2)
async def _analyse_rtsp_occupancy(cam: dict, frame_bytes: bytes) -> dict:
    """Run vehicle detection on the latest real RTSP frame and map detections to saved slots."""
    loop = asyncio.get_running_loop()
    boxes, width, height = await loop.run_in_executor(None, detection.detect_vehicles, frame_bytes)
    # A camera is not a parking camera merely because old/demo slot polygons exist.
    # Only count slots after a developer explicitly configures them for this camera.
    parking_configured = bool(cam.get("parking_configured", False))
    slots = []
    if parking_configured:
        slots = await db.slots.find({"camera_id": cam["id"]}, {"_id": 0}).to_list(1000)
    statuses = detection.compute_slot_status(slots, boxes) if slots else {}
    slot_rows = []
    free = occupied = unknown = 0
    for slot in slots:
        result = statuses.get(slot["id"], {"status": "UNKNOWN", "conf": 0.0, "box": None})
        status = result.get("status", "UNKNOWN")
        if status not in {"FREE", "OCCUPIED", "UNKNOWN"}:
            status = "UNKNOWN"
        slot_rows.append({
            "slot_id": slot["id"], "label": slot["label"], "polygon": slot["polygon"],
            "status": status, "conf": float(result.get("conf", 0.0) or 0.0),
            "box": result.get("box"),
        })
        if status == "FREE": free += 1
        elif status == "OCCUPIED": occupied += 1
        else: unknown += 1
    nearest = next((row["label"] for row in sorted(slot_rows, key=lambda x: x["label"]) if row["status"] == "FREE"), None)
    payload = {
        "type": "occupancy", "source": "rtsp", "camera_id": cam["id"],
        "camera_name": cam["name"], "detections": boxes, "slots": slot_rows,
        "free": free, "occupied": occupied, "unknown": unknown,
        "total": len(slot_rows), "nearest_free": nearest, "timestamp": now_iso(),
        "frame_width": width, "frame_height": height,
    }
    OCC[cam["id"]] = {row["slot_id"]: {
        "status": row["status"], "conf": row["conf"], "box": row["box"],
        "label": row["label"], "polygon": row["polygon"]
    } for row in slot_rows}
    return payload

# ---------------- public routes ----------------
@api.get("/")
async def root():
    return {"service": "EzySlot AI", "status": "online", "model_ready": detection.model_ready()}
@api.get("/public/demo-images")
async def demo_images():
    return {"images": DEMO_IMAGES}
@api.post("/detect")
async def detect(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        boxes, w, h = detection.detect_vehicles(data)
        annotated = detection.annotate_image(data, boxes)
    except Exception as e:
        logger.error(f"detect error: {e}")
        raise HTTPException(status_code=500, detail=f"Detection failed: {e}")
    path = f"{storage.APP_NAME}/detections/{uuid.uuid4()}.jpg"
    url = None
    try:
        storage.put_object(path, annotated, "image/jpeg")
        url = f"/api/files/{path}"
    except Exception as e:
        logger.warning(f"storage upload failed: {e}")
    counts = {
        "vehicles": len(boxes),
        "high_conf": sum(1 for b in boxes if b["conf"] >= detection.CONF_OCCUPIED),
        "low_conf": sum(1 for b in boxes if b["conf"] < detection.CONF_OCCUPIED),
    }
    return {"detections": boxes, "width": w, "height": h, "counts": counts,
            "annotated_url": url, "annotated_path": path}
@api.post("/enquiries")
async def create_enquiry(
    name: str = Form(...), email: EmailStr = Form(...), company: str = Form(""),
    site_location: str = Form(...), camera_count: int = Form(1), message: str = Form(""),
    reference_image: Optional[UploadFile] = File(None),
    contact_number: str = Form(...),
    has_smart_cameras: str = Form("not_sure"),
):
    ref_path = None
    if reference_image is not None:
        content = await reference_image.read()
        if content:
            ext = (reference_image.filename or "img.jpg").split(".")[-1][:5]
            ref_path = f"{storage.APP_NAME}/enquiries/{uuid.uuid4()}.{ext}"
            try:
                storage.put_object(ref_path, content, reference_image.content_type or "image/jpeg")
            except Exception as e:
                logger.warning(f"enquiry image upload failed: {e}")
                ref_path = None
    doc = {
        "id": str(uuid.uuid4()), "name": name, "email": email, "company": company,
        "site_location": site_location, "camera_count": camera_count, "message": message,
        "reference_image": ref_path, "status": "new", "created_at": now_iso(),
        "contact_number": contact_number.strip(),
        "has_smart_cameras": has_smart_cameras,
    }
    await db.enquiries.insert_one(dict(doc))
    notify = os.environ.get("ENQUIRY_NOTIFY_EMAIL", "")
    if notify:
        html = (f"<h2>New EzySlot AI enquiry</h2><p><b>{name}</b> ({email}) from "
                f"<b>{company or 'N/A'}</b></p><p>Site: {site_location} · Cameras: {camera_count}</p>"
                f"<p>Contact Number: {contact_number}</p><p>Smart Cameras: {has_smart_cameras}</p><p>{message}</p>")
        await send_email(db, notify, f"New enquiry: {company or name}", html, kind="enquiry")
    doc.pop("_id", None)
    return {"ok": True, "enquiry": doc}
# ---------------- auth routes ----------------
@api.post("/auth/login")
async def login(body: LoginBody, response: Response):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    user_pub = {"id": user["id"], "email": user["email"], "name": user["name"],
                "role": user["role"], "client_id": user.get("client_id")}
    token = create_token(user_pub)
    response.set_cookie("access_token", token, httponly=True, samesite="none", secure=True, max_age=604800, path="/")
    return {"token": token, "user": user_pub}
@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}
@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": user}
# ---------------- developer: enquiries ----------------
@api.get("/enquiries")
async def list_enquiries(user: dict = Depends(require_developer)):
    """Enquiries contain contact details and are visible only to developers."""
    items = await db.enquiries.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"enquiries": items}

@api.patch("/enquiries/{enquiry_id}/review")
async def review_enquiry(
    enquiry_id: str,
    body: dict,
    user: dict = Depends(require_developer),
):
    """Update enquiry verification status and internal notes."""
    allowed_statuses = {"new", "under_review", "verified", "rejected"}

    status = body.get("status")
    notes = body.get("internal_notes", "")

    if status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Status must be new, under_review, verified, or rejected",
        )

    if not isinstance(notes, str):
        raise HTTPException(
            status_code=400,
            detail="Internal notes must be text",
        )

    result = await db.enquiries.update_one(
        {"id": enquiry_id},
        {
            "$set": {
                "status": status,
                "internal_notes": notes.strip(),
                "reviewed_by": user.get("email", ""),
                "reviewed_at": now_iso(),
            }
        },
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Enquiry not found")

    return {
        "ok": True,
        "id": enquiry_id,
        "status": status,
        "internal_notes": notes.strip(),
    }

@api.delete("/enquiries/{enquiry_id}")
async def delete_enquiry(
    enquiry_id: str,
    user: dict = Depends(require_developer),
):
    """Permanently delete an enquiry."""
    result = await db.enquiries.delete_one({"id": enquiry_id})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Enquiry not found")

    await log_activity(
        None,
        user["email"],
        "enquiry.deleted",
        f"Deleted enquiry {enquiry_id}",
    )

    return {"ok": True, "message": "Enquiry deleted successfully"}


def _proposal_days(plan_duration: str) -> int:
    days = {"3 months": 90, "6 months": 180, "1 year": 365, "5 years": 1825}
    if plan_duration not in days:
        raise HTTPException(status_code=400, detail="Choose 3 months, 6 months, 1 year, or 5 years")
    return days[plan_duration]

def _html_escape(value: object) -> str:
    import html
    return html.escape(str(value or ""))

@api.post("/enquiries/{enquiry_id}/proposal")
async def send_enquiry_proposal(enquiry_id: str, body: ProposalBody, user: dict = Depends(require_developer)):
    enq = await db.enquiries.find_one({"id": enquiry_id})
    if not enq:
        raise HTTPException(status_code=404, detail="Enquiry not found")
    if enq.get("status") in {"converted", "payment_verified"}:
        raise HTTPException(status_code=400, detail="This enquiry has already been paid/activated")
    days = _proposal_days(body.plan_duration)
    action_token = secrets.token_urlsafe(32)
    action_base = os.environ.get("PUBLIC_ACTION_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    action_url = f"{action_base}/api/proposal-response/{action_token}"
    action_html = f"""
      <h3>Respond to this proposal</h3>
      <p style="margin:18px 0">
        <a href="{action_url}?action=paid" style="display:inline-block;background:#15803d;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;margin:4px">I've Paid</a>
        <a href="{action_url}?action=later" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;margin:4px">I'll Decide Later</a>
        <a href="{action_url}?action=decline" style="display:inline-block;background:#b91c1c;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;margin:4px">Decline Proposal</a>
      </p>
      <p style="font-size:13px;color:#64748b">These buttons record your response only. Payment is confirmed manually by EzySlot AI.</p>
    """
    upi_id = os.environ.get("UPI_ID", "reva.patki2004@oksbi").strip()
    qr_html = '<p><b>Scan to pay:</b><br><img src="cid:upi_qr" alt="UPI QR code" style="max-width:240px;width:100%;height:auto"></p>'
    camera_note = (
        "The site has compatible existing smart cameras. Target go-live: within 2 working days after payment verification."
        if body.has_compatible_cameras else
        "Camera supply/replacement may be required. Target go-live: minimum 4–5 working days after payment verification. Hardware and installation charges, if needed, are separate and quoted separately."
    )
    note_html = f"<p><b>Additional notes:</b> {_html_escape(body.notes)}</p>" if body.notes.strip() else ""
    html_body = f"""
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;max-width:680px">
      <h2 style="color:#15803d">EzySlot AI — Subscription Proposal</h2>
      <p>Dear {_html_escape(body.name)},</p>
      <p>Thank you for your interest in EzySlot AI. Please review your proposed subscription below.</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:8px;border:1px solid #ddd"><b>Company / site</b></td><td style="padding:8px;border:1px solid #ddd">{_html_escape(body.name)} — {_html_escape(body.site_location)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd"><b>Subscription</b></td><td style="padding:8px;border:1px solid #ddd">{_html_escape(body.plan_duration)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd"><b>Proposed price</b></td><td style="padding:8px;border:1px solid #ddd"><b>₹{body.amount:,.2f}</b></td></tr>
      </table>
      <h3>Included platform capabilities</h3>
      <ul><li>Parking occupancy monitoring and dashboard</li><li>Compatible smart-camera integration, subject to site/network compatibility</li><li>Vehicle and number-plate features supported by the deployment</li><li>Site configuration and client portal access</li></ul>
      <p>{_html_escape(camera_note)}</p>
      <h3>Manual UPI payment</h3>
      <p>UPI ID: <b>{_html_escape(upi_id)}</b></p>{qr_html}
      <p>Please pay the exact proposed amount and reply with the UPI transaction reference. Account access is issued only after the developer manually verifies the payment. This email is not a payment receipt.</p>
      {note_html}
      {action_html}
      <p>Regards,<br><b>EzySlot AI Team</b></p>
    </div>"""
    mail_result = await send_email(db, str(body.contact_email), f"EzySlot AI subscription proposal — {body.plan_duration}", html_body, kind="subscription_proposal")
    if mail_result.get("status") != "sent":
        raise HTTPException(status_code=502, detail="Proposal email could not be sent. Check SMTP settings and try again.")
    proposal = {
        "name": body.name, "site_location": body.site_location, "contact_email": str(body.contact_email),
        "plan_duration": body.plan_duration, "service_days": days, "amount": body.amount,
        "has_compatible_cameras": body.has_compatible_cameras, "notes": body.notes,
        "sent_at": now_iso(), "sent_by": user.get("email", ""), "payment_status": "pending",
        "action_token": action_token, "customer_response": "awaiting_response"
    }
    await db.enquiries.update_one({"id": enquiry_id}, {"$set": {
        "status": "proposal_sent", "proposal": proposal, "client_name": body.name,
        "proposal_email": str(body.contact_email)
    }})
    return {"ok": True, "status": "proposal_sent", "email_status": mail_result.get("status")}

@app.get("/api/proposal-response/{token}", response_class=HTMLResponse)
async def proposal_response_page(token: str, action: str = Query(default="")):
    enq = await db.enquiries.find_one({"proposal.action_token": token})
    if not enq or not enq.get("proposal"):
        raise HTTPException(status_code=404, detail="Proposal link is invalid or expired.")
    labels = {"paid": "I've Paid", "later": "I'll Decide Later", "decline": "Decline Proposal"}
    if action not in labels:
        action = ""
    if action == "paid":
        extra = '<label>UPI transaction reference (required)<br><input name="transaction_reference" required maxlength="120" style="width:100%;padding:10px;margin-top:6px" placeholder="Enter UPI transaction ID/reference"></label><p><label>Optional note<br><textarea name="customer_note" style="width:100%;padding:10px" rows="3"></textarea></label></p>'
    else:
        extra = '<p>Click confirm below to record your response.</p>'
    buttons = ''.join(f'<a href="?action={k}" style="display:inline-block;padding:9px 12px;margin:4px;border:1px solid #ddd;border-radius:6px;color:#166534">{v}</a>' for k,v in labels.items())
    return f"""<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>EzySlot AI Proposal Response</title></head>
    <body style="font-family:Arial,sans-serif;background:#f3f6f8;padding:24px;color:#1f2937"><main style="max-width:560px;margin:30px auto;background:white;padding:28px;border-radius:14px">
    <h2 style="color:#15803d">EzySlot AI — Proposal Response</h2><p>Company: <b>{_html_escape(enq.get('proposal',{}).get('name'))}</b></p>
    <p>Plan: {_html_escape(enq.get('proposal',{}).get('plan_duration'))} · Amount: ₹{float(enq.get('proposal',{}).get('amount',0)):,.2f}</p>
    <p>Choose your response:</p>{buttons}
    {f'<h3>{labels[action]}</h3><form method="post" action="/api/proposal-response/{token}"><input type="hidden" name="action" value="{action}">{extra}<button style="background:#15803d;color:white;border:0;border-radius:6px;padding:12px 18px;cursor:pointer" type="submit">Confirm response</button></form>' if action else '<p>Select one of the response options above.</p>'}
    <p style="font-size:13px;color:#64748b;margin-top:24px">Submitting a response does not automatically confirm payment or activate your account. EzySlot AI verifies payments manually.</p></main></body></html>"""


@app.post("/api/proposal-response/{token}", response_class=HTMLResponse)
async def submit_proposal_response(
    token: str,
    action: str = Form(...),
    transaction_reference: str = Form(default=""),
    customer_note: str = Form(default=""),
):
    enq = await db.enquiries.find_one({"proposal.action_token": token})
    if not enq or not enq.get("proposal"):
        raise HTTPException(status_code=404, detail="Proposal link is invalid or expired.")
    if enq.get("status") == "converted":
        raise HTTPException(status_code=400, detail="This subscription is already activated.")
    if action not in {"paid", "later", "decline"}:
        raise HTTPException(status_code=400, detail="Invalid proposal response.")
    if action == "paid" and not transaction_reference.strip():
        raise HTTPException(status_code=400, detail="Please enter your UPI transaction reference.")
    mapping = {
        "paid": ("payment_claimed", "Customer says payment submitted"),
        "later": ("considering", "Customer will decide later"),
        "decline": ("declined", "Customer declined proposal"),
    }
    status, label = mapping[action]
    await db.enquiries.update_one({"id": enq["id"], "proposal.action_token": token}, {"$set": {
        "status": status,
        "proposal.customer_response": action,
        "proposal.customer_responded_at": now_iso(),
        "proposal.transaction_reference_submitted": transaction_reference.strip() if action == "paid" else "",
        "proposal.customer_note": customer_note.strip(),
    }})
    notify = os.environ.get("ENQUIRY_NOTIFY_EMAIL", "").strip()
    if notify:
        html = f"""<div style="font-family:Arial,sans-serif"><h2>EzySlot AI — Proposal response</h2>
        <p><b>Company:</b> {_html_escape(enq.get('proposal',{}).get('name'))}</p>
        <p><b>Contact:</b> {_html_escape(enq.get('proposal',{}).get('contact_email'))}</p>
        <p><b>Plan:</b> {_html_escape(enq.get('proposal',{}).get('plan_duration'))}</p>
        <p><b>Amount:</b> ₹{float(enq.get('proposal',{}).get('amount',0)):,.2f}</p>
        <p><b>Response:</b> {_html_escape(label)}</p>
        <p><b>UPI reference:</b> {_html_escape(transaction_reference.strip() or 'Not supplied')}</p>
        <p><b>Customer note:</b> {_html_escape(customer_note.strip() or 'None')}</p>
        <p>Verify any payment in your bank/UPI app before activating the account.</p></div>"""
        await send_email(db, notify, f"EzySlot AI — {label}: {enq.get('proposal',{}).get('name','Company')}", html, kind="proposal_response")
    return HTMLResponse(f"""<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:620px;margin:50px auto;padding:24px;color:#1f2937">
    <h2 style="color:#15803d">Response recorded</h2><p>Thank you. Your response (<b>{_html_escape(label)}</b>) has been recorded and EzySlot AI has been notified.</p>
    <p>If you submitted payment, your account will be activated only after manual verification.</p></body></html>""")


@api.post("/enquiries/{enquiry_id}/verify-payment")
async def verify_enquiry_payment(enquiry_id: str, body: PaymentVerifyBody, user: dict = Depends(require_developer)):
    enq = await db.enquiries.find_one({"id": enquiry_id})
    if not enq:
        raise HTTPException(status_code=404, detail="Enquiry not found")
    proposal = enq.get("proposal")
    if not proposal:
        raise HTTPException(status_code=400, detail="Send a proposal before verifying payment")
    if enq.get("status") == "converted":
        raise HTTPException(status_code=400, detail="This enquiry is already activated")
    await db.enquiries.update_one({"id": enquiry_id}, {"$set": {
        "status": "payment_verified", "proposal.payment_status": "verified",
        "proposal.payment_verified_at": now_iso(), "proposal.payment_verified_by": user.get("email", ""),
        "proposal.transaction_reference": body.transaction_reference.strip(),
        "proposal.payment_notes": body.internal_notes.strip()
    }})
    # Provision only after manual verification. Idempotency is protected by the enquiry status check above.
    client_body = ClientCreate(
        name=proposal["name"], site_location=proposal["site_location"],
        contact_email=proposal["contact_email"], service_days=int(proposal["service_days"]),
        subscription_plan=proposal["plan_duration"], subscription_amount=float(proposal["amount"])
    )
    existing_user = await db.users.find_one({"email": str(client_body.contact_email).lower()})
    if existing_user:
        await db.enquiries.update_one({"id": enquiry_id}, {"$set": {"status": "payment_verified", "activation_error": "A user with this email already exists; resolve account linking manually."}})
        return {"ok": True, "status": "payment_verified", "activated": False, "message": "Payment recorded, but an account already exists for this email. Link the existing user/client manually."}
    client_doc = await _create_client(client_body)
    login_info = client_doc.pop("provisioned_login", None)
    await db.enquiries.update_one({"id": enquiry_id}, {"$set": {
        "status": "converted", "client_id": client_doc["id"], "activated_at": now_iso(),
        "proposal.payment_status": "verified"
    }, "$unset": {"activation_error": ""}})
    await log_activity(client_doc["id"], user["email"], "client.converted", f"Payment verified for enquiry {enq.get('name', '')}")
    if login_info:
        setup_timeline = (
            "within 2 working days after payment verification"
            if proposal.get("has_compatible_cameras", True)
            else "minimum 4–5 working days after payment verification; camera hardware and installation are quoted separately if required"
        )
        credential_html = f"""
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
          <h2 style="color:#15803d">Your EzySlot AI account is ready</h2>
          <p>Dear {_html_escape(proposal['name'])},</p>
          <p>Your payment has been manually verified and your subscription account has been created.</p>
          <p><b>Login email:</b> {_html_escape(login_info['email'])}<br>
          <b>Temporary password:</b> {_html_escape(login_info['password'])}</p>
          <p>Please sign in and change your password as soon as possible. Do not share these credentials.</p>
          <p><b>Deployment timeline:</b> { _html_escape(setup_timeline) }.</p>
          <p>If you did not expect this account email, contact EzySlot AI support.</p>
          <p>Regards,<br><b>EzySlot AI Team</b></p>
        </div>"""
        email_result = await send_email(db, str(client_body.contact_email), "EzySlot AI — account credentials and setup timeline", credential_html, kind="client_credentials")
        await db.enquiries.update_one({"id": enquiry_id}, {"$set": {"credentials_email_status": email_result.get("status", "unknown")}})
    return {"ok": True, "status": "converted", "activated": True, "client_id": client_doc["id"], "credentials_email_status": email_result.get("status", "not_created") if login_info else "not_created"}

@api.post("/enquiries/{enquiry_id}/convert")
async def convert_enquiry(enquiry_id: str, body: ClientCreate, user: dict = Depends(require_developer)):
    enq = await db.enquiries.find_one({"id": enquiry_id})
    if not enq:
        raise HTTPException(status_code=404, detail="Enquiry not found")
    raise HTTPException(
        status_code=400,
        detail="Direct conversion is disabled. Send a proposal and activate only after manual payment verification.",
    )
    client_doc = await _create_client(body)
    await db.enquiries.update_one({"id": enquiry_id}, {"$set": {"status": "converted", "client_id": client_doc["id"]}})
    await log_activity(client_doc["id"], user["email"], "client.converted", f"From enquiry {enq['name']}")
    return client_doc
async def _create_client(body: ClientCreate) -> dict:
    cid = str(uuid.uuid4())
    start = datetime.now(timezone.utc)
    end = start + timedelta(days=body.service_days)
    client_doc = {
        "id": cid, "name": body.name, "site_location": body.site_location,
        "contact_email": body.contact_email, "status": "active",
        "subscription_plan": body.subscription_plan,
        "subscription_amount": float(body.subscription_amount),
        "service_start": start.isoformat(), "service_end": end.isoformat(),
        "api_token": "sp_" + uuid.uuid4().hex,
        "fare_config": {"enabled": False, "type": "per_hour", "currency": "INR",
                        "per_hour": 40, "fixed": 100, "slabs": []},
        "created_at": now_iso(),
    }
    await db.clients.insert_one(dict(client_doc))
    # provision a client login
    temp_pw = "Client@" + uuid.uuid4().hex[:6]
    cuser = {"id": str(uuid.uuid4()), "email": body.contact_email.lower(),
             "name": body.name + " Admin", "role": "client", "client_id": cid,
             "password_hash": hash_password(temp_pw), "created_at": now_iso()}
    existing = await db.users.find_one({"email": body.contact_email.lower()})
    if not existing:
        await db.users.insert_one(cuser)
        client_doc["provisioned_login"] = {"email": body.contact_email.lower(), "password": temp_pw}
    client_doc.pop("_id", None)
    return client_doc
# ---------------- developer + client: clients ----------------
@api.get("/clients")
async def list_clients(user: dict = Depends(require_developer)):
    items = await db.clients.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for c in items:
        c["camera_count"] = await db.cameras.count_documents({"client_id": c["id"]})
    return {"clients": items}
@api.post("/clients")
async def create_client_direct(body: ClientCreate, user: dict = Depends(require_developer)):
    doc = await _create_client(body)
    await log_activity(doc["id"], user["email"], "client.created", body.name)
    return doc
@api.get("/me/client")
async def my_client(user: dict = Depends(get_current_user), client_id: Optional[str] = Query(None)):
    cid = scope_client_id(user, client_id)
    c = await db.clients.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Client not found")
    end = datetime.fromisoformat(c["service_end"])
    c["days_remaining"] = max(0, (end - datetime.now(timezone.utc)).days)
    c["expired"] = end < datetime.now(timezone.utc)
    return {"client": c}
def _default_fare_config() -> dict:
    return {
        "enabled": False, "type": "per_hour", "currency": "INR",
        "per_hour": 40, "per_interval": 20, "billing_interval_minutes": 60,
        "grace_period_minutes": 0, "charge_partial_interval": True,
        "fixed": 100, "slabs": [],
    }


def _normalize_fare_config(raw: Optional[dict]) -> dict:
    cfg = _default_fare_config()
    if isinstance(raw, dict):
        cfg.update({k: v for k, v in raw.items() if k in cfg})
    # Legacy fare records remain compatible with the previous per_hour/slabs UI.
    if cfg.get("type") not in {"per_hour", "per_interval", "fixed", "slabs"}:
        cfg["type"] = "per_hour"
    cfg["billing_interval_minutes"] = max(1, min(1440, int(cfg.get("billing_interval_minutes", 60) or 60)))
    cfg["grace_period_minutes"] = max(0, min(1440, int(cfg.get("grace_period_minutes", 0) or 0)))
    return cfg


@api.get("/fare")
async def get_my_fare(user: dict = Depends(get_current_user), client_id: Optional[str] = Query(None)):
    """Return fare settings for the authenticated client's own site."""
    cid = scope_client_id(user, client_id)
    client_doc = await db.clients.find_one({"id": cid}, {"_id": 0})
    if not client_doc:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"client_id": cid, "fare_config": _normalize_fare_config(client_doc.get("fare_config"))}


@api.put("/fare")
async def update_my_fare(body: FareBody, user: dict = Depends(get_current_user), client_id: Optional[str] = Query(None)):
    """Clients may change only their own site's fare configuration."""
    cid = scope_client_id(user, client_id)
    client_doc = await db.clients.find_one({"id": cid}, {"_id": 1})
    if not client_doc:
        raise HTTPException(status_code=404, detail="Client not found")
    cfg = body.model_dump()
    cfg["updated_at"] = now_iso()
    await db.clients.update_one({"id": cid}, {"$set": {"fare_config": cfg}})
    await log_activity(cid, user["email"], "fare.updated", f"Client updated fare rules: {cfg['type']} / enabled={cfg['enabled']}")
    return {"ok": True, "client_id": cid, "fare_config": cfg}


@api.put("/clients/{cid}/fare")
async def update_fare(cid: str, body: FareBody, user: dict = Depends(require_developer)):
    if not await db.clients.find_one({"id": cid}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Client not found")
    cfg = body.model_dump()
    cfg["updated_at"] = now_iso()
    await db.clients.update_one({"id": cid}, {"$set": {"fare_config": cfg}})
    await log_activity(cid, user["email"], "fare.updated", f"Developer updated fare rules: {cfg['type']} / enabled={cfg['enabled']}")
    return {"ok": True, "fare_config": cfg}


def _fare_amount(fare: dict, elapsed_seconds: float) -> float:
    """Calculate a transparent preview/running amount from the saved rate rules."""
    if not fare.get("enabled", False):
        return 0.0
    minutes = max(0.0, elapsed_seconds / 60.0 - float(fare.get("grace_period_minutes", 0) or 0))
    if minutes <= 0:
        return 0.0
    kind = fare.get("type", "per_hour")
    if kind == "fixed":
        return round(float(fare.get("fixed", 0) or 0), 2)
    if kind == "slabs":
        hours = minutes / 60.0
        slabs = sorted(fare.get("slabs", []), key=lambda x: float(x.get("upto_hours", 0) or 0))
        for slab in slabs:
            if hours <= float(slab.get("upto_hours", 0) or 0):
                return round(float(slab.get("price", 0) or 0), 2)
        return round(float(slabs[-1].get("price", 0) or 0), 2) if slabs else 0.0
    if kind == "per_interval":
        interval = max(1, int(fare.get("billing_interval_minutes", 30) or 30))
        units = (minutes / interval) if not fare.get("charge_partial_interval", True) else __import__("math").ceil(minutes / interval)
        return round(units * float(fare.get("per_interval", 0) or 0), 2)
    hours = minutes / 60.0
    units = hours if not fare.get("charge_partial_interval", True) else __import__("math").ceil(hours)
    return round(units * float(fare.get("per_hour", 0) or 0), 2)


async def _sync_parking_sessions(cam: dict, payload: dict):
    """Persist sessions only on observed transitions; never invent an entry time at startup."""
    cid, camera_id = cam.get("client_id"), cam.get("id")
    if not cid or not camera_id or payload.get("source") not in {"rtsp", "clip"}:
        return
    for row in payload.get("slots", []):
        slot_id = row.get("slot_id")
        status = row.get("status")
        if not slot_id or status not in {"FREE", "OCCUPIED", "UNKNOWN"}:
            continue
        cache = await db.slot_status_cache.find_one({"camera_id": camera_id, "slot_id": slot_id}, {"_id": 0})
        previous = cache.get("status") if cache else None
        await db.slot_status_cache.update_one(
            {"camera_id": camera_id, "slot_id": slot_id},
            {"$set": {"client_id": cid, "camera_id": camera_id, "slot_id": slot_id,
                       "label": row.get("label", slot_id), "status": status, "updated_at": now_iso()}},
            upsert=True,
        )
        # First observation only establishes a baseline. We cannot know when an already-present car arrived.
        if previous is None or previous == status:
            continue
        if previous != "OCCUPIED" and status == "OCCUPIED":
            active = await db.parking_sessions.find_one({"camera_id": camera_id, "slot_id": slot_id, "status": "active"}, {"_id": 0})
            if not active:
                await db.parking_sessions.insert_one({
                    "id": str(uuid.uuid4()), "client_id": cid, "camera_id": camera_id,
                    "camera_name": cam.get("name", "Camera"), "slot_id": slot_id,
                    "slot_label": row.get("label", slot_id), "entry_time": now_iso(),
                    "exit_time": None, "duration_seconds": 0, "amount": 0.0,
                    "currency": "INR", "status": "active", "rate_snapshot": None,
                    "plate_number": None, "created_at": now_iso(),
                })
        elif previous == "OCCUPIED" and status == "FREE":
            active = await db.parking_sessions.find_one({"camera_id": camera_id, "slot_id": slot_id, "status": "active"})
            if active:
                client_doc = await db.clients.find_one({"id": cid}, {"_id": 0, "fare_config": 1}) or {}
                fare = _normalize_fare_config(client_doc.get("fare_config"))
                entry = datetime.fromisoformat(active["entry_time"])
                now = datetime.now(timezone.utc)
                elapsed = max(0.0, (now - entry).total_seconds())
                amount = _fare_amount(fare, elapsed)
                await db.parking_sessions.update_one({"id": active["id"]}, {"$set": {
                    "exit_time": now.isoformat(), "duration_seconds": int(elapsed),
                    "amount": amount, "currency": fare.get("currency", "INR"),
                    "status": "completed", "rate_snapshot": fare,
                }})
                await db.parking_sessions.update_one({"id": active["id"]}, {"$unset": {"rate_snapshot.updated_at": ""}})


@api.get("/billing/sessions")
async def list_billing_sessions(user: dict = Depends(get_current_user), client_id: Optional[str] = Query(None),
                                status: Optional[str] = Query(None), limit: int = Query(100, ge=1, le=500)):
    cid = scope_client_id(user, client_id)
    query = {"client_id": cid}
    if status in {"active", "completed"}:
        query["status"] = status
    items = await db.parking_sessions.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    fare_doc = await db.clients.find_one({"id": cid}, {"_id": 0, "fare_config": 1}) or {}
    fare = _normalize_fare_config(fare_doc.get("fare_config"))
    now = datetime.now(timezone.utc)
    for item in items:
        if item.get("status") == "active":
            try:
                entry = datetime.fromisoformat(item["entry_time"])
                elapsed = max(0.0, (now - entry).total_seconds())
                item["duration_seconds"] = int(elapsed)
                item["amount"] = _fare_amount(fare, elapsed)
                item["currency"] = fare.get("currency", "INR")
            except (ValueError, TypeError, KeyError):
                pass
    return {"items": items, "fare_config": fare}
@api.put("/clients/{cid}/service")
async def update_service(cid: str, body: ServiceBody, user: dict = Depends(require_developer)):
    end = (datetime.now(timezone.utc) + timedelta(days=body.service_days)).isoformat()
    await db.clients.update_one({"id": cid}, {"$set": {"service_end": end}})
    await log_activity(cid, user["email"], "service.extended", f"{body.service_days} days")
    return {"ok": True}
# ---------------- known vehicles / number plates ----------------
@api.get("/known-vehicles")
async def list_known_vehicles(
    user: dict = Depends(get_current_user),
    client_id: Optional[str] = Query(None),
):
    cid = scope_client_id(user, client_id)
    items = await db.known_vehicles.find(
        {"client_id": cid}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    return {"vehicles": items}
@api.post("/known-vehicles")
async def add_known_vehicle(
    body: KnownVehicleCreate,
    user: dict = Depends(get_current_user),
    client_id: Optional[str] = Query(None),
):
    cid = scope_client_id(user, client_id)
    plate = " ".join(body.plate_number.upper().strip().split())
    if not plate:
        raise HTTPException(status_code=400, detail="Plate number is required")
    if not body.owner_name.strip():
        raise HTTPException(status_code=400, detail="Owner name is required")
    existing = await db.known_vehicles.find_one({
        "client_id": cid,
        "plate_number": plate,
    })
    if existing:
        raise HTTPException(
            status_code=409,
            detail="This plate number is already registered",
        )
    category = body.category.strip().lower() or "staff"
    if category not in {"staff", "authorized"}:
        raise HTTPException(
            status_code=400,
            detail="Category must be staff or authorized",
        )
    vehicle = {
        "id": str(uuid.uuid4()),
        "client_id": cid,
        "plate_number": plate,
        "owner_name": body.owner_name.strip(),
        "category": category,
        "vehicle_type": body.vehicle_type.strip().lower() or "car",
        "notes": body.notes.strip(),
        "created_at": now_iso(),
        "created_by": user["email"],
    }
    await db.known_vehicles.insert_one(dict(vehicle))
    await log_activity(cid, user["email"], "known_vehicle.added", plate)
    return {"vehicle": vehicle}

@api.get("/known-vehicles/template.csv")
async def known_vehicles_csv_template(user: dict = Depends(get_current_user)):
    content = "plate_number,owner_name,category,vehicle_type,notes\nMH20AB1234,Rohan Patil,staff,car,Morning shift\nMH20XY5678,Priya Shah,authorized,motorcycle,Visitor access\n"
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="ezyslot_vehicle_template.csv"'},
    )

@api.get("/known-vehicles/template.xlsx")
async def known_vehicles_xlsx_template(user: dict = Depends(get_current_user)):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel support is unavailable. Install openpyxl in the backend environment.")
    wb = Workbook()
    ws = wb.active
    ws.title = "Vehicles"
    headers = ["plate_number", "owner_name", "category", "vehicle_type", "notes"]
    ws.append(headers)
    ws.append(["MH20AB1234", "Rohan Patil", "staff", "car", "Morning shift"])
    ws.append(["MH20XY5678", "Priya Shah", "authorized", "motorcycle", "Visitor access"])
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="123047")
        cell.alignment = Alignment(horizontal="center")
    for i, width in enumerate([20, 26, 18, 20, 34], 1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"
    instructions = wb.create_sheet("Instructions")
    for row in [
        ["EzySlot AI — Vehicle Import Template"],
        ["Required columns: plate_number, owner_name, category, vehicle_type"],
        ["category must be staff or authorized"],
        ["vehicle_type examples: car, motorcycle, scooter, bicycle, bus, truck, auto-rickshaw, other"],
        ["Keep the column headers unchanged. Delete example rows before importing."],
        ["Plate numbers are normalized to uppercase. Duplicate plates for this client are skipped."],
    ]:
        instructions.append(row)
    instructions.column_dimensions["A"].width = 100
    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="ezyslot_vehicle_template.xlsx"'},
    )

@api.post("/known-vehicles/import")
async def import_known_vehicles(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    client_id: Optional[str] = Query(None),
):
    cid = scope_client_id(user, client_id)
    filename = (file.filename or "").lower()
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    try:
        if filename.endswith(".csv"):
            decoded = raw.decode("utf-8-sig")
            rows = list(csv.DictReader(io.StringIO(decoded)))
        elif filename.endswith(".xlsx"):
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            ws = wb["Vehicles"] if "Vehicles" in wb.sheetnames else wb.active
            values = ws.iter_rows(values_only=True)
            headers = [str(v or "").strip().lower() for v in next(values, [])]
            rows = [
                {headers[i]: (row[i] if i < len(row) else "") for i in range(len(headers))}
                for row in values
            ]
            wb.close()
        else:
            raise HTTPException(status_code=400, detail="Upload a .xlsx or .csv file.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read the file: {exc}")
    if not rows:
        raise HTTPException(status_code=400, detail="No vehicle rows found in the file.")
    imported, duplicates, invalid = [], [], []
    allowed_categories = {"staff", "authorized"}
    allowed_types = {"car", "motorcycle", "scooter", "bicycle", "bus", "truck", "auto-rickshaw", "other"}
    seen = set()
    existing_docs = await db.known_vehicles.find({"client_id": cid}, {"plate_number": 1}).to_list(10000)
    existing = {str(v.get("plate_number", "")).strip().upper() for v in existing_docs}
    for row_number, row in enumerate(rows, start=2):
        normalized = {str(k or "").strip().lower(): ("" if v is None else str(v).strip()) for k, v in row.items()}
        plate = " ".join(normalized.get("plate_number", "").upper().split())
        owner = normalized.get("owner_name", "").strip()
        category = normalized.get("category", "staff").strip().lower() or "staff"
        vehicle_type = normalized.get("vehicle_type", "car").strip().lower() or "car"
        notes = normalized.get("notes", "").strip()
        errors = []
        if not plate: errors.append("missing plate_number")
        if not owner: errors.append("missing owner_name")
        if category not in allowed_categories: errors.append("category must be staff or authorized")
        if vehicle_type not in allowed_types: errors.append("unsupported vehicle_type")
        if errors:
            invalid.append({"row": row_number, "plate_number": plate, "reason": ", ".join(errors)})
            continue
        if plate in existing or plate in seen:
            duplicates.append({"row": row_number, "plate_number": plate, "reason": "duplicate plate for this client"})
            continue
        seen.add(plate)
        vehicle = {
            "id": str(uuid.uuid4()), "client_id": cid, "plate_number": plate,
            "owner_name": owner, "category": category, "vehicle_type": vehicle_type,
            "notes": notes, "created_at": now_iso(), "created_by": user["email"],
        }
        imported.append(vehicle)
    if imported:
        await db.known_vehicles.insert_many([dict(v) for v in imported])
        await log_activity(cid, user["email"], "known_vehicles.imported", f"{len(imported)} vehicles")
    return {
        "ok": True,
        "imported_count": len(imported),
        "duplicate_count": len(duplicates),
        "invalid_count": len(invalid),
        "imported": imported,
        "duplicates": duplicates,
        "invalid": invalid,
    }

@api.delete("/known-vehicles/{vehicle_id}")
async def delete_known_vehicle(
    vehicle_id: str,
    user: dict = Depends(get_current_user),
):
    vehicle = await db.known_vehicles.find_one({"id": vehicle_id})
    if not vehicle:
        raise HTTPException(status_code=404, detail="Known vehicle not found")
    scope_client_id(user, vehicle["client_id"])
    await db.known_vehicles.delete_one({"id": vehicle_id})
    await log_activity(
        vehicle["client_id"],
        user["email"],
        "known_vehicle.deleted",
        vehicle["plate_number"],
    )
    return {"ok": True}
@api.post("/number-plate/recognize")
async def recognize_number_plate(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    client_id: Optional[str] = Query(None),
):
    """Read a plate-focused image and match it against registered vehicles."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Please upload an image file.",
        )
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file.")
    cid = scope_client_id(user, client_id)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp:
            temp.write(image_bytes)
            temp_path = temp.name
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None, read_number_plate, temp_path
        )
    except Exception as exc:
        logger.exception("Number plate recognition failed")
        raise HTTPException(
            status_code=500,
            detail="Number plate recognition failed.",
        ) from exc
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
    if not result.get("success") or not result.get("plate_number"):
        return {
            "success": False,
            "plate_number": None,
            "confidence": result.get("confidence", 0.0),
            "classification": "Unknown",
            "registered": False,
            "message": result.get(
                "message", "Could not read the number plate."
            ),
        }
    raw_plate = normalize_plate(result["plate_number"])
    # Keep the OCR readings and their confidence for transparent matching.
    primary_plate = normalize_plate(result["plate_number"])
    candidate_items = [{
        "plate": primary_plate,
        "confidence": float(result.get("confidence", 0.0) or 0.0),
        "source": "primary",
    }]
    for candidate in result.get("candidates", []):
        candidate_plate = normalize_plate(candidate.get("plate_number", ""))
        if candidate_plate and all(
            item["plate"] != candidate_plate for item in candidate_items
        ):
            candidate_items.append({
                "plate": candidate_plate,
                "confidence": float(candidate.get("confidence", 0.0) or 0.0),
                "source": "candidate",
            })
    vehicles = await db.known_vehicles.find(
        {"client_id": cid},
        {"_id": 0},
    ).to_list(1000)
    normalized_vehicles = [
        (vehicle, normalize_plate(vehicle.get("plate_number", "")))
        for vehicle in vehicles
    ]
    matched = None
    matched_plate = None
    match_method = None
    matched_item = None
    # First preference: exact OCR match.
    for item in candidate_items:
        exact = next(
            (
                (vehicle, registered_plate)
                for vehicle, registered_plate in normalized_vehicles
                if registered_plate and registered_plate == item["plate"]
            ),
            None,
        )
        if exact:
            matched, matched_plate = exact
            matched_item = item
            match_method = "exact_ocr_candidate"
            break
    def plate_format_variants(plate: str) -> set[str]:
        """
        Generate conservative variants for the common 10-character Indian
        private plate format SS00SS0000. These variants are used only to
        compare against an already registered plate for this client.
        """
        plate = normalize_plate(plate)
        variants = {plate}
        # OCR sometimes appends one extra character; consider removing only
        # one trailing character, and only when the resulting format is 10 chars.
        if len(plate) == 11:
            variants.add(plate[:10])
        for candidate in list(variants):
            if len(candidate) != 10:
                continue
            chars = list(candidate)
            # State letters: digit-like OCR symbols to letters.
            state_map = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B"}
            for i in (0, 1):
                chars[i] = state_map.get(chars[i], chars[i])
            # RTO digits: letter-like OCR symbols to digits.
            rto_map = {"O": "0", "Q": "0", "D": "0", "I": "1",
                       "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6"}
            for i in (2, 3):
                chars[i] = rto_map.get(chars[i], chars[i])
            # Series letters.
            series_map = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B"}
            for i in (4, 5):
                chars[i] = series_map.get(chars[i], chars[i])
            # Final registration digits.
            for i in range(6, 10):
                chars[i] = rto_map.get(chars[i], chars[i])
            variants.add("".join(chars))
        return variants
    # Second preference: use position-aware OCR confusion correction and
    # one trailing-character removal, but only accept a unique registered
    # plate match within this client's own vehicle list.
    if not matched:
        possible_matches = {}
        for item in candidate_items:
            for variant in plate_format_variants(item["plate"]):
                for vehicle, registered_plate in normalized_vehicles:
                    if registered_plate and registered_plate == variant:
                        possible_matches[registered_plate] = (
                            vehicle, registered_plate, item, variant
                        )
        if len(possible_matches) == 1:
            matched, matched_plate, matched_item, _variant = next(
                iter(possible_matches.values())
            )
            match_method = "position_corrected_ocr_candidate"
            logger.warning(
                "Position-corrected OCR match: OCR=%r registered=%r client_id=%r",
                matched_item["plate"], matched_plate, cid
            )
    vehicle_info = None
    classification = "Unknown"
    if matched:
        category = str(matched.get("category", "authorized")).lower()
        classification = "Staff" if category == "staff" else "Authorized"
        vehicle_info = {
            "owner_name": matched.get("owner_name"),
            "vehicle_type": matched.get("vehicle_type", "car"),
            "category": category,
        }
    return {
        "success": True,
        "plate_number": matched_plate or primary_plate,
        "raw_plate_number": primary_plate,
        "confidence": result.get("confidence", 0.0),
        "classification": classification,
        "registered": matched is not None,
        "vehicle": vehicle_info,
        "match_method": match_method,
        "ocr_candidates": [
            {
                "plate_number": item["plate"],
                "confidence": round(item["confidence"], 3),
                "source": item["source"],
            }
            for item in candidate_items
        ],
        "message": (
            "Registered vehicle matched."
            if matched
            else "Plate read successfully, but no matching vehicle is registered."
        ),
    }
# ---------------- full-image plate detection ----------------
@api.post("/number-plate/detect-and-recognize")
async def detect_and_recognize_number_plates(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    client_id: Optional[str] = Query(None),
):
    """
    Detect plates in a full image and reuse the existing
    recognition endpoint for each detected plate crop.
    Existing OCR and matching logic remain unchanged.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Please upload an image file.",
        )
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Empty image file.",
        )
    # Validate client access before processing.
    cid = scope_client_id(user, client_id)
    try:
        loop = asyncio.get_running_loop()
        plates = await loop.run_in_executor(
            None,
            plate_detector.detect_license_plates,
            image_bytes,
        )
    except Exception as exc:
        logger.exception("License plate detection failed")
        raise HTTPException(
            status_code=500,
            detail="License plate detection failed.",
        ) from exc
    results = []
    # Reuse the original recognition endpoint for every crop.
    for index, plate in enumerate(plates):
        crop_file = UploadFile(
            filename=f"plate_{index + 1}.jpg",
            file=BytesIO(plate["crop_bytes"]),
            headers=Headers({
                "content-type": "image/jpeg",
            }),
        )
        try:
            recognition = await recognize_number_plate(
                file=crop_file,
                user=user,
                client_id=cid,
            )
        finally:
            await crop_file.close()
        results.append({
            "plate_index": index + 1,
            "box": plate["box"],
            "detection_confidence": plate["confidence"],
            "recognition": recognition,
        })
    # Persist this scan so the dashboard can display recent recognition history.
    scan_record = {
        "id": str(uuid.uuid4()),
        "client_id": cid,
        "scanned_by": user.get("email"),
        "plates_detected": len(results),
        "results": [
            {
                "plate_index": item["plate_index"],
                "box": item["box"],
                "detection_confidence": item["detection_confidence"],
                "recognition": item["recognition"],
            }
            for item in results
        ],
        "created_at": now_iso(),
    }
    await db.number_plate_scans.insert_one(dict(scan_record))

    return {
        "success": True,
        "camera_image_processed": True,
        "plates_detected": len(results),
        "results": results,
        "scan_id": scan_record["id"],
        "message": (
            "Plate detection and recognition completed."
            if results
            else "No number plates detected in this image."
        ),
    }


@api.get("/number-plate/history")
async def number_plate_scan_history(
    user: dict = Depends(get_current_user),
    client_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """Return recent full-image plate scans for the authorized client."""
    cid = scope_client_id(user, client_id)
    items = await db.number_plate_scans.find(
        {"client_id": cid}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    return {"scans": items, "count": len(items)}


# ---------------- cameras ----------------
@api.get("/cameras")
async def list_cameras(user: dict = Depends(get_current_user), client_id: Optional[str] = Query(None)):
    cid = scope_client_id(user, client_id)
    cams = await db.cameras.find({"client_id": cid}, {"_id": 0}).to_list(1000)
    for cam in cams:
        cam["slot_count"] = await db.slots.count_documents({"camera_id": cam["id"]})
    return {"cameras": cams}
@api.post("/cameras")
async def add_camera(user: dict = Depends(require_developer), client_id: str = Form(...),
                     name: str = Form(...), snapshot_url: str = Form(""),
                     rtsp_url: str = Form(""), snapshot: Optional[UploadFile] = File(None)):
    snap = snapshot_url
    if snapshot is not None:
        content = await snapshot.read()
        if content:
            path = f"{storage.APP_NAME}/cameras/{uuid.uuid4()}.jpg"
            try:
                storage.put_object(path, content, snapshot.content_type or "image/jpeg")
                snap = f"/api/files/{path}"
            except Exception as e:
                logger.warning(f"camera snapshot upload failed: {e}")
    if not await db.clients.find_one({"id": client_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Client not found")
    cam = {"id": str(uuid.uuid4()), "client_id": client_id, "name": name,
           "snapshot": snap or "", "rtsp_url": rtsp_url.strip(),
           "parking_configured": False,
           "status": "offline", "connection_status": "disconnected", "created_at": now_iso()}
    await db.cameras.insert_one(dict(cam))
    await log_activity(client_id, user["email"], "camera.added", name)
    cam.pop("_id", None)
    return {"camera": cam}
@api.delete("/cameras/{camera_id}")
async def delete_camera(camera_id: str, user: dict = Depends(require_developer)):
    cam = await db.cameras.find_one({"id": camera_id})
    if cam:
        await db.slots.delete_many({"camera_id": camera_id})
        await db.clip_frames.delete_many({"camera_id": camera_id})
        await db.cameras.delete_one({"id": camera_id})
        _stop_rtsp_worker(camera_id)
        OCC.pop(camera_id, None)
        CLIP.pop(camera_id, None)
        LAST_CLIP_STATE.pop(camera_id, None)
        VIDEO_JOBS.pop(camera_id, None)
        await log_activity(cam["client_id"], user["email"], "camera.deleted", cam["name"])
    return {"ok": True}
# ---------------- slots / polygons ----------------
@api.get("/cameras/{camera_id}/slots")
async def get_slots(camera_id: str, user: dict = Depends(get_current_user)):
    cam = await db.cameras.find_one({"id": camera_id}, {"_id": 0})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    scope_client_id(user, cam["client_id"])
    slots = await db.slots.find({"camera_id": camera_id}, {"_id": 0}).to_list(1000)
    return {"slots": slots, "camera": cam}
@api.put("/cameras/{camera_id}/slots")
async def save_slots(camera_id: str, body: SlotSaveBody, user: dict = Depends(require_developer)):
    cam = await db.cameras.find_one({"id": camera_id})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    await db.slots.delete_many({"camera_id": camera_id})
    docs = []
    for s in body.slots:
        docs.append({"id": s.get("id") or str(uuid.uuid4()), "client_id": cam["client_id"],
                     "camera_id": camera_id, "label": s["label"], "polygon": s["polygon"],
                     "created_at": now_iso()})
    if docs:
        await db.slots.insert_many([dict(d) for d in docs])
    if cam.get("clip_ready"):
        OCC.pop(camera_id, None)
        try:
            await recompute_and_cache(camera_id)
        except Exception:
            pass
    else:
        # Saving slot polygons is the explicit developer action that marks this
        # camera as configured for parking analysis. An empty slot list disables it.
        await db.cameras.update_one(
            {"id": camera_id},
            {"$set": {"parking_configured": bool(docs)}}
        )
        OCC.pop(camera_id, None)
        try:
            await _init_occupancy()
        except Exception:
            pass
    await log_activity(cam["client_id"], user["email"], "slots.saved", f"{len(docs)} slots on {cam['name']}")
    for d in docs:
        d.pop("_id", None)
    return {"ok": True, "slots": docs}
# ---------------- live occupancy (pull) ----------------
@api.get("/cameras/{camera_id}/rtsp-frame")
async def rtsp_camera_frame(camera_id: str, user: dict = Depends(get_current_user)):
    """Return the latest real RTSP frame for the authorized client's camera."""
    cam = await db.cameras.find_one({"id": camera_id}, {"_id": 0})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    scope_client_id(user, cam["client_id"])
    if cam.get("connection_status") == "disconnected":
        raise HTTPException(status_code=409, detail="Camera is disconnected. Connect it from the Developer portal.")
    url = str(cam.get("rtsp_url") or RTSP_URL).strip()
    if not url:
        raise HTTPException(status_code=503, detail="No RTSP URL configured for this camera.")
    if not cam.get("rtsp_url"):
        await db.cameras.update_one({"id": camera_id}, {"$set": {"rtsp_url": url, "connection_status": "connecting", "status": "connecting"}})
    _start_rtsp_worker(camera_id, url)
    frame_bytes = _get_rtsp_frame(camera_id)
    if not frame_bytes:
        raise HTTPException(status_code=503, detail="Waiting for the first RTSP frame. Retry shortly.")
    await db.cameras.update_one({"id": camera_id}, {"$set": {"connection_status": "connected", "status": "online"}})
    return Response(content=frame_bytes, media_type="image/jpeg", headers={"Cache-Control": "no-store, max-age=0"})

@api.post("/cameras/{camera_id}/connect")
async def connect_camera(camera_id: str, user: dict = Depends(require_developer)):
    """Connect a provisioned camera using its saved RTSP URL or configured local fallback."""
    cam = await db.cameras.find_one({"id": camera_id}, {"_id": 0})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    url = str(cam.get("rtsp_url") or RTSP_URL).strip()
    if not url:
        raise HTTPException(status_code=400, detail="No RTSP URL saved for this camera.")
    await db.cameras.update_one({"id": camera_id}, {"$set": {"connection_status": "connecting", "status": "connecting", "rtsp_url": url}})
    _start_rtsp_worker(camera_id, url)
    await log_activity(cam["client_id"], user["email"], "camera.connect_requested", cam["name"])
    return {"ok": True, "camera_id": camera_id, "connection_status": "connecting", "message": "Connection requested; wait for the first frame."}

@api.post("/cameras/{camera_id}/disconnect")
async def disconnect_camera(camera_id: str, user: dict = Depends(require_developer)):
    cam = await db.cameras.find_one({"id": camera_id}, {"_id": 0})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    await db.cameras.update_one({"id": camera_id}, {"$set": {"connection_status": "disconnected", "status": "offline"}})
    _stop_rtsp_worker(camera_id)
    OCC.pop(camera_id, None)
    await log_activity(cam["client_id"], user["email"], "camera.disconnected", cam["name"])
    return {"ok": True, "camera_id": camera_id, "connection_status": "disconnected"}

@api.get("/cameras/{camera_id}/live")
async def live_occupancy(camera_id: str, user: dict = Depends(get_current_user)):
    cam = await db.cameras.find_one({"id": camera_id}, {"_id": 0})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    scope_client_id(user, cam["client_id"])
    if camera_id in CLIP and CLIP[camera_id]["frames"]:
        c = CLIP[camera_id]
        payload = dict(c["frames"][c["idx"]])
        payload["timestamp"] = now_iso()
        return payload
    if cam.get("connection_status") == "disconnected":
        return {"camera_id": camera_id, "camera_name": cam["name"], "source": "disconnected",
                "status": "disconnected", "slots": [], "free": 0, "occupied": 0,
                "unknown": 0, "total": 0, "nearest_free": None, "timestamp": now_iso()}
    frame_bytes = _get_rtsp_frame(camera_id)
    if frame_bytes:
        try:
            return await _analyse_rtsp_occupancy(cam, frame_bytes)
        except Exception as exc:
            logger.warning("Live occupancy analysis failed for %s: %s", camera_id, exc)
    return {"camera_id": camera_id, "camera_name": cam["name"], "source": "unavailable",
            "status": "waiting_for_frame", "slots": [], "free": 0, "occupied": 0,
            "unknown": 0, "total": 0, "nearest_free": None, "timestamp": now_iso()}
# ---------------- video clip upload + real detection ----------------
@api.post("/cameras/{camera_id}/video")
async def upload_video(camera_id: str, video: UploadFile = File(...), user: dict = Depends(require_developer)):
    cam = await db.cameras.find_one({"id": camera_id})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    data = await video.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty video file")
    vpath = f"{storage.APP_NAME}/videos/{camera_id}/{uuid.uuid4()}.mp4"
    try:
        storage.put_object(vpath, data, video.content_type or "video/mp4")
        await db.cameras.update_one({"id": camera_id}, {"$set": {"clip_source": vpath}})
    except Exception as e:
        logger.warning(f"video store failed: {e}")
    asyncio.create_task(process_video(camera_id, data))
    return {"ok": True, "status": "processing", "camera_id": camera_id}
@api.get("/cameras/{camera_id}/video/status")
async def video_status(camera_id: str, user: dict = Depends(get_current_user)):
    cam = await db.cameras.find_one({"id": camera_id}, {"_id": 0})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    scope_client_id(user, cam["client_id"])
    job = VIDEO_JOBS.get(camera_id)
    if job:
        return job
    return {"status": "done" if cam.get("clip_ready") else "idle",
            "processed": cam.get("clip_frames", 0), "total": cam.get("clip_frames", 0)}
@api.get("/cameras/{camera_id}/clip")
async def get_clip(camera_id: str, user: dict = Depends(get_current_user)):
    """Full processed clip sequence for client-side playback (play/pause/scrub)."""
    cam = await db.cameras.find_one({"id": camera_id}, {"_id": 0})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    scope_client_id(user, cam["client_id"])
    c = CLIP.get(camera_id)
    if not c or not c["frames"]:
        return {"clip": False, "frames": []}
    return {"clip": True, "camera_id": camera_id, "camera_name": cam["name"],
            "count": len(c["frames"]), "frames": c["frames"]}
# ---------------- history ----------------
@api.get("/history")
async def history(user: dict = Depends(get_current_user), client_id: Optional[str] = Query(None),
                  kind: str = Query("snapshots"), limit: int = Query(100)):
    cid = scope_client_id(user, client_id)
    if kind == "events":
        items = await db.slot_events.find({"client_id": cid}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    else:
        items = await db.detections.find({"client_id": cid}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return {"items": items}
# ---------------- tickets ----------------
@api.get("/tickets")
async def list_tickets(user: dict = Depends(get_current_user), client_id: Optional[str] = Query(None)):
    if user["role"] == "developer":
        q = {"client_id": client_id} if client_id else {}
    else:
        q = {"client_id": user["client_id"]}
    items = await db.tickets.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"tickets": items}
@api.post("/tickets")
async def create_ticket(body: TicketBody, user: dict = Depends(get_current_user),
                        client_id: Optional[str] = Query(None)):
    cid = scope_client_id(user, client_id)
    doc = {"id": str(uuid.uuid4()), "client_id": cid, "subject": body.subject,
           "description": body.description, "priority": body.priority, "status": "open",
           "created_by": user["email"], "responses": [],
           "created_at": now_iso(), "updated_at": now_iso()}
    await db.tickets.insert_one(dict(doc))
    await log_activity(cid, user["email"], "ticket.created", body.subject)
    doc.pop("_id", None)
    return {"ticket": doc}
@api.put("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, body: TicketUpdate, user: dict = Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    scope_client_id(user, t["client_id"])
    update = {"updated_at": now_iso()}
    if body.status:
        update["status"] = body.status
    push = None
    if body.response:
        push = {"by": user["email"], "role": user["role"], "text": body.response, "at": now_iso()}
    ops = {"$set": update}
    if push:
        ops["$push"] = {"responses": push}
    await db.tickets.update_one({"id": ticket_id}, ops)
    await log_activity(t["client_id"], user["email"], "ticket.updated", f"{ticket_id[:8]} -> {body.status or 'reply'}")
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    return {"ticket": t}
# ---------------- activity + stats + health ----------------
@api.get("/activity")
async def activity(user: dict = Depends(get_current_user), client_id: Optional[str] = Query(None), limit: int = 100):
    if user["role"] == "developer":
        q = {"client_id": client_id} if client_id else {}
    else:
        q = {"client_id": user["client_id"]}
    items = await db.activity_logs.find(q, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return {"activity": items}
@api.get("/stats/overview")
async def stats_overview(user: dict = Depends(require_developer)):
    clients = await db.clients.count_documents({})
    cameras = await db.cameras.count_documents({})
    open_tickets = await db.tickets.count_documents({"status": {"$ne": "resolved"}})
    new_enq = await db.enquiries.count_documents({"status": "new"})
    total_free = total_occ = total_unk = 0
    for state in OCC.values():
        for v in state.values():
            if v["status"] == "FREE":
                total_free += 1
            elif v["status"] == "OCCUPIED":
                total_occ += 1
            else:
                total_unk += 1
    recent = await db.detections.find({}, {"_id": 0}).sort("timestamp", -1).to_list(20)
    return {
        "clients": clients, "cameras": cameras, "open_tickets": open_tickets,
        "new_enquiries": new_enq, "occupancy": {"free": total_free, "occupied": total_occ, "unknown": total_unk},
        "model_ready": detection.model_ready(), "inference_ms": random.randint(38, 72),
        "recent_snapshots": recent,
    }
@api.get("/system/health")
async def system_health(user: dict = Depends(require_developer)):
    cams = await db.cameras.find({}, {"_id": 0}).to_list(1000)
    email_backlog = await db.email_queue.count_documents({"status": "queued"})
    return {
        "model_ready": detection.model_ready(),
        "cameras": [{"id": c["id"], "name": c["name"], "status": c.get("status", "online"),
                     "client_id": c["client_id"]} for c in cams],
        "db": "connected", "websocket_rooms": len(manager.rooms),
        "email_backlog": email_backlog, "inference_ms": random.randint(38, 72),
        "uptime": now_iso(),
    }
# ---------------- file serving ----------------
@api.get("/files/{path:path}")
async def serve_file(
    path: str,
    request: Request,
    auth: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """Serve camera assets only to authenticated users with the right tenant scope.

    Supports bearer headers, the existing auth query parameter used by image URLs,
    and the existing access_token cookie.
    """
    token = auth
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    asset_query = {"$or": [
        {"snapshot": f"/api/files/{path}"},
        {"snapshot": path},
        {"clip_source": path},
    ]}
    if user.get("role") == "developer":
        camera = await db.cameras.find_one(asset_query)
    else:
        cid = scope_client_id(user, None)
        camera = await db.cameras.find_one({"client_id": cid, **asset_query})
    if not camera:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        data, ctype = storage.get_object(path)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=data, media_type=ctype)
# ---------------- websocket ----------------
@api.websocket("/ws/{client_id}")
async def ws_endpoint(websocket: WebSocket, client_id: str, token: str = Query(None)):
    ok = False
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
            if payload["role"] == "developer" or payload.get("client_id") == client_id:
                ok = True
        except Exception:
            ok = False
    if not ok:
        await websocket.close(code=4401)
        return
    await manager.connect(client_id, websocket)
    try:
        cams = await db.cameras.find({"client_id": client_id}, {"_id": 0}).to_list(1000)
        for cam in cams:
            state = OCC.get(cam["id"])
            if state:
                p = _snapshot_payload(cam, state)
                p["type"] = "occupancy"
                await websocket.send_json(p)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(client_id, websocket)
    except Exception:
        manager.disconnect(client_id, websocket)
# ---------------- seed ----------------
def _grid_polygons(rows, cols, prefix, top=0.28, bottom=0.92):
    """Generate a grid of slot polygons in normalized coords laid out like a parking lot."""
    slots = []
    row_h = (bottom - top) / rows
    for r in range(rows):
        y1 = top + r * row_h + 0.02
        y2 = top + (r + 1) * row_h - 0.02
        col_w = (0.95 - 0.05) / cols
        for c in range(cols):
            x1 = 0.05 + c * col_w + 0.008
            x2 = 0.05 + (c + 1) * col_w - 0.008
            slots.append({
                "id": str(uuid.uuid4()),
                "label": f"{prefix}-{r * cols + c + 1}",
                "polygon": [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
            })
    return slots
async def seed():
    await db.users.create_index("email", unique=True)
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_pw = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({"id": str(uuid.uuid4()), "email": admin_email, "name": "Revati (Developer)",
                                   "role": "developer", "client_id": None,
                                   "password_hash": hash_password(admin_pw), "created_at": now_iso()})
    elif not verify_password(admin_pw, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_pw)}})
    if await db.clients.count_documents({}) > 0:
        return  # demo already seeded
    cid = str(uuid.uuid4())
    start = datetime.now(timezone.utc)
    await db.clients.insert_one({
        "id": cid, "name": "Metro Mall Parking", "site_location": "Downtown Metro Mall, Bengaluru",
        "contact_email": os.environ["CLIENT_EMAIL"].lower(), "status": "active",
        "service_start": start.isoformat(), "service_end": (start + timedelta(days=180)).isoformat(),
        "api_token": "sp_" + uuid.uuid4().hex,
        "fare_config": {"enabled": False, "type": "per_hour", "currency": "INR",
                        "per_hour": 40, "per_interval": 20, "billing_interval_minutes": 60,
                        "grace_period_minutes": 0, "charge_partial_interval": True,
                        "fixed": 100, "slabs": [], "updated_at": now_iso()},
        "created_at": now_iso(),
    })
    await db.users.insert_one({"id": str(uuid.uuid4()), "email": os.environ["CLIENT_EMAIL"].lower(),
                               "name": "Metro Mall Admin", "role": "client", "client_id": cid,
                               "password_hash": hash_password(os.environ["CLIENT_PASSWORD"]),
                               "created_at": now_iso()})
    cam_defs = [
        ("Level 1 — North Deck", DEMO_IMAGES[0], "A", 2, 5),
        ("Level 2 — East Wing", DEMO_IMAGES[1], "B", 2, 4),
        ("Rooftop — Open Deck", DEMO_IMAGES[2], "C", 2, 6),
    ]
    for name, snap, prefix, rows, cols in cam_defs:
        camid = str(uuid.uuid4())
        await db.cameras.insert_one({"id": camid, "client_id": cid, "name": name, "snapshot": snap,
                                     "status": "online", "created_at": now_iso()})
        slots = _grid_polygons(rows, cols, prefix)
        await db.slots.insert_many([{**s, "client_id": cid, "camera_id": camid, "created_at": now_iso()}
                                    for s in slots])
    await db.enquiries.insert_one({
        "id": str(uuid.uuid4()), "name": "Arjun Mehta", "email": "arjun@techpark.com",
        "company": "TechPark Estates", "site_location": "Whitefield IT Park, Bengaluru",
        "camera_count": 6, "message": "Need real-time slot monitoring for our 3-tower campus parking.",
        "reference_image": None, "status": "new", "created_at": now_iso(),
    })
    await db.tickets.insert_one({
        "id": str(uuid.uuid4()), "client_id": cid, "subject": "Camera 2 feed flickering at night",
        "description": "Level 2 East Wing feed drops briefly around 9pm daily.",
        "priority": "medium", "status": "open", "created_by": os.environ["CLIENT_EMAIL"].lower(),
        "responses": [], "created_at": now_iso(), "updated_at": now_iso(),
    })
    await log_activity(cid, "system", "demo.seeded", "Metro Mall Parking demo provisioned")
    logger.info("Demo data seeded.")
app.include_router(api)
app.add_middleware(
    CORSMiddleware, allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"],
)
@app.on_event("startup")
async def on_startup():
    try:
        await seed()
    except Exception as e:
        logger.warning(f"seed error: {e}")
    try:
        storage.init_storage()
    except Exception as e:
        logger.warning(f"storage init failed: {e}")
    asyncio.create_task(occupancy_loop())
@app.on_event("shutdown")
async def on_shutdown():
    client.close()
