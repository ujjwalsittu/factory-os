import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { themeScript } from '@/components/theme';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'FactoryOS: ERP for precision manufacturing and services', template: '%s · FactoryOS' },
  description:
    'Batches to balance sheet. India-compliant ERP with GST, e-invoice and e-way bill built in, AS9100-ready traceability, and connected machines.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
