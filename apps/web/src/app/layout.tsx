import type {Metadata} from "next";
import {Providers} from "@/components/providers";
import "./globals.css";
export const metadata:Metadata={title:"Manager Game",description:"Build your legacy. Manage every decision."};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700;800&display=swap" rel="stylesheet"/></head><body><Providers>{children}</Providers></body></html>;
}
