
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import api, { apiErr } from "../lib/api";
import TryDetection from "../components/TryDetection";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import {
  Radio,
  Cctv,
  Cpu,
  Boxes,
  Wifi,
  ShieldCheck,
  ArrowRight,
  Zap,
  Send,
} from "lucide-react";

const FEATURES = [
  {
    icon: Cpu,
    t: "YOLOv8n Edge Inference",
    d: "CPU-efficient vehicle detection that works without requiring a dedicated GPU.",
  },
  {
    icon: Boxes,
    t: "Polygon Slot Mapping",
    d: "Configure parking slots for each camera and detect occupancy using mapped slot boundaries.",
  },
  {
    icon: Wifi,
    t: "Real-time Monitoring",
    d: "Monitor FREE, OCCUPIED, and UNKNOWN parking slot status through the connected system.",
  },
  {
    icon: ShieldCheck,
    t: "Multi-client Isolation",
    d: "Client data and parking information are scoped to authorized accounts by the backend.",
  },
];

const EMPTY_FORM = {
  name: "",
  contact_number: "",
  email: "",
  company: "",
  site_location: "",
  camera_count: 3,
  has_smart_cameras: "not_sure",
  message: "",
};

export default function Landing() {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);

  const updateField = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();

    if (sending) return;

    const phone = form.contact_number.trim();

    if (!phone) {
      toast.error("Please enter your contact number.");
      return;
    }

    setSending(true);

    try {
      const fd = new FormData();

      Object.entries(form).forEach(([key, value]) => {
        fd.append(key, String(value));
      });

      if (file) {
        fd.append("reference_image", file);
      }

      await api.post("/enquiries", fd, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      toast.success(
        "Enquiry submitted successfully! Our team will contact you shortly."
      );

      setForm({ ...EMPTY_FORM });
      setFile(null);

      const fileInput = document.getElementById("enquiry-image");
      if (fileInput) fileInput.value = "";
    } catch (error) {
      toast.error(apiErr(error) || "Unable to submit your enquiry.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Navigation */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-white shadow-sm">
              <Radio className="h-5 w-5" />
            </div>

            <span className="font-display text-2xl font-bold tracking-wide">
              EzySlot<span className="text-orange-600">.AI</span>
            </span>
          </Link>

          <nav className="flex items-center gap-3">
            <a
              href="#try"
              className="hidden text-sm text-slate-600 transition hover:text-orange-600 sm:block"
            >
              Try Detection
            </a>

            <a
              href="#enquiry"
              className="hidden text-sm text-slate-600 transition hover:text-orange-600 sm:block"
            >
              Enquiry
            </a>

            <Link to="/login">
              <Button
                data-testid="header-login-btn"
                className="bg-orange-500 text-white hover:bg-orange-600"
              >
                Portal Login
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200">
        <img
          src="https://images.pexels.com/photos/30546990/pexels-photo-30546990.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
          alt="Parking surveillance"
          className="absolute inset-0 h-full w-full object-cover opacity-20"
        />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(255,90,31,0.12),transparent_35%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/85 via-white/95 to-white" />

        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-12 lg:py-28">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="lg:col-span-7"
          >
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 font-mono text-xs uppercase tracking-widest text-orange-600">
              <Zap className="h-3.5 w-3.5" />
              AI Parking Intelligence
            </div>

            <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              See every parking slot
              <br />
              <span className="text-orange-600">flip in real time.</span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-600">
              EzySlot AI turns supported camera feeds into parking occupancy
              intelligence. YOLOv8 detects vehicles, maps them to configured
              parking slots, and provides FREE, OCCUPIED, and UNKNOWN status.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#try">
                <Button
                  data-testid="hero-try-btn"
                  size="lg"
                  className="bg-orange-500 text-white hover:bg-orange-600"
                >
                  Try Live Detection
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>

              <a href="#enquiry">
                <Button
                  data-testid="hero-enquiry-btn"
                  size="lg"
                  variant="outline"
                  className="border-orange-200 text-slate-900 hover:bg-orange-50"
                >
                  Request a Deployment
                </Button>
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-8 font-mono">
              {[
                ["AI", "vehicle detection"],
                ["Live", "parking monitoring"],
                ["Multi-site", "camera management"],
              ].map(([value, label]) => (
                <div key={label}>
                  <div className="text-2xl font-bold text-slate-900">
                    {value}
                  </div>
                  <div className="text-xs uppercase tracking-widest text-slate-500">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative lg:col-span-5"
          >
            <div className="rounded-2xl border border-orange-100 bg-white p-2 shadow-[0_20px_60px_rgba(255,90,31,0.12)]">
              <img
                src="https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=800&q=80"
                alt="Parking area"
                className="w-full rounded-xl object-cover"
              />
            </div>

            <div className="absolute -bottom-4 -left-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono text-sm shadow-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              <span className="font-bold text-emerald-700">
                Smart Parking
              </span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Try Detection */}
      <section id="try" className="mx-auto max-w-7xl px-6 py-20">
        <div className="mb-10 flex items-center gap-3">
          <Cctv className="h-6 w-6 text-orange-600" />
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Try Detection — no login needed
          </h2>
        </div>

        <TryDetection />
      </section>

      {/* Features */}
      <section className="border-y border-orange-100 bg-orange-50/60">
        <div className="mx-auto grid max-w-7xl gap-6 px-6 py-20 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.t}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.08 }}
              className="rounded-xl border border-slate-200 bg-white p-6 transition-colors hover:border-orange-200 hover:bg-orange-50"
            >
              <feature.icon className="mb-4 h-8 w-8 text-orange-600" />

              <h3 className="font-display text-xl font-semibold">
                {feature.t}
              </h3>

              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {feature.d}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Company Enquiry */}
      <section id="enquiry" className="mx-auto max-w-3xl px-6 py-20">
        <div className="mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 font-mono text-xs uppercase tracking-widest text-orange-600">
            <Send className="h-3.5 w-3.5" />
            Deployment enquiry
          </div>

          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Request a Deployment
          </h2>

          <p className="mt-2 leading-relaxed text-slate-600">
            Tell us about your company, parking location, and camera
            requirements. Our team will review your enquiry and contact you
            with suitable plans.
          </p>
        </div>

        <form
          onSubmit={submit}
          data-testid="enquiry-form"
          className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_10px_40px_rgba(15,23,42,0.06)] md:p-8"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Contact person *
              </label>
              <Input
                required
                data-testid="enquiry-name"
                placeholder="Your full name"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                className="border-slate-200 bg-white focus-visible:ring-orange-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Contact number *
              </label>
              <Input
                required
                type="tel"
                data-testid="enquiry-contact-number"
                placeholder="e.g. +91 9876543210"
                autoComplete="tel"
                value={form.contact_number}
                onChange={(e) =>
                  updateField("contact_number", e.target.value)
                }
                className="border-slate-200 bg-white focus-visible:ring-orange-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Business email *
              </label>
              <Input
                required
                type="email"
                data-testid="enquiry-email"
                placeholder="name@company.com"
                autoComplete="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                className="border-slate-200 bg-white focus-visible:ring-orange-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Company / brand name *
              </label>
              <Input
                required
                data-testid="enquiry-company"
                placeholder="Your company name"
                value={form.company}
                onChange={(e) => updateField("company", e.target.value)}
                className="border-slate-200 bg-white focus-visible:ring-orange-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Parking site location *
              </label>
              <Input
                required
                data-testid="enquiry-site"
                placeholder="City, area, and site name"
                value={form.site_location}
                onChange={(e) => updateField("site_location", e.target.value)}
                className="border-slate-200 bg-white focus-visible:ring-orange-500"
              />
            </div>
          </div>

          {/* Number of cameras */}
          <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label
                htmlFor="enquiry-cameras"
                className="font-medium text-slate-800"
              >
                How many cameras do you need to monitor?
              </label>

              <span className="rounded-lg bg-orange-100 px-3 py-1 font-mono text-sm font-bold text-orange-700">
                {form.camera_count}
              </span>
            </div>

            <input
              id="enquiry-cameras"
              type="range"
              min="1"
              max="100"
              step="1"
              data-testid="enquiry-cameras"
              value={form.camera_count}
              onChange={(e) =>
                updateField("camera_count", Number(e.target.value))
              }
              className="w-full cursor-pointer accent-orange-500"
            />

            <div className="mt-1 flex justify-between text-xs text-slate-500">
              <span>1 camera</span>
              <span>100 cameras</span>
            </div>
          </div>

          {/* Existing camera availability */}
          <div>
            <label
              htmlFor="enquiry-smart-cameras"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Do you already have smart / IP cameras? *
            </label>

            <select
              id="enquiry-smart-cameras"
              data-testid="enquiry-smart-cameras"
              required
              value={form.has_smart_cameras}
              onChange={(e) =>
                updateField("has_smart_cameras", e.target.value)
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            >
              <option value="yes">Yes, we already have cameras</option>
              <option value="no">
                No, I need cameras supplied and installed
              </option>
              <option value="not_sure">Not sure — I need guidance</option>
            </select>

            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Camera supply and installation, if required, will be discussed
              separately and quoted according to your site requirements.
            </p>
          </div>

          {/* Additional requirements */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Additional requirements (optional)
            </label>

            <Textarea
              data-testid="enquiry-message"
              placeholder="Parking capacity, number of entrances, camera models, site details, or other requirements..."
              value={form.message}
              onChange={(e) => updateField("message", e.target.value)}
              className="min-h-28 border-slate-200 bg-white focus-visible:ring-orange-500"
            />
          </div>

          {/* Optional reference image */}
          <div>
            <label
              htmlFor="enquiry-image"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Parking site / camera reference image (optional)
            </label>

            <input
              id="enquiry-image"
              type="file"
              accept="image/*"
              data-testid="enquiry-image"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-50 file:px-4 file:py-2 file:font-medium file:text-orange-700 hover:file:bg-orange-100"
            />
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            Submitting this form sends an enquiry for review only. It does not
            automatically create an account, activate a subscription, or
            process a payment.
          </p>

          <Button
            type="submit"
            disabled={sending}
            data-testid="enquiry-submit"
            className="w-full bg-orange-500 text-white shadow-sm hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? (
              "Submitting enquiry..."
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Submit Enquiry
              </>
            )}
          </Button>
        </form>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-slate-50 py-8 text-center font-mono text-xs text-slate-500">
        EzySlot.AI · YOLOv8 · FastAPI · MongoDB · WebSocket · © 2026
      </footer>
    </div>
  );
}
