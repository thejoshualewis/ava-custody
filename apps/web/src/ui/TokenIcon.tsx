import * as React from 'react'
export default function TokenIcon({ src, alt }: { src?: string | null; alt: string }) {
  if (src) return <img src={src} alt={alt} className="h-6 w-6 rounded-full" />
  return <div className="h-6 w-6 rounded-full bg-slate-200 flex items-center justify-center"><span className="text-[10px] text-slate-500">∎</span></div>
}
