import type { Metadata } from 'next';
import { Orbitron } from 'next/font/google';
import { Navbar } from '@/components/Navbar';
import 'tailwindcss/index.css';
import './globals.css';

const orbitron = Orbitron({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'SPECIA AR',
  description: 'AR Viewer',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${orbitron.className} flex min-h-screen min-h-[100dvh] w-full flex-col antialiased`}>
        <Navbar />
        <div className="min-h-0 flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
