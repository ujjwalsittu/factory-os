import { buttonClass, Logo } from '@factoryos/ui';
import {
  ArrowRight,
  Boxes,
  Cpu,
  FileCheck2,
  Fingerprint,
  GitBranch,
  Keyboard,
  Landmark,
  Lock,
  ScrollText,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme';

const CONTACT = 'https://www.azeonics.com/';

const FEATURES = [
  {
    icon: Boxes,
    title: 'Manufacturing',
    body: 'BOMs and routings with revision control, work orders, job cards on the shop floor, heat-number and serial genealogy, FAI and NCR.',
  },
  {
    icon: Wrench,
    title: 'Services & pay-per-use',
    body: 'Machine-hours, test campaigns, studio memberships and subscriptions, billed from real usage rather than timesheets.',
  },
  {
    icon: FileCheck2,
    title: 'India compliance',
    body: 'GSTR-1 and 3B, 2B reconciliation, e-invoice and e-way bill, TDS/TCS, MSME 45-day tracking and ITC-04, through the GSP you choose.',
  },
  {
    icon: Cpu,
    title: 'Machines & IoT',
    body: 'IPC-CFX, MTConnect, OPC UA and our own retrofit sensors. Live machine states, OEE, and spindle-hours that turn into invoices.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-[13px] font-medium text-muted md:flex" aria-label="Product">
            <a href="#product" className="hover:text-fg">Product</a>
            <a href="#compliance" className="hover:text-fg">Compliance</a>
            <a href="#traceability" className="hover:text-fg">Traceability</a>
            <a href="#security" className="hover:text-fg">Security</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/sign-in" className={buttonClass('ghost', 'sm')}>Sign in</Link>
            <a href={CONTACT} className={buttonClass('primary', 'sm')}>Book a demo</a>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 -top-40 h-[520px] bg-[radial-gradient(ellipse_at_center,var(--accent-soft)_0%,transparent_65%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 md:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-muted">
                <span className="size-1.5 rounded-full bg-success" /> Built in India, for Indian manufacturers
              </p>
              <h1 className="mt-5 text-4xl leading-[1.1] font-semibold tracking-tight text-fg md:text-5xl">
                The operating system for precision manufacturing and services.
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">
                Batches to balance sheet in one place. GST, e-invoice and e-way bill built in. Every part traceable to its heat number. Machines connected and metered.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={CONTACT} className={buttonClass('primary', 'lg')}>
                  Book a demo <ArrowRight className="size-4" />
                </a>
                <Link href="/sign-in" className={buttonClass('secondary', 'lg')}>Sign in</Link>
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        {/* Trust row */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-6 text-[13px] font-medium text-muted md:grid-cols-4 md:px-6">
            {['AS9100-ready traceability', 'GST · IRN · E-way bill', 'Multi-entity books', 'Data hosted in India'].map((t) => (
              <div key={t} className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-accent" /> {t}
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="product" className="mx-auto max-w-6xl px-4 py-20 md:px-6">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">One system for the shop floor, the test lab and the accounts team.</h2>
          <p className="mt-3 max-w-2xl text-muted">Designed for job shops, aerospace and electronics manufacturers, and the service businesses that run beside them.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
                <div className="inline-flex rounded-xl bg-accent-soft p-2.5 text-accent">
                  <f.icon className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Traceability */}
        <section id="traceability" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:px-6 lg:grid-cols-2">
            <div>
              <p className="text-[13px] font-semibold tracking-wider text-accent uppercase">Traceability</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Trace any part from heat number to delivered serial.</h2>
              <p className="mt-4 text-muted">
                Every issue, operation and inspection writes to an append-only genealogy. Ask which customers received parts cut from a suspect bar, or which reels went into a board. You get the answer in one click, with certificates attached.
              </p>
            </div>
            <Genealogy />
          </div>
        </section>

        {/* Compliance + Tally */}
        <section id="compliance" className="mx-auto grid max-w-6xl gap-6 px-4 py-20 md:px-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-8 shadow-card">
            <Landmark className="size-6 text-accent" />
            <h3 className="mt-4 text-xl font-semibold">Compliance that runs itself</h3>
            <ul className="mt-4 space-y-2 text-[14px] text-muted">
              <li>• IRN and e-way bill on submit, through NIC or any GSP you choose for each GSTIN</li>
              <li>• GSTR-1 and 3B prepared from your books, 2B and IMS matched automatically</li>
              <li>• Returns filed after Accounts and the Finance Controller approve them</li>
              <li>• TDS/TCS sections, MSME 45-day alerts and ITC-04 from job-work challans</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-8 shadow-card">
            <Keyboard className="size-6 text-accent" />
            <h3 className="mt-4 text-xl font-semibold">Feels familiar to Tally users</h3>
            <p className="mt-4 text-[14px] text-muted">Voucher keys, Gateway-style reports with drill-down, and Tally group names. Import your history and keep Tally in sync while your CA moves over.</p>
            <div className="mt-5 flex flex-wrap gap-2 font-mono text-[12px]">
              {['F4 Contra', 'F5 Payment', 'F6 Receipt', 'F7 Journal', 'F8 Sales', 'F9 Purchase'].map((k) => (
                <kbd key={k} className="rounded-md border border-line bg-surface-2 px-2 py-1">{k}</kbd>
              ))}
            </div>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">Secure by design</h2>
            <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Fingerprint, t: 'Two-factor sign-in', b: 'Authenticator apps and backup codes, with SSO to follow.' },
                { icon: Lock, t: 'Role and entity scoping', b: 'Permissions per module and action, limited to the entities each person works in.' },
                { icon: ScrollText, t: 'Tamper-evident audit trail', b: 'Hash-chained log of every change, as the Companies Act requires.' },
                { icon: GitBranch, t: 'Maker-checker', b: 'The person who prepares a return or payment can never approve it.' },
              ].map(({ icon: Icon, t, b }) => (
                <div key={t}>
                  <Icon className="size-5 text-accent" />
                  <h3 className="mt-3 font-semibold">{t}</h3>
                  <p className="mt-1 text-[14px] text-muted">{b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 py-20 md:px-6">
          <div className="rounded-3xl bg-[#10123a] px-8 py-14 text-center text-white md:px-16">
            <h2 className="text-3xl font-semibold tracking-tight">Ready to run your factory on FactoryOS?</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/70">See it with your own parts, machines and GSTINs.</p>
            <div className="mt-8 flex justify-center gap-3">
              <a href={CONTACT} className={buttonClass('primary', 'lg', 'bg-white text-[#10123a] hover:bg-white/90')}>Book a demo</a>
              <Link href="/sign-in" className={buttonClass('ghost', 'lg', 'text-white hover:bg-white/10 hover:text-white')}>Sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-8 text-[13px] text-muted md:px-6">
          <Logo className="text-[15px]" />
          <span>© {new Date().getFullYear()} Azeonics Private Limited, Thane, Maharashtra</span>
          <span className="ml-auto">Data hosted in India · DPDP Act aligned</span>
        </div>
      </footer>
    </div>
  );
}

/** A lightweight, code-drawn preview of the work-order cockpit (no screenshots to maintain). */
function ProductPreview() {
  const ops = [
    { op: 'OP10 Rough mill', m: 'M-03 Mazak', s: 'Done', tone: 'bg-success-soft text-success', w: 'w-full' },
    { op: 'OP20 Finish mill', m: 'M-03 Mazak', s: 'Running', tone: 'bg-info-soft text-info', w: 'w-2/3' },
    { op: 'OP30 Deburr', m: 'Bench 2', s: 'Queued', tone: 'bg-surface-2 text-muted', w: 'w-0' },
    { op: 'OP40 CMM inspection', m: 'Mitutoyo CMM', s: 'Queued', tone: 'bg-surface-2 text-muted', w: 'w-0' },
  ];
  return (
    <div className="relative" aria-hidden>
      <div className="absolute -inset-4 rounded-[28px] bg-gradient-to-br from-accent/20 to-cyan-500/10 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-line bg-surface-2/60 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 font-mono text-[11px] text-subtle">factoryos / work orders / WO-0123</span>
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-mono text-[11px] text-subtle">WO-0123 · Bracket rev C</p>
              <p className="mt-0.5 font-semibold">Satellite bracket, Ti-6Al-4V</p>
            </div>
            <span className="rounded-md bg-info-soft px-2 py-0.5 text-[11px] font-medium text-info">In progress</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-[11px]">
            {[
              ['Good', '4 / 10'],
              ['Heat no.', 'HN-23-4471'],
              ['Machine', '● Running 01:12'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line px-3 py-2">
                <p className="text-subtle">{k}</p>
                <p className="mt-0.5 font-mono font-medium text-fg">{v}</p>
              </div>
            ))}
          </div>
          <ul className="mt-4 space-y-2">
            {ops.map((o) => (
              <li key={o.op} className="rounded-lg border border-line px-3 py-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium">{o.op}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${o.tone}`}>{o.s}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="w-24 shrink-0 text-[10px] text-subtle">{o.m}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span className={`block h-full rounded-full bg-accent ${o.w}`} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Genealogy() {
  const nodes = [
    { x: 20, y: 20, t: 'PO-0087', s: 'Supplier PO' },
    { x: 20, y: 120, t: 'HN-23-4471', s: 'Ti bar · MTC' },
    { x: 220, y: 70, t: 'WO-0123', s: '5-axis · OP10–40' },
    { x: 420, y: 20, t: 'AZ-BRK-041', s: 'Serial · FAI ✓' },
    { x: 420, y: 120, t: 'SAT-ASSY-07', s: 'Assembly · CoC' },
  ];
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
  ] as const;
  const c = (i: number) => ({ x: nodes[i]!.x + 75, y: nodes[i]!.y + 26 });
  return (
    <svg viewBox="0 0 590 180" className="w-full" role="img" aria-label="Genealogy from purchase order to heat number, work order, serial and assembly">
      {edges.map(([a, b]) => (
        <path
          key={`${a}-${b}`}
          d={`M${c(a).x} ${c(a).y} C ${(c(a).x + c(b).x) / 2} ${c(a).y}, ${(c(a).x + c(b).x) / 2} ${c(b).y}, ${c(b).x} ${c(b).y}`}
          className="fill-none stroke-line-strong"
          strokeWidth="1.5"
        />
      ))}
      {nodes.map((n) => (
        <g key={n.t} transform={`translate(${n.x} ${n.y})`}>
          <rect width="150" height="52" rx="10" className="fill-surface stroke-line" />
          <text x="12" y="22" className="fill-fg font-mono text-[12px] font-semibold">{n.t}</text>
          <text x="12" y="40" className="fill-muted text-[11px]">{n.s}</text>
        </g>
      ))}
    </svg>
  );
}
