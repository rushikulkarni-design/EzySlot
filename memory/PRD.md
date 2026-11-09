# EzySlot AI — Product Requirements Document

## Original Problem Statement
Multi-Client Smart Parking SaaS. AI-powered parking monitoring platform. YOLOv8 detects vehicles from images/webcam feeds, maps them onto developer-drawn slot polygons, and shows real-time FREE / OCCUPIED / UNKNOWN status per slot, across multiple isolated clients. Public site + client portal + internal developer/operations portal.

## Architecture
- **Frontend**: React (CRA + craco), Tailwind, framer-motion, recharts, native WebSocket, canvas/SVG polygon drawing + live overlay. Bearer-token auth (localStorage `sp_token`).
- **Backend**: FastAPI single service hosting YOLOv8n inline (CPU). All routes under `/api`. Native WebSocket at `/api/ws/{client_id}?token=`.
- **CV**: Ultralytics YOLOv8n, CPU, weights pre-downloaded to `/app/backend/yolov8n.pt` (offline-capable). PIL for annotation, custom point-in-polygon overlap logic.
- **DB**: MongoDB — collections: users, clients, enquiries, cameras, slots, detections (snapshots), slot_events, tickets, activity_logs, email_queue.
- **Auth**: JWT (HS256, 7d) + bcrypt, roles: public / client / developer. Multi-client isolation enforced server-side via `scope_client_id()`.
- **Email**: SendGrid with graceful degradation (queued/logged when no API key).
- **Storage**: Object storage for uploaded/annotated images.

## User Personas
1. **Public visitor** — tries free image detection, submits a service enquiry.
2. **Client operator** — monitors live occupancy, switches cameras, views history, raises tickets, checks fare/service validity.
3. **Developer (internal)** — Operations Center: manages clients, converts enquiries, adds cameras, draws slot polygons, configures fare/service, resolves tickets, monitors system health.

## Core Requirements (static)
- Public Try Detection (real YOLOv8), service enquiry with image upload + email notify.
- Developer onboarding: enquiry → client → cameras → slot polygons → validity/fare.
- Option A slot mapping: draw polygons once per camera; occupancy automatic via box-vs-polygon overlap.
- Real-time client dashboard: dominant viewer + camera switcher, live slot overlay, FREE/OCCUPIED/UNKNOWN counts, nearest free slot, pushed over WebSocket.
- Live webcam mode toggle. Optional fare config (display-only). Support tickets, activity/history logs (both snapshots + per-slot events), service validity, email notifications.
- Multi-client isolation enforced at backend.

## Implemented (2026-06)
- ✅ Full JWT+bcrypt auth, role gating, seed developer + client accounts.
- ✅ Public: `/api/detect` (real YOLOv8n), `/api/enquiries` (graceful email), demo images.
- ✅ Client portal: live monitor (WebSocket occupancy engine, SlotCanvas overlay, counts, nearest-free, camera switcher, webcam toggle), history (trend chart + slot events), tickets, service & fare.
- ✅ Developer Operations Center: KPI overview + charts, clients CRUD + Add Client, enquiries inbox + Convert-to-Client, cameras + interactive PolygonEditor (save slot map), fare config, service extension, ticket resolution, system health + activity log.
- ✅ Realtime occupancy loop (evolves every ~2s, persists snapshots + flip events, broadcasts over WS).
- ✅ Multi-client isolation (403 on cross-client access). Offline-capable YOLO weights.
- ✅ Tested: 27/27 backend pytest pass; frontend E2E flows verified 100%.

- ✅ Live Video Detection: developer uploads a clip per camera → backend samples frames + runs real YOLOv8n → dashboard plays back real footage with detection boxes (`/api/cameras/{id}/video`, `/video/status`).
- ✅ Clip Playback Controls: client viewer has play/pause, prev/next, and a frame scrubber for real-footage cameras (`GET /api/cameras/{id}/clip`).

## Notes / Known Trade-offs
- Live dashboard occupancy is a server-side simulation evolving over drawn polygons (demo data). Real YOLO is used genuinely for public Try Detection and can analyze camera snapshots. This matches the "pre-recorded / offline demo" hardening intent.
- SendGrid has no API key configured — emails are QUEUED/logged (graceful). Add `SENDGRID_API_KEY` + verified `SENDER_EMAIL` in backend/.env to enable real sending.
- `/api/files/{path}` serves annotated/public images without auth (acceptable for public Try Detection).

## Backlog (prioritized)
- P1: Distinct WS auth-reject close code (currently ingress 403).
- P1: Add DialogDescription/aria-describedby to dialogs (a11y).
- P2: Drive live occupancy from real YOLO on uploaded/streamed camera frames instead of simulation.
- P2: Persist vehicle entry/exit timestamps for real fare computation.
- P2: Split server.py into routers/modules for maintainability.

## Test Credentials
- Developer: `revati031004@gmail.com` / `EzySlot@2025`
- Client: `client@metromall.com` / `Client@2025`

