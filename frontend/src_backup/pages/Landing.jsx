import React, { useState } from "react";

import { Link } from "react-router-dom";

import { motion } from "framer-motion";

import api, { apiErr } from "../lib/api";

import TryDetection from "../components/TryDetection";

import { Button } from "../components/ui/button";

import { Input } from "../components/ui/input";

import { Textarea } from "../components/ui/textarea";

import { toast } from "sonner";

import { Radio, Cctv, Cpu, Boxes, Wifi, ShieldCheck, ArrowRight, Zap, Send } from "lucide-react";



const FEATURES = [

  { icon: Cpu, t: "YOLOv8n Edge Inference", d: "CPU-throttled detection at ~1 frame/2s. Smooth on any laptop, no GPU needed." },

  { icon: Boxes, t: "Polygon Slot Mapping", d: "Draw slots once per camera. Occupancy is automatic via box-vs-polygon overlap." },

  { icon: Wifi, t: "Real-time WebSocket", d: "Slots flip FREE ↔ OCCUPIED live. No polling, no lag, glanceable status." },

  { icon: ShieldCheck, t: "Multi-client Isolation", d: "Every query scoped by client_id at the backend. Enforced, not UI-only." },

];



export default function Landing() {

  const [form, setForm] = useState({ name: "", email: "", company: "", site_location: "", camera_count: 3, message: "" });

  const [file, setFile] = useState(null);

  const [sending, setSending] = useState(false);



  const submit = async (e) => {

    e.preventDefault();

    setSending(true);

    try {

      const fd = new FormData();

      Object.entries(form).forEach(([k, v]) => fd.append(k, v));

      if (file) fd.append("reference_image", file);

      await api.post("/enquiries", fd, { headers: { "Content-Type": "multipart/form-data" } });

      toast.success("Enquiry submitted! Our team will reach out shortly.");

      setForm({ name: "", email: "", company: "", site_location: "", camera_count: 3, message: "" });

      setFile(null);

    } catch (e2) { toast.error(apiErr(e2)); } finally { setSending(false); }

  };



  return (

    <div className="min-h-screen bg-white text-slate-900">

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-xl">

        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">

          <div className="flex items-center gap-2">

            <div className="grid h-9 w-9 place-items-center rounded-lg bg-orange-500 text-white shadow-sm"><Radio className="h-5 w-5" /></div>

            <span className="font-display text-2xl font-bold tracking-wide">EzySlot<span className="text-orange-600">.AI</span></span>

          </div>

          <div className="flex items-center gap-3">

            <a href="#try" className="hidden text-sm text-slate-600 hover:text-slate-900 sm:block">Try Detection</a>

            <a href="#enquiry" className="hidden text-sm text-slate-600 hover:text-slate-900 sm:block">Enquiry</a>

            <Link to="/login"><Button data-testid="header-login-btn" className="bg-orange-500 text-white hover:bg-orange-600">Portal Login</Button></Link>

          </div>

        </div>

      </header>



      {/* Hero */}

      <section className="relative overflow-hidden border-b border-slate-200">

        <img src="https://images.pexels.com/photos/30546990/pexels-photo-30546990.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"

          alt="surveillance" className="absolute inset-0 h-full w-full object-cover opacity-20" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(255,90,31,0.10),transparent_35%)]" />

        <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-white/95 to-white" />

        <div className="relative mx-auto grid max-w-7xl gap-10 px-6 py-20 lg:grid-cols-12 lg:py-28">

          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="lg:col-span-7">

            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 font-mono text-xs uppercase tracking-widest text-orange-600">

              <Zap className="h-3.5 w-3.5" /> AI Parking Intelligence

            </div>

            <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">

              See every parking slot<br /><span className="text-orange-600">flip in real time.</span>

            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-600">

              EzySlot AI turns any camera feed into live occupancy intelligence. YOLOv8 detects vehicles,

              maps them onto your drawn slots, and streams FREE / OCCUPIED / UNKNOWN status to every screen.

            </p>

            <div className="mt-8 flex flex-wrap gap-3">

              <a href="#try"><Button data-testid="hero-try-btn" size="lg" className="bg-orange-500 text-white hover:bg-orange-600">Try Live Detection <ArrowRight className="ml-2 h-4 w-4" /></Button></a>

              <a href="#enquiry"><Button data-testid="hero-enquiry-btn" size="lg" variant="outline" className="border-slate-200 text-slate-900 hover:bg-orange-50">Request a Demo</Button></a>

            </div>

            <div className="mt-10 flex gap-8 font-mono">

              {[["99.2%", "detection accuracy"], ["~55ms", "CPU inference"], ["3", "live cameras"]].map(([n, l]) => (

                <div key={l}><div className="text-2xl font-bold text-slate-900">{n}</div><div className="text-xs uppercase tracking-widest text-slate-600">{l}</div></div>

              ))}

            </div>

          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.2 }}

            className="relative lg:col-span-5">

            <div className="rounded-2xl border border-orange-100 bg-white p-2 shadow-[0_20px_60px_rgba(255,90,31,0.12)]">

              <img src="https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=800&q=80" alt="parking lot"

                className="rounded-xl" />

            </div>

            <div className="absolute -bottom-4 -left-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono text-sm glow-free">

              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-ring" /> <span className="text-emerald-700 font-bold">14 FREE</span>

            </div>

          </motion.div>

        </div>

      </section>



      {/* Try Detection */}

      <section id="try" className="mx-auto max-w-7xl px-6 py-20">

        <div className="mb-10 flex items-center gap-3">

          <Cctv className="h-6 w-6 text-orange-600" />

          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Try Detection — no login needed</h2>

        </div>

        <TryDetection />

      </section>



      {/* Features */}

      <section className="border-y border-slate-200 bg-orange-50/70">

        <div className="mx-auto grid max-w-7xl gap-6 px-6 py-20 md:grid-cols-2 lg:grid-cols-4">

          {FEATURES.map((f, i) => (

            <motion.div key={f.t} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}

              className="rounded-xl border border-slate-200 bg-white p-6 transition-colors hover:bg-orange-50">

              <f.icon className="mb-4 h-8 w-8 text-orange-600" />

              <h3 className="font-display text-xl font-semibold">{f.t}</h3>

              <p className="mt-2 text-sm text-slate-600">{f.d}</p>

            </motion.div>

          ))}

        </div>

      </section>



      {/* Enquiry */}

      <section id="enquiry" className="mx-auto max-w-3xl px-6 py-20">

        <div className="mb-8 text-center">

          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Request a Deployment</h2>

          <p className="mt-2 text-slate-600">Tell us about your site. We'll provision a client portal with your cameras and slots.</p>

        </div>

        <form onSubmit={submit} data-testid="enquiry-form" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">

          <div className="grid gap-4 sm:grid-cols-2">

            <Input required data-testid="enquiry-name" placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-white" />

            <Input required type="email" data-testid="enquiry-email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-white" />

            <Input data-testid="enquiry-company" placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="bg-white" />

            <Input required data-testid="enquiry-site" placeholder="Site location" value={form.site_location} onChange={(e) => setForm({ ...form, site_location: e.target.value })} className="bg-white" />

          </div>

          <div>

            <label className="mb-2 block font-mono text-xs uppercase tracking-widest text-slate-600">Cameras: {form.camera_count}</label>

            <input type="range" min="1" max="20" data-testid="enquiry-cameras" value={form.camera_count}

              onChange={(e) => setForm({ ...form, camera_count: Number(e.target.value) })} className="w-full accent-orange-500" />

          </div>

          <Textarea data-testid="enquiry-message" placeholder="Tell us about your requirement…" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="bg-white" />

          <div className="flex items-center gap-3">

            <input type="file" accept="image/*" data-testid="enquiry-image" onChange={(e) => setFile(e.target.files?.[0])}

              className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-orange-50 file:px-3 file:py-1.5 file:text-slate-900" />

          </div>

          <Button type="submit" disabled={sending} data-testid="enquiry-submit" className="w-full bg-orange-500 text-white hover:bg-orange-600">

            {sending ? "Submitting…" : <><Send className="mr-2 h-4 w-4" /> Submit Enquiry</>}

          </Button>

        </form>

      </section>



      <footer className="border-t border-slate-200 py-8 text-center font-mono text-xs text-slate-500">

        EzySlot.AI · YOLOv8 · FastAPI · MongoDB · WebSocket · © 2026

      </footer>

    </div>

  );

}
