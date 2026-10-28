import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "EcoMAB — Find your better time outside",
  description: "The best time and place in Heilbronn to run, ride or walk — heat, air, wind and rush hour in one score.",
  applicationName: "EcoMAB",
  appleWebApp: { capable: true, title: "EcoMAB", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#075b4a",
  width: "device-width",
  initialScale: 1,
  // The map handles pinch-zoom; the page itself must not zoom.
  maximumScale: 1,
  userScalable: false,
  // Draw under the notch / home bar; screens pad with safe-area insets.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
