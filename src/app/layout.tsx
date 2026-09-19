import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'loopend — Until it’s done.', template: '%s · loopend' },
  description:
    'Loopend remembers what hasn’t finished, takes the next step, and stays on it until it’s done.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
