import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RestaurantIQ",
  description: "AI-powered restaurant business analytics"
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}