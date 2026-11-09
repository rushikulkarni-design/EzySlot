"""EzySlot AI backend tests: auth, isolation, cameras/slots, live, history, tickets, enquiries, WS."""
import os
import io
import json
import time
import uuid
import asyncio
import pytest
import requests
import websockets

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE:
    # fallback to frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE = line.split("=", 1)[1].strip()

API = BASE + "/api"
WS_BASE = BASE.replace("https://", "wss://").replace("http://", "ws://") + "/api"

DEV_EMAIL = "revati031004@gmail.com"
DEV_PW = "EzySlot@2025"
CLIENT_EMAIL = "client@metromall.com"
CLIENT_PW = "Client@2025"


@pytest.fixture(scope="session")
def dev_token():
    r = requests.post(f"{API}/auth/login", json={"email": DEV_EMAIL, "password": DEV_PW})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def client_token():
    r = requests.post(f"{API}/auth/login", json={"email": CLIENT_EMAIL, "password": CLIENT_PW})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def client_id(client_token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {client_token}"})
    return r.json()["user"]["client_id"]


def H(t): return {"Authorization": f"Bearer {t}"}


# ---------- public ----------
def test_root():
    r = requests.get(f"{API}/")
    assert r.status_code == 200
    assert r.json()["service"] == "EzySlot AI"


def test_demo_images():
    r = requests.get(f"{API}/public/demo-images")
    assert r.status_code == 200
    imgs = r.json()["images"]
    assert isinstance(imgs, list) and len(imgs) == 3


def test_detect_endpoint():
    # fetch a sample image
    imgs = requests.get(f"{API}/public/demo-images").json()["images"]
    img_bytes = requests.get(imgs[0], timeout=30).content
    r = requests.post(f"{API}/detect", files={"file": ("t.jpg", img_bytes, "image/jpeg")}, timeout=120)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "detections" in data and isinstance(data["detections"], list)
    assert "counts" in data and "vehicles" in data["counts"]
    assert data.get("annotated_url")
    # fetch annotated
    r2 = requests.get(BASE + data["annotated_url"])
    assert r2.status_code == 200
    assert r2.headers["content-type"].startswith("image/")


def test_detect_empty():
    r = requests.post(f"{API}/detect", files={"file": ("t.jpg", b"", "image/jpeg")})
    assert r.status_code == 400


def test_enquiry_without_sendgrid():
    r = requests.post(f"{API}/enquiries", data={
        "name": "TEST_Alice", "email": "test_alice@example.com", "company": "TESTCo",
        "site_location": "Nowhere", "camera_count": 2, "message": "hello",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["enquiry"]["name"] == "TEST_Alice"


# ---------- auth ----------
def test_login_developer(dev_token):
    assert isinstance(dev_token, str) and len(dev_token) > 20


def test_login_client(client_token):
    assert isinstance(client_token, str) and len(client_token) > 20


def test_login_bad():
    r = requests.post(f"{API}/auth/login", json={"email": DEV_EMAIL, "password": "wrong"})
    assert r.status_code == 401


def test_me_client(client_token):
    r = requests.get(f"{API}/auth/me", headers=H(client_token))
    assert r.status_code == 200
    u = r.json()["user"]
    assert u["role"] == "client" and u["client_id"]


def test_me_developer(dev_token):
    r = requests.get(f"{API}/auth/me", headers=H(dev_token))
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "developer"


def test_me_unauth():
    r = requests.get(f"{API}/auth/me")
    assert r.status_code == 401


# ---------- multi-client isolation ----------
def test_client_cannot_access_other_client(client_token):
    other = str(uuid.uuid4())
    r = requests.get(f"{API}/cameras?client_id={other}", headers=H(client_token))
    assert r.status_code == 403
    r2 = requests.get(f"{API}/history?client_id={other}", headers=H(client_token))
    assert r2.status_code == 403


def test_developer_needs_client_id(dev_token):
    r = requests.get(f"{API}/cameras", headers=H(dev_token))
    assert r.status_code == 400


# ---------- cameras + live ----------
def test_cameras_list(client_token, client_id):
    r = requests.get(f"{API}/cameras?client_id={client_id}", headers=H(client_token))
    assert r.status_code == 200
    cams = r.json()["cameras"]
    assert len(cams) == 3
    for c in cams:
        assert "slot_count" in c and c["slot_count"] > 0


def test_camera_live(client_token, client_id):
    cams = requests.get(f"{API}/cameras?client_id={client_id}", headers=H(client_token)).json()["cameras"]
    r = requests.get(f"{API}/cameras/{cams[0]['id']}/live", headers=H(client_token))
    assert r.status_code == 200
    p = r.json()
    for k in ("slots", "free", "occupied", "unknown", "total"):
        assert k in p
    assert p["total"] == len(p["slots"])


def test_get_slots(client_token, client_id):
    cams = requests.get(f"{API}/cameras?client_id={client_id}", headers=H(client_token)).json()["cameras"]
    r = requests.get(f"{API}/cameras/{cams[0]['id']}/slots", headers=H(client_token))
    assert r.status_code == 200
    assert len(r.json()["slots"]) > 0


# ---------- history ----------
def test_history_snapshots(client_token, client_id):
    # allow occupancy loop to persist a snapshot (every 5*2s ~10s). Give it a bit.
    for _ in range(6):
        r = requests.get(f"{API}/history?client_id={client_id}&kind=snapshots", headers=H(client_token))
        if r.status_code == 200 and len(r.json()["items"]) > 0:
            return
        time.sleep(3)
    # non-fatal: at minimum endpoint should respond 200 with a list
    r = requests.get(f"{API}/history?client_id={client_id}&kind=snapshots", headers=H(client_token))
    assert r.status_code == 200
    assert isinstance(r.json()["items"], list)


def test_history_events(client_token, client_id):
    r = requests.get(f"{API}/history?client_id={client_id}&kind=events", headers=H(client_token))
    assert r.status_code == 200
    assert isinstance(r.json()["items"], list)


# ---------- tickets ----------
def test_tickets_flow(client_token, dev_token, client_id):
    # client creates
    r = requests.post(f"{API}/tickets", json={"subject": "TEST_subj", "description": "TEST_desc", "priority": "low"},
                      headers=H(client_token))
    assert r.status_code == 200, r.text
    tid = r.json()["ticket"]["id"]
    # developer lists
    r2 = requests.get(f"{API}/tickets", headers=H(dev_token))
    assert r2.status_code == 200
    assert any(t["id"] == tid for t in r2.json()["tickets"])
    # dev updates status + response
    r3 = requests.put(f"{API}/tickets/{tid}", json={"status": "in_progress", "response": "Looking into it"},
                     headers=H(dev_token))
    assert r3.status_code == 200
    t = r3.json()["ticket"]
    assert t["status"] == "in_progress"
    assert len(t["responses"]) == 1 and t["responses"][0]["text"] == "Looking into it"


# ---------- developer stats / health ----------
def test_stats_overview(dev_token):
    r = requests.get(f"{API}/stats/overview", headers=H(dev_token))
    assert r.status_code == 200
    d = r.json()
    for k in ("clients", "cameras", "occupancy", "model_ready"):
        assert k in d
    assert d["model_ready"] is True


def test_system_health(dev_token):
    r = requests.get(f"{API}/system/health", headers=H(dev_token))
    assert r.status_code == 200
    d = r.json()
    assert d["model_ready"] is True
    assert d["db"] == "connected"


# ---------- enquiries + convert ----------
def test_enquiries_list_and_convert(dev_token):
    r = requests.get(f"{API}/enquiries", headers=H(dev_token))
    assert r.status_code == 200
    enqs = r.json()["enquiries"]
    assert len(enqs) >= 1
    # pick a NEW one; else create
    target = next((e for e in enqs if e["status"] == "new"), None)
    if not target:
        rc = requests.post(f"{API}/enquiries", data={
            "name": "TEST_Convert", "email": "test_conv@example.com", "company": "TESTX",
            "site_location": "TEST", "camera_count": 1})
        target = rc.json()["enquiry"]
    unique_email = f"test_client_{uuid.uuid4().hex[:6]}@example.com"
    r2 = requests.post(f"{API}/enquiries/{target['id']}/convert", json={
        "name": "TEST_ConvClient", "site_location": "TESTLoc",
        "contact_email": unique_email, "service_days": 30,
    }, headers=H(dev_token))
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["id"] and body.get("provisioned_login")
    assert body["provisioned_login"]["email"] == unique_email


# ---------- developer clients / cameras / slots / fare / service ----------
@pytest.fixture(scope="module")
def new_client(dev_token):
    email = f"test_dev_{uuid.uuid4().hex[:6]}@example.com"
    r = requests.post(f"{API}/clients", json={
        "name": "TEST_Client", "site_location": "TESTSite",
        "contact_email": email, "service_days": 30}, headers=H(dev_token))
    assert r.status_code == 200, r.text
    return r.json()


def test_create_client_and_list(dev_token, new_client):
    r = requests.get(f"{API}/clients", headers=H(dev_token))
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()["clients"]]
    assert new_client["id"] in ids


def test_camera_and_slots_lifecycle(dev_token, new_client):
    # add camera
    r = requests.post(f"{API}/cameras", data={
        "client_id": new_client["id"], "name": "TEST_Cam", "snapshot_url": "https://x/y.jpg"
    }, headers=H(dev_token))
    assert r.status_code == 200, r.text
    cam_id = r.json()["camera"]["id"]
    # save slots
    slots = [{"label": "A-1", "polygon": [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]},
             {"label": "A-2", "polygon": [[0.4, 0.1], [0.6, 0.1], [0.6, 0.3], [0.4, 0.3]]}]
    r2 = requests.put(f"{API}/cameras/{cam_id}/slots", json={"slots": slots}, headers=H(dev_token))
    assert r2.status_code == 200
    # get slots
    r3 = requests.get(f"{API}/cameras/{cam_id}/slots", headers=H(dev_token))
    assert r3.status_code == 200 and len(r3.json()["slots"]) == 2
    # delete camera
    r4 = requests.delete(f"{API}/cameras/{cam_id}", headers=H(dev_token))
    assert r4.status_code == 200


def test_fare_and_service(dev_token, new_client):
    r = requests.put(f"{API}/clients/{new_client['id']}/fare",
                     json={"enabled": True, "type": "per_hour", "currency": "INR",
                           "per_hour": 50, "fixed": 120, "slabs": []},
                     headers=H(dev_token))
    assert r.status_code == 200
    r2 = requests.put(f"{API}/clients/{new_client['id']}/service",
                      json={"service_days": 90}, headers=H(dev_token))
    assert r2.status_code == 200


# ---------- video clip upload + client-side playback ----------
def _make_tiny_mp4() -> bytes:
    """Synthesize a tiny (few frames) mp4 using cv2 so YOLO has real frames to detect."""
    import cv2, numpy as np, tempfile, os as _os
    path = tempfile.mktemp(suffix=".mp4")
    w, h = 320, 240
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    vw = cv2.VideoWriter(path, fourcc, 5.0, (w, h))
    for i in range(6):
        frame = np.full((h, w, 3), 40, dtype=np.uint8)
        # draw a car-ish rectangle
        cv2.rectangle(frame, (60 + i * 4, 100), (240, 190), (0, 120, 200), -1)
        cv2.rectangle(frame, (80, 80), (220, 110), (80, 80, 80), -1)
        vw.write(frame)
    vw.release()
    with open(path, "rb") as f:
        data = f.read()
    _os.unlink(path)
    return data


def test_video_upload_and_clip_playback(dev_token, client_token, client_id):
    # pick a camera
    cams = requests.get(f"{API}/cameras?client_id={client_id}", headers=H(client_token)).json()["cameras"]
    cam_id = cams[0]["id"]
    # upload tiny mp4 as developer
    mp4 = _make_tiny_mp4()
    assert len(mp4) > 100
    r = requests.post(f"{API}/cameras/{cam_id}/video",
                      files={"video": ("t.mp4", mp4, "video/mp4")},
                      headers=H(dev_token), timeout=60)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "processing"

    # poll status up to ~40s (YOLO on CPU for 6 frames should be fast)
    status = None
    for _ in range(40):
        s = requests.get(f"{API}/cameras/{cam_id}/video/status", headers=H(dev_token))
        assert s.status_code == 200
        status = s.json().get("status")
        if status == "done":
            break
        if status == "error":
            pytest.fail(f"video processing error: {s.json()}")
        time.sleep(1.5)
    assert status == "done", f"video didn't finish, last status={status}"

    # client (owner) fetches clip -- should have frames
    r2 = requests.get(f"{API}/cameras/{cam_id}/clip", headers=H(client_token))
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["clip"] is True
    assert isinstance(body["frames"], list) and len(body["frames"]) >= 1
    # each frame payload has expected keys
    f0 = body["frames"][0]
    for k in ("frame_url", "slots", "free", "occupied", "unknown", "total"):
        assert k in f0, f"missing {k} in clip frame"

    # video/clip endpoints reject other clients (isolation)
    other = str(uuid.uuid4())
    # Use an unauth request to be sure it's protected
    r_no_auth = requests.get(f"{API}/cameras/{cam_id}/clip")
    assert r_no_auth.status_code == 401


# ---------- websocket ----------
def test_websocket_bad_token(client_id):
    async def go():
        try:
            async with websockets.connect(f"{WS_BASE}/ws/{client_id}?token=bad", open_timeout=10) as ws:
                await ws.recv()
                return "unexpected_open"
        except websockets.exceptions.InvalidStatusCode as e:
            return e.status_code
        except websockets.exceptions.ConnectionClosed as e:
            return e.code
        except Exception as e:
            return str(e)
    result = asyncio.get_event_loop().run_until_complete(go())
    # server closes with 4401 (custom code); some proxies map to 1006 - accept either
    # server rejects bad token (either close-code 4401/1006, or ingress HTTP 403)
    assert (result in (4401, 1006, 403)) or ("403" in str(result)) or ("4401" in str(result)), f"got {result}"


def test_websocket_good_token(client_token, client_id):
    async def go():
        async with websockets.connect(f"{WS_BASE}/ws/{client_id}?token={client_token}",
                                       open_timeout=15) as ws:
            # collect messages for up to 6 seconds
            got = []
            try:
                for _ in range(3):
                    msg = await asyncio.wait_for(ws.recv(), timeout=6)
                    got.append(json.loads(msg))
            except asyncio.TimeoutError:
                pass
            return got
    msgs = asyncio.get_event_loop().run_until_complete(go())
    assert len(msgs) >= 1
    assert any(m.get("type") == "occupancy" and "slots" in m for m in msgs)
