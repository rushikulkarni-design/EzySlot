import React, { useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Trash2,
  Check,
  Undo2,
  MousePointerClick,
  ScanSearch,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import api, { apiErr } from "../lib/api";


// ============================================================
// SETTINGS
// ============================================================

// YOLO detections below this confidence are ignored.
const MIN_VEHICLE_CONFIDENCE = 0.15;

// Minimum percentage of a vehicle bounding box that must
// overlap a parking polygon for the overlap fallback.
const MIN_OVERLAP = 0.30;

// Maximum normalized distance allowed for the overlap fallback.
const MAX_FALLBACK_DISTANCE = 0.24;


// ============================================================
// COMPONENT
// ============================================================

export default function PolygonEditor({
  imageUrl,
  slots,
  setSlots,
}) {
  const wrapRef = useRef(null);

  const [draft, setDraft] = useState([]);
  const [label, setLabel] = useState("");

  const [imageRatio, setImageRatio] =
    useState(16 / 9);

  const [analyzing, setAnalyzing] =
    useState(false);

  const [detections, setDetections] =
    useState([]);

  const [slotStatus, setSlotStatus] =
    useState({});

  const [analysisDone, setAnalysisDone] =
    useState(false);


  // ==========================================================
  // IMAGE
  // ==========================================================

  const handleImageLoad = (event) => {
    const image = event.currentTarget;

    if (
      image.naturalWidth > 0 &&
      image.naturalHeight > 0
    ) {
      setImageRatio(
        image.naturalWidth /
          image.naturalHeight
      );
    }
  };


  // ==========================================================
  // SCREEN -> NORMALIZED COORDINATES
  // ==========================================================

  const toNorm = (event) => {
    if (!wrapRef.current) {
      return [0, 0];
    }

    const rect =
      wrapRef.current.getBoundingClientRect();

    const x = Math.min(
      1,
      Math.max(
        0,
        (event.clientX - rect.left) /
          rect.width
      )
    );

    const y = Math.min(
      1,
      Math.max(
        0,
        (event.clientY - rect.top) /
          rect.height
      )
    );

    return [
      Number(x.toFixed(4)),
      Number(y.toFixed(4)),
    ];
  };


  // ==========================================================
  // ADD POLYGON POINT
  // ==========================================================

  const onClick = (event) => {
    if (analyzing) {
      return;
    }

    setDraft((current) => [
      ...current,
      toNorm(event),
    ]);
  };


  // ==========================================================
  // UNDO
  // ==========================================================

  const undoPoint = () => {
    setDraft((current) =>
      current.slice(0, -1)
    );
  };


  // ==========================================================
  // CLEAR DRAFT
  // ==========================================================

  const clearDraft = () => {
    setDraft([]);
  };


  // ==========================================================
  // ADD SLOT
  // ==========================================================

  const finishSlot = () => {
    if (draft.length < 3) {
      toast.error(
        "Draw at least 3 points for a slot"
      );
      return;
    }

    if (!label.trim()) {
      toast.error(
        "Enter a slot label (e.g. S1)"
      );
      return;
    }

    const newSlot = {
      id: crypto.randomUUID(),
      label: label.trim(),
      polygon: draft,
    };

    setSlots([
      ...slots,
      newSlot,
    ]);

    setDraft([]);
    setLabel("");

    setDetections([]);
    setSlotStatus({});
    setAnalysisDone(false);

    toast.success(
      `Slot ${label.trim()} added`
    );
  };


  // ==========================================================
  // REMOVE SLOT
  // ==========================================================

  const removeSlot = (id) => {
    setSlots(
      slots.filter(
        (slot) => slot.id !== id
      )
    );

    setDetections([]);
    setSlotStatus({});
    setAnalysisDone(false);
  };


  // ==========================================================
  // POLYGON -> SVG POINTS
  // ==========================================================

  const polygonPoints = (polygon) => {
    return polygon
      .map(
        (point) =>
          `${point[0] * 100},${
            point[1] * 100
          }`
      )
      .join(" ");
  };


  // ==========================================================
  // POLYGON CENTER
  // ==========================================================

  const getPolygonCenter = (
    polygon
  ) => {
    if (
      !polygon ||
      polygon.length === 0
    ) {
      return [0, 0];
    }

    const x =
      polygon.reduce(
        (sum, point) =>
          sum + point[0],
        0
      ) / polygon.length;

    const y =
      polygon.reduce(
        (sum, point) =>
          sum + point[1],
        0
      ) / polygon.length;

    return [x, y];
  };


  // ==========================================================
  // POINT IN POLYGON
  // ==========================================================

  const pointInPolygon = (
    x,
    y,
    polygon
  ) => {
    if (
      !polygon ||
      polygon.length < 3
    ) {
      return false;
    }

    let inside = false;

    let j =
      polygon.length - 1;

    for (
      let i = 0;
      i < polygon.length;
      i++
    ) {
      const xi =
        polygon[i][0];

      const yi =
        polygon[i][1];

      const xj =
        polygon[j][0];

      const yj =
        polygon[j][1];

      const intersects =
        yi > y !==
          yj > y &&
        x <
          ((xj - xi) *
            (y - yi)) /
            ((yj - yi) ||
              1e-9) +
            xi;

      if (intersects) {
        inside = !inside;
      }

      j = i;
    }

    return inside;
  };


  // ==========================================================
  // DISTANCE
  // ==========================================================

  const distance = (
    p1,
    p2
  ) => {
    const dx =
      p1[0] - p2[0];

    const dy =
      p1[1] - p2[1];

    return Math.sqrt(
      dx * dx +
        dy * dy
    );
  };


  // ==========================================================
  // GET VEHICLE CENTER
  // ==========================================================

  const getVehicleCenter = (
    detection
  ) => {
    const [
      x1,
      y1,
      x2,
      y2,
    ] = detection.nbox;

    return [
      (x1 + x2) / 2,
      (y1 + y2) / 2,
    ];
  };


  // ==========================================================
  // GET VEHICLE BOTTOM CENTER
  //
  // This is particularly useful for parking cameras.
  //
  // The bottom-center approximates the point where the vehicle
  // touches the parking surface.
  // ==========================================================

  const getVehicleBottomCenter = (
    detection
  ) => {
    const [
      x1,
      ,
      x2,
      y2,
    ] = detection.nbox;

    return [
      (x1 + x2) / 2,
      y2,
    ];
  };


  // ==========================================================
  // VEHICLE BOX POLYGON
  // ==========================================================

  const getVehiclePolygon = (
    detection
  ) => {
    const [
      x1,
      y1,
      x2,
      y2,
    ] = detection.nbox;

    return [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ];
  };


  // ==========================================================
  // POLYGON AREA
  // ==========================================================

  const polygonArea = (
    polygon
  ) => {
    if (
      !polygon ||
      polygon.length < 3
    ) {
      return 0;
    }

    let area = 0;

    let j =
      polygon.length - 1;

    for (
      let i = 0;
      i < polygon.length;
      i++
    ) {
      area +=
        polygon[j][0] *
          polygon[i][1] -
        polygon[i][0] *
          polygon[j][1];

      j = i;
    }

    return Math.abs(area) / 2;
  };


  // ==========================================================
  // CROSS PRODUCT
  // ==========================================================

  const cross = (
    a,
    b,
    c
  ) => {
    return (
      (b[0] - a[0]) *
        (c[1] - a[1]) -
      (b[1] - a[1]) *
        (c[0] - a[0])
    );
  };


  // ==========================================================
  // LINE INTERSECTION
  // ==========================================================

  const lineIntersection = (
    p1,
    p2,
    q1,
    q2
  ) => {
    const x1 = p1[0];
    const y1 = p1[1];

    const x2 = p2[0];
    const y2 = p2[1];

    const x3 = q1[0];
    const y3 = q1[1];

    const x4 = q2[0];
    const y4 = q2[1];

    const denominator =
      (x1 - x2) *
        (y3 - y4) -
      (y1 - y2) *
        (x3 - x4);

    if (
      Math.abs(
        denominator
      ) < 1e-10
    ) {
      return [
        x2,
        y2,
      ];
    }

    const px =
      (
        (x1 * y2 -
          y1 * x2) *
          (x3 - x4) -
        (x1 - x2) *
          (x3 * y4 -
            y3 * x4)
      ) /
      denominator;

    const py =
      (
        (x1 * y2 -
          y1 * x2) *
          (y3 - y4) -
        (y1 - y2) *
          (x3 * y4 -
            y3 * x4)
      ) /
      denominator;

    return [
      px,
      py,
    ];
  };


  // ==========================================================
  // CLIP POLYGON
  // ==========================================================

  const clipPolygon = (
    polygon,
    edgeStart,
    edgeEnd
  ) => {
    if (
      !polygon ||
      polygon.length === 0
    ) {
      return [];
    }

    const output = [];

    let previous =
      polygon[
        polygon.length - 1
      ];

    let previousInside =
      cross(
        edgeStart,
        edgeEnd,
        previous
      ) >= 0;

    for (
      const current of polygon
    ) {
      const currentInside =
        cross(
          edgeStart,
          edgeEnd,
          current
        ) >= 0;

      if (currentInside) {
        if (!previousInside) {
          output.push(
            lineIntersection(
              previous,
              current,
              edgeStart,
              edgeEnd
            )
          );
        }

        output.push(
          current
        );
      } else if (
        previousInside
      ) {
        output.push(
          lineIntersection(
            previous,
            current,
            edgeStart,
            edgeEnd
          )
        );
      }

      previous =
        current;

      previousInside =
        currentInside;
    }

    return output;
  };


  // ==========================================================
  // INTERSECTION AREA
  // ==========================================================

  const intersectionArea = (
    slotPolygon,
    vehiclePolygon
  ) => {
    let clipped =
      slotPolygon.map(
        (point) => [
          point[0],
          point[1],
        ]
      );

    for (
      let i = 0;
      i <
      vehiclePolygon.length;
      i++
    ) {
      const edgeStart =
        vehiclePolygon[i];

      const edgeEnd =
        vehiclePolygon[
          (i + 1) %
            vehiclePolygon.length
        ];

      clipped =
        clipPolygon(
          clipped,
          edgeStart,
          edgeEnd
        );

      if (
        clipped.length === 0
      ) {
        return 0;
      }
    }

    return polygonArea(
      clipped
    );
  };


  // ==========================================================
  // VEHICLE OVERLAP RATIO
  //
  // Percentage of the vehicle bounding box that lies inside
  // the parking slot.
  // ==========================================================

  const getOverlapRatio = (
    slot,
    detection
  ) => {
    const vehiclePolygon =
      getVehiclePolygon(
        detection
      );

    const vehicleArea =
      polygonArea(
        vehiclePolygon
      );

    if (
      vehicleArea <= 0
    ) {
      return 0;
    }

    const intersection =
      intersectionArea(
        slot.polygon,
        vehiclePolygon
      );

    return (
      intersection /
      vehicleArea
    );
  };


  // ==========================================================
  // MATCH VEHICLE TO SLOT
  //
  // Priority:
  //
  // 1. Vehicle center
  // 2. Vehicle bottom-center
  // 3. Strong overlap fallback
  // ==========================================================

  const matchVehicleToSlot = (
    slot,
    detection
  ) => {
    const center =
      getVehicleCenter(
        detection
      );

    const bottomCenter =
      getVehicleBottomCenter(
        detection
      );

    // --------------------------------------------------------
    // RULE 1:
    // VEHICLE CENTER INSIDE SLOT
    // --------------------------------------------------------

    if (
      pointInPolygon(
        center[0],
        center[1],
        slot.polygon
      )
    ) {
      return {
        matched: true,
        type: "CENTER",
        score: 100,
        overlap: 1,
      };
    }

    // --------------------------------------------------------
    // RULE 2:
    // VEHICLE BOTTOM CENTER INSIDE SLOT
    // --------------------------------------------------------

    if (
      pointInPolygon(
        bottomCenter[0],
        bottomCenter[1],
        slot.polygon
      )
    ) {
      return {
        matched: true,
        type: "BOTTOM_CENTER",
        score: 95,
        overlap: 1,
      };
    }

    // --------------------------------------------------------
    // RULE 3:
    // CONTROLLED OVERLAP
    // --------------------------------------------------------

    const overlap =
      getOverlapRatio(
        slot,
        detection
      );

    if (
      overlap <
      MIN_OVERLAP
    ) {
      return {
        matched: false,
        type: "NONE",
        score: 0,
        overlap,
      };
    }

    // --------------------------------------------------------
    // SAFETY DISTANCE
    // --------------------------------------------------------

    const slotCenter =
      getPolygonCenter(
        slot.polygon
      );

    const vehicleCenter =
      getVehicleCenter(
        detection
      );

    const centerDistance =
      distance(
        slotCenter,
        vehicleCenter
      );

    if (
      centerDistance >
      MAX_FALLBACK_DISTANCE
    ) {
      return {
        matched: false,
        type: "NONE",
        score: 0,
        overlap,
      };
    }

    // --------------------------------------------------------
    // OVERLAP ACCEPTED
    // --------------------------------------------------------

    return {
      matched: true,
      type: "OVERLAP",
      score:
        50 +
        overlap * 40,
      overlap,
    };
  };


  // ==========================================================
  // CALCULATE SLOT STATUS
  //
  // IMPORTANT:
  //
  // We assign each vehicle to at most ONE slot.
  //
  // This prevents one YOLO vehicle box from occupying
  // multiple neighboring parking spaces.
  // ==========================================================

  const calculateSlotStatuses = (
    vehicleDetections
  ) => {
    const result = {};

    // --------------------------------------------------------
    // INITIAL STATE
    // --------------------------------------------------------

    for (
      const slot of slots
    ) {
      result[
        slot.id
      ] = {
        status: "FREE",
        conf: 0,
        box: null,
        vehicle: null,
        matchType: null,
        overlap: 0,
      };
    }

    // --------------------------------------------------------
    // BUILD MATCH CANDIDATES
    // --------------------------------------------------------

    const candidates = [];

    vehicleDetections.forEach(
      (
        detection,
        detectionIndex
      ) => {
        const confidence =
          Number(
            detection.conf || 0
          );

        // ----------------------------------------------------
        // Ignore weak detections.
        // ----------------------------------------------------

        if (
          confidence <
          MIN_VEHICLE_CONFIDENCE
        ) {
          return;
        }

        // ----------------------------------------------------
        // Extra safety:
        // only vehicle labels.
        // ----------------------------------------------------

        const allowedVehicles = [
          "bicycle",
          "car",
          "motorcycle",
          "bus",
          "truck",
        ];

        if (
          !allowedVehicles.includes(
            detection.label
          )
        ) {
          return;
        }

        // ----------------------------------------------------
        // Compare against every slot.
        // ----------------------------------------------------

        slots.forEach(
          (slot) => {
            const match =
              matchVehicleToSlot(
                slot,
                detection
              );

            if (
              !match.matched
            ) {
              return;
            }

            candidates.push({
              slot,
              detection,
              detectionIndex,
              confidence,
              ...match,
            });
          }
        );
      }
    );

    // --------------------------------------------------------
    // BEST MATCHES FIRST
    //
    // Center > Bottom Center > Overlap
    //
    // Then confidence.
    // --------------------------------------------------------

    candidates.sort(
      (a, b) => {
        if (
          b.score !==
          a.score
        ) {
          return (
            b.score -
            a.score
          );
        }

        return (
          b.confidence -
          a.confidence
        );
      }
    );

    const usedSlots =
      new Set();

    const usedDetections =
      new Set();

    // --------------------------------------------------------
    // ASSIGN
    // --------------------------------------------------------

    for (
      const candidate of candidates
    ) {
      const slotId =
        candidate.slot.id;

      const detectionIndex =
        candidate.detectionIndex;

      // One vehicle cannot occupy two slots.
      if (
        usedDetections.has(
          detectionIndex
        )
      ) {
        continue;
      }

      // One slot cannot have two vehicles.
      if (
        usedSlots.has(
          slotId
        )
      ) {
        continue;
      }

      usedDetections.add(
        detectionIndex
      );

      usedSlots.add(
        slotId
      );

      result[
        slotId
      ] = {
        status:
          "OCCUPIED",

        conf:
          Number(
            candidate.confidence.toFixed(
              3
            )
          ),

        box:
          candidate.detection.nbox,

        vehicle:
          candidate.detection.label,

        matchType:
          candidate.type,

        overlap:
          Number(
            candidate.overlap.toFixed(
              3
            )
          ),
      };
    }

    return result;
  };


  // ==========================================================
  // ANALYZE WITH YOLO
  // ==========================================================

  const analyzeWithYOLO =
    async () => {
      if (!imageUrl) {
        toast.error(
          "No parking image available"
        );
        return;
      }

      if (
        slots.length === 0
      ) {
        toast.error(
          "Map parking slots before running YOLO"
        );
        return;
      }

      setAnalyzing(true);

      try {
        // ----------------------------------------------------
        // GET IMAGE
        // ----------------------------------------------------

        const response =
          await api.get(
            imageUrl,
            {
              responseType:
                "blob",
            }
          );

        const blob =
          response.data;

        if (
          !blob ||
          blob.size === 0
        ) {
          throw new Error(
            "Parking image could not be loaded"
          );
        }

        // ----------------------------------------------------
        // SEND IMAGE TO YOLO
        // ----------------------------------------------------

        const formData =
          new FormData();

        formData.append(
          "file",
          blob,
          "parking-camera.jpg"
        );

        const responseData =
          await api.post(
            "/detect",
            formData,
            {
              headers: {
                "Content-Type":
                  "multipart/form-data",
              },
            }
          );

        const data =
          responseData.data;

        // ----------------------------------------------------
        // ONLY VEHICLE DETECTIONS
        //
        // Backend already filters these, but we filter again
        // here as a safety layer.
        // ----------------------------------------------------

        const allowedVehicles = [
          "bicycle",
          "car",
          "motorcycle",
          "bus",
          "truck",
        ];

        const vehicleDetections = (
          data.detections ||
          []
        ).filter(
          (detection) =>
            allowedVehicles.includes(
              detection.label
            ) &&
            Number(
              detection.conf || 0
            ) >=
              MIN_VEHICLE_CONFIDENCE
        );

        setDetections(
          vehicleDetections
        );

        // ----------------------------------------------------
        // MATCH VEHICLES TO REAL PARKING SLOTS
        // ----------------------------------------------------

        const statuses =
          calculateSlotStatuses(
            vehicleDetections
          );

        setSlotStatus(
          statuses
        );

        setAnalysisDone(
          true
        );

        // ----------------------------------------------------
        // COUNTS
        // ----------------------------------------------------

        const occupied =
          Object.values(
            statuses
          ).filter(
            (item) =>
              item.status ===
              "OCCUPIED"
          ).length;

        const free =
          slots.length -
          occupied;

        toast.success(
          `YOLO analyzed ${vehicleDetections.length} vehicles — ${occupied} occupied, ${free} free`
        );
      } catch (error) {
        console.error(
          "YOLO analysis failed:",
          error
        );

        toast.error(
          apiErr(error) ||
            "YOLO analysis failed"
        );
      } finally {
        setAnalyzing(false);
      }
    };


  // ==========================================================
  // COUNTS
  // ==========================================================

  const occupiedCount =
    Object.values(
      slotStatus
    ).filter(
      (item) =>
        item.status ===
        "OCCUPIED"
    ).length;

  const freeCount =
    Math.max(
      0,
      slots.length -
        occupiedCount
    );

  const unknownCount = 0;


  // ==========================================================
  // SLOT COLOR
  // ==========================================================

  const getSlotStroke = (
    slot
  ) => {
    if (!analysisDone) {
      return "#38BDF8";
    }

    const status =
      slotStatus[
        slot.id
      ]?.status;

    if (
      status ===
      "OCCUPIED"
    ) {
      return "#EF4444";
    }

    return "#22C55E";
  };


  const getSlotFill = (
    slot
  ) => {
    if (!analysisDone) {
      return "rgba(56,189,248,0.14)";
    }

    const status =
      slotStatus[
        slot.id
      ]?.status;

    if (
      status ===
      "OCCUPIED"
    ) {
      return "rgba(239,68,68,0.28)";
    }

    return "rgba(34,197,94,0.22)";
  };


  // ==========================================================
  // STATUS TEXT
  // ==========================================================

  const getStatusText = (
    slot
  ) => {
    if (!analysisDone) {
      return "";
    }

    return (
      slotStatus[
        slot.id
      ]?.status ||
      "FREE"
    );
  };


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="space-y-4">

      {/* ======================================================
          IMAGE / SLOT CANVAS
      ====================================================== */}

      <div
        ref={wrapRef}
        data-testid="slot-polygon-canvas"
        onClick={onClick}
        className="relative w-full cursor-crosshair overflow-hidden rounded-xl border border-sp-border bg-black"
        style={{
          aspectRatio:
            imageRatio,
        }}
      >

        {/* ----------------------------------------------------
            CAMERA IMAGE
        ---------------------------------------------------- */}

        {imageUrl && (
          <img
            src={imageUrl}
            alt="Parking camera snapshot"
            onLoad={
              handleImageLoad
            }
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
        )}

        {/* ----------------------------------------------------
            GRID
        ---------------------------------------------------- */}

        <div className="pointer-events-none absolute inset-0 grid-bg opacity-20" />

        {/* ====================================================
            SVG
        ==================================================== */}

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >

          {/* --------------------------------------------------
              YOLO VEHICLE BOXES
          -------------------------------------------------- */}

          {detections.map(
            (
              detection,
              index
            ) => (
              <rect
                key={`vehicle-${index}`}
                x={
                  detection.nbox[0] *
                  100
                }
                y={
                  detection.nbox[1] *
                  100
                }
                width={
                  (
                    detection.nbox[2] -
                    detection.nbox[0]
                  ) *
                  100
                }
                height={
                  (
                    detection.nbox[3] -
                    detection.nbox[1]
                  ) *
                  100
                }
                fill="rgba(239,68,68,0.07)"
                stroke="#EF4444"
                strokeWidth="0.42"
              />
            )
          )}

          {/* --------------------------------------------------
              PARKING SLOT POLYGONS
          -------------------------------------------------- */}

          {slots.map(
            (slot) => (
              <polygon
                key={slot.id}
                points={polygonPoints(
                  slot.polygon
                )}
                fill={getSlotFill(
                  slot
                )}
                stroke={getSlotStroke(
                  slot
                )}
                strokeWidth={
                  analysisDone
                    ? "0.5"
                    : "0.35"
                }
              />
            )
          )}

          {/* --------------------------------------------------
              DRAFT POLYGON
          -------------------------------------------------- */}

          {draft.length >
            0 && (
            <polygon
              points={polygonPoints(
                draft
              )}
              fill="rgba(6,182,212,0.20)"
              stroke="#06B6D4"
              strokeWidth="0.5"
              strokeDasharray="1 0.6"
            />
          )}

          {/* --------------------------------------------------
              DRAFT POINTS
          -------------------------------------------------- */}

          {draft.map(
            (point, index) => (
              <circle
                key={`draft-${index}`}
                cx={
                  point[0] *
                  100
                }
                cy={
                  point[1] *
                  100
                }
                r="0.8"
                fill="#06B6D4"
              />
            )
          )}

        </svg>


        {/* ====================================================
            SLOT LABELS
        ==================================================== */}

        <div className="pointer-events-none absolute inset-0">

          {slots.map(
            (slot) => {
              const [
                centerX,
                centerY,
              ] =
                getPolygonCenter(
                  slot.polygon
                );

              const status =
                getStatusText(
                  slot
                );

              return (
                <div
                  key={`${slot.id}-label`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1 font-mono text-[10px] font-bold shadow-lg"
                  style={{
                    left: `${centerX * 100}%`,
                    top: `${centerY * 100}%`,
                    borderColor:
                      getSlotStroke(
                        slot
                      ),
                    background:
                      "rgba(0,0,0,0.80)",
                    color:
                      getSlotStroke(
                        slot
                      ),
                  }}
                >

                  <div>
                    {slot.label}
                  </div>

                  {analysisDone && (
                    <div className="text-[8px]">
                      {status}
                    </div>
                  )}

                </div>
              );
            }
          )}

        </div>


        {/* ====================================================
            INSTRUCTION
        ==================================================== */}

        {!analysisDone && (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/70 px-3 py-1.5 text-xs text-white">

            <MousePointerClick className="h-3.5 w-3.5 text-sp-accent" />

            Click the actual
            parking-slot corners

          </div>
        )}


        {/* ====================================================
            ANALYZING
        ==================================================== */}

        {analyzing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35">

            <div className="flex items-center gap-2 rounded-lg border border-sp-accent/40 bg-black/85 px-4 py-3 text-sm text-white">

              <Loader2 className="h-4 w-4 animate-spin text-sp-accent" />

              Running YOLOv8
              vehicle detection...

            </div>

          </div>
        )}

      </div>


      {/* ======================================================
          RESULT SUMMARY
      ====================================================== */}

      {analysisDone && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">

          {/* TOTAL */}

          <div className="rounded-lg border border-sp-border bg-sp-bg p-3">

            <div className="text-[10px] uppercase tracking-wider text-sp-sub">
              Total Slots
            </div>

            <div className="mt-1 font-display text-xl font-bold">
              {slots.length}
            </div>

          </div>


          {/* FREE */}

          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">

            <div className="text-[10px] uppercase tracking-wider text-green-400">
              Free
            </div>

            <div className="mt-1 font-display text-xl font-bold text-green-400">
              {freeCount}
            </div>

          </div>


          {/* OCCUPIED */}

          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">

            <div className="text-[10px] uppercase tracking-wider text-red-400">
              Occupied
            </div>

            <div className="mt-1 font-display text-xl font-bold text-red-400">
              {occupiedCount}
            </div>

          </div>


          {/* UNKNOWN */}

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">

            <div className="text-[10px] uppercase tracking-wider text-amber-400">
              Unknown
            </div>

            <div className="mt-1 font-display text-xl font-bold text-amber-400">
              {unknownCount}
            </div>

          </div>

        </div>
      )}


      {/* ======================================================
          CONTROLS
      ====================================================== */}

      <div className="flex flex-wrap items-center gap-2">

        <Input
          value={label}
          onChange={(event) =>
            setLabel(
              event.target.value
            )
          }
          placeholder="Slot label e.g. S1"
          className="w-40 bg-sp-bg"
          disabled={analyzing}
        />


        <Button
          onClick={
            finishSlot
          }
          disabled={
            analyzing
          }
          className="bg-sp-accent text-sp-bg hover:bg-sky-400"
        >

          <Check className="mr-1 h-4 w-4" />

          Add Slot

        </Button>


        <Button
          onClick={
            undoPoint
          }
          variant="outline"
          disabled={
            draft.length ===
              0 ||
            analyzing
          }
          className="border-sp-border"
        >

          <Undo2 className="mr-1 h-4 w-4" />

          Undo Point

        </Button>


        <Button
          onClick={
            clearDraft
          }
          variant="ghost"
          disabled={
            draft.length ===
              0 ||
            analyzing
          }
          className="text-sp-sub hover:text-white"
        >
          Clear Draft
        </Button>


        {/* ====================================================
            YOLO
        ==================================================== */}

        <Button
          onClick={
            analyzeWithYOLO
          }
          disabled={
            analyzing ||
            slots.length ===
              0 ||
            !imageUrl
          }
          className="bg-purple-500 text-white hover:bg-purple-600"
        >

          {analyzing ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <ScanSearch className="mr-1 h-4 w-4" />
              Analyze with YOLO
            </>
          )}

        </Button>


        <span className="ml-auto font-mono text-xs text-sp-sub">
          {slots.length} slots ·{" "}
          {draft.length} draft pts
        </span>

      </div>


      {/* ======================================================
          MAPPED SLOTS
      ====================================================== */}

      {slots.length > 0 && (
        <div className="rounded-lg border border-sp-border bg-sp-bg p-3">

          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-sp-sub">
            Mapped Parking Slots
          </div>


          <div className="flex flex-wrap gap-2">

            {slots.map(
              (slot) => {

                const status =
                  slotStatus[
                    slot.id
                  ]?.status;

                const color =
                  getSlotStroke(
                    slot
                  );

                return (
                  <div
                    key={slot.id}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                    style={{
                      borderColor:
                        color,
                    }}
                  >

                    <span
                      className="font-mono text-xs font-bold"
                      style={{
                        color,
                      }}
                    >
                      {slot.label}
                    </span>


                    {analysisDone && (
                      <span
                        className="text-[10px]"
                        style={{
                          color,
                        }}
                      >
                        {status}
                      </span>
                    )}


                    <span className="text-[10px] text-sp-sub">
                      {slot.polygon.length}
                      pt
                    </span>


                    <button
                      onClick={() =>
                        removeSlot(
                          slot.id
                        )
                      }
                      disabled={
                        analyzing
                      }
                      className="text-sp-sub transition hover:text-red-400"
                      title={`Remove ${slot.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>

                  </div>
                );
              }
            )}

          </div>

        </div>
      )}

    </div>
  );
}