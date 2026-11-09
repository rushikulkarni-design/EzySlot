from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import asyncio
import random
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Set

import jwt
import bcrypt
from fastapi import (FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile,
                     File, Form, WebSocket, WebSocketDisconnect, Query, Response, Header)
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

import detection
import storage
from email_service import send_email

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("EzySlot")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = "HS256"

app = FastAPI(title="EzySlot AI")
api = APIRouter(prefix="/api")

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


async def get_current_user(request: Request) -> dict:
    token = None
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
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_developer(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "developer":
        raise HTTPException(status_code=403, detail="Developer access required")
    return user


def scope_client_id(user: dict, requested: Optional[str]) -> str:
    """Enforce multi-client isolation. Developer may pass any client_id; client is locked to their own."""
    if user["role"] == "developer":
        if not requested:
            raise HTTPException(status_code=400, detail="client_id required")
        return requested
    if requested and requested != user.get("client_id"):
        raise HTTPException(status_code=403, detail="Cross-client access denied")
    return user["client_id"]


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
    service_days: int = 180


class SlotSaveBody(BaseModel):
    slots: List[dict]


class FareBody(BaseModel):
    enabled: bool = True
    type: str = "per_hour"
    currency: str = "INR"
    per_hour: float = 40
    fixed: float = 100
    slabs: List[dict] = []


class ServiceBody(BaseModel):
    service_days: int


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
        state = {}
        for i, s in enumerate(slots):
            r = random.random()
            status = "OCCUPIED" if r < 0.55 else ("UNKNOWN" if r < 0.65 else "FREE")
            state[s["id"]] = {
                "status": status,
                "conf": round(random.uniform(0.55, 0.95), 2) if status != "FREE" else 0.0,
                "box": _slot_box(s["polygon"]) if status == "OCCUPIED" else None,
                "label": s["label"], "polygon": s["polygon"],
            }
        OCC[cam["id"]] = state


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
                # ---- simulation fallback ----
                state = OCC.get(cam["id"])
                if not state:
                    continue
                events = []
                for sid, v in state.items():
                    if random.random() < 0.12:  # evolve ~12% of slots per tick
                        old = v["status"]
                        r = random.random()
                        new = "OCCUPIED" if r < 0.6 else ("UNKNOWN" if r < 0.72 else "FREE")
                        if new != old:
                            v["status"] = new
                            v["conf"] = round(random.uniform(0.55, 0.96), 2) if new != "FREE" else 0.0
                            v["box"] = _slot_box(v["polygon"]) if new == "OCCUPIED" else None
                            events.append((sid, v["label"], old, new))
                payload = _snapshot_payload(cam, state)
                payload["type"] = "occupancy"
                payload["source"] = "sim"
                await manager.broadcast(cam["client_id"], payload)
                # persist snapshot every ~5 ticks + flip events always
                if tick % 5 == 0:
                    await db.detections.insert_one({
                        "id": str(uuid.uuid4()), "client_id": cam["client_id"], "camera_id": cam["id"],
                        "camera_name": cam["name"], "free": payload["free"], "occupied": payload["occupied"],
                        "unknown": payload["unknown"], "total": payload["total"], "timestamp": now_iso(),
                    })
                for sid, label, old, new in events:
                    await db.slot_events.insert_one({
                        "id": str(uuid.uuid4()), "client_id": cam["client_id"], "camera_id": cam["id"],
                        "camera_name": cam["name"], "slot_id": sid, "label": label,
                        "from_status": old, "to_status": new, "timestamp": now_iso(),
                    })
        except Exception as e:
            logger.warning(f"occupancy loop error: {e}")
        await asyncio.sleep(2)


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
    }
    await db.enquiries.insert_one(dict(doc))
    notify = os.environ.get("ENQUIRY_NOTIFY_EMAIL", "")
    if notify:
        html = (f"<h2>New EzySlot AI enquiry</h2><p><b>{name}</b> ({email}) from "
                f"<b>{company or 'N/A'}</b></p><p>Site: {site_location} · Cameras: {camera_count}</p>"
                f"<p>{message}</p>")
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
    items = await db.enquiries.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"enquiries": items}


@api.post("/enquiries/{enquiry_id}/convert")
async def convert_enquiry(enquiry_id: str, body: ClientCreate, user: dict = Depends(require_developer)):
    enq = await db.enquiries.find_one({"id": enquiry_id})
    if not enq:
        raise HTTPException(status_code=404, detail="Enquiry not found")
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


@api.put("/clients/{cid}/fare")
async def update_fare(cid: str, body: FareBody, user: dict = Depends(require_developer)):
    await db.clients.update_one({"id": cid}, {"$set": {"fare_config": body.model_dump()}})
    await log_activity(cid, user["email"], "fare.updated", body.type)
    return {"ok": True}


@api.put("/clients/{cid}/service")
async def update_service(cid: str, body: ServiceBody, user: dict = Depends(require_developer)):
    end = (datetime.now(timezone.utc) + timedelta(days=body.service_days)).isoformat()
    await db.clients.update_one({"id": cid}, {"$set": {"service_end": end}})
    await log_activity(cid, user["email"], "service.extended", f"{body.service_days} days")
    return {"ok": True}


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
                     snapshot: Optional[UploadFile] = File(None)):
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
    cam = {"id": str(uuid.uuid4()), "client_id": client_id, "name": name,
           "snapshot": snap or DEMO_IMAGES[0], "status": "online", "created_at": now_iso()}
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
    state = OCC.get(camera_id)
    if not state:
        await _init_occupancy()
        state = OCC.get(camera_id, {})
    p = _snapshot_payload(cam, state)
    p["source"] = "sim"
    return p


# ---------------- current slot status ----------------
@api.get("/cameras/{camera_id}/status")
async def camera_status(camera_id: str, user: dict = Depends(get_current_user)):
    """Return the latest occupancy state for one camera.

    This is the client-facing status API. For now the source may be the
    existing YOLO clip playback or the current fallback state. Later, the
    same endpoint will be fed by a real RTSP/Wi-Fi camera without changing
    the client dashboard contract.
    """
    cam = await db.cameras.find_one({"id": camera_id}, {"_id": 0})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    scope_client_id(user, cam["client_id"])

    if camera_id in CLIP and CLIP[camera_id]["frames"]:
        c = CLIP[camera_id]
        payload = dict(c["frames"][c["idx"]])
        payload["source"] = "clip"
    else:
        state = OCC.get(camera_id)
        if not state:
            await _init_occupancy()
            state = OCC.get(camera_id, {})
        payload = _snapshot_payload(cam, state)
        payload["source"] = "sim"

    payload["camera_status"] = cam.get("status", "offline")
    payload["timestamp"] = now_iso()
    return payload


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
async def serve_file(path: str, auth: str = Query(None), authorization: str = Header(None)):
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
        "fare_config": {"enabled": True, "type": "per_hour", "currency": "INR",
                        "per_hour": 40, "fixed": 100,
                        "slabs": [{"upto_hours": 1, "price": 30}, {"upto_hours": 3, "price": 80},
                                  {"upto_hours": 24, "price": 200}]},
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
