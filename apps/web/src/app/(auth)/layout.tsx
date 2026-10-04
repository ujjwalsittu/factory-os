import { Logo } from '@factoryos/ui';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" aria-label="FactoryOS home">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-[12px] text-subtle">© {new Date().getFullYear()} Azeonics Private Limited · Data hosted in India</p>
      </div>
      <div className="relative hidden overflow-hidden bg-[#10123a] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,#3b3bd4_0%,transparent_60%),radial-gradient(ellipse_at_bottom_left,#0e7490_0%,transparent_55%)] opacity-70" />
        <div className="relative flex h-full flex-col justify-center px-14 text-white">
          <p className="text-[13px] font-medium tracking-wider text-white/60 uppercase">FactoryOS</p>
          <h2 className="mt-3 max-w-md text-3xl leading-tight font-semibold">From heat number to balance sheet, in one system.</h2>
          <ul className="mt-8 space-y-3 text-[15px] text-white/80">
            {['AS9100-ready traceability', 'GST, e-invoice and e-way bill built in', 'Multi-entity books with role-based access', 'Machines connected, hours metered'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-emerald-300" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
