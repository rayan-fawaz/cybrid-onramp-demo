import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cybrid On-Ramp Console",
  description: "Sandbox integration console for Cybrid fiat-to-crypto on-ramp workflow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
