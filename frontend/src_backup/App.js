
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import PortalLayout from "./components/PortalLayout";

import Landing from "./pages/Landing";
import Login from "./pages/Login";

import ClientDashboard from "./pages/client/ClientDashboard";
import ClientLive from "./pages/client/ClientLive";
import ClientHistory from "./pages/client/ClientHistory";
import ClientTickets from "./pages/client/ClientTickets";
import ClientService from "./pages/client/ClientService";
import ClientVehicleRegistry from "./pages/client/ClientVehicleRegistry";

import DevOverview from "./pages/dev/DevOverview";
import DevClients from "./pages/dev/DevClients";
import DevEnquiries from "./pages/dev/DevEnquiries";
import DevCameras from "./pages/dev/DevCameras";
import DevTickets from "./pages/dev/DevTickets";
import DevHealth from "./pages/dev/DevHealth";
import DevNumberPlateRecognition from "./pages/dev/DevNumberPlateRecognition";

import { Loader2 } from "lucide-react";

import {
  Monitor,
  History,
  LifeBuoy,
  ReceiptText,
  LayoutDashboard,
  Users,
  Inbox,
  Cctv,
  Ticket,
  HeartPulse,
  CarFront,
  ScanLine,
} from "lucide-react";

function Protected({ role, children }) {
  const { user, ready } = useAuth();

  if (!ready || user === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-sp-bg">
        <Loader2 className="h-8 w-8 animate-spin text-sp-accent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (role && user.role !== role) {
    return (
      <Navigate
        to={user.role === "developer" ? "/ops" : "/app"}
        replace
      />
    );
  }

  return children;
}

const CLIENT_NAV = [
  {
    to: "/app",
    end: true,
    label: "Dashboard",
    icon: LayoutDashboard,
    testid: "dashboard",
  },
  {
    to: "/app/live",
    label: "Live Monitor",
    icon: Monitor,
    testid: "live",
  },
  {
    to: "/app/vehicles",
    label: "Vehicle Registry",
    icon: CarFront,
    testid: "vehicle-registry",
  },
  {
    to: "/app/history",
    label: "History",
    icon: History,
    testid: "history",
  },
  {
    to: "/app/tickets",
    label: "Support",
    icon: LifeBuoy,
    testid: "tickets",
  },
  {
    to: "/app/service",
    label: "Service & Fare",
    icon: ReceiptText,
    testid: "service",
  },
];

const DEV_NAV = [
  {
    to: "/ops",
    end: true,
    label: "Operations",
    icon: LayoutDashboard,
    testid: "overview",
  },
  {
    to: "/ops/clients",
    label: "Clients",
    icon: Users,
    testid: "clients",
  },
  {
    to: "/ops/enquiries",
    label: "Enquiries",
    icon: Inbox,
    testid: "enquiries",
  },
  {
    to: "/ops/cameras",
    label: "Cameras & Slots",
    icon: Cctv,
    testid: "cameras",
  },
  {
    to: "/ops/number-plate",
    label: "Number Plate Recognition",
    icon: ScanLine,
    testid: "number-plate",
  },
  {
    to: "/ops/tickets",
    label: "Tickets",
    icon: Ticket,
    testid: "tickets",
  },
  {
    to: "/ops/health",
    label: "System Health",
    icon: HeartPulse,
    testid: "health",
  },
];

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" theme="dark" richColors />

        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          <Route
            path="/app"
            element={
              <Protected role="client">
                <PortalLayout
                  nav={CLIENT_NAV}
                  title="Parking Dashboard"
                  badge="Client Portal"
                />
              </Protected>
            }
          >
            <Route index element={<ClientDashboard />} />
            <Route path="live" element={<ClientLive />} />
            <Route path="vehicles" element={<ClientVehicleRegistry />} />
            <Route path="history" element={<ClientHistory />} />
            <Route path="tickets" element={<ClientTickets />} />
            <Route path="service" element={<ClientService />} />
          </Route>

          <Route
            path="/ops"
            element={
              <Protected role="developer">
                <PortalLayout
                  nav={DEV_NAV}
                  title="Operations Center"
                  badge="Developer"
                />
              </Protected>
            }
          >
            <Route index element={<DevOverview />} />
            <Route path="clients" element={<DevClients />} />
            <Route path="enquiries" element={<DevEnquiries />} />
            <Route path="cameras" element={<DevCameras />} />
            <Route
              path="number-plate"
              element={<DevNumberPlateRecognition />}
            />
            <Route path="tickets" element={<DevTickets />} />
            <Route path="health" element={<DevHealth />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
