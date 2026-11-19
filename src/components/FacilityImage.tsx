import { useState } from 'react';
import { Wrench, Zap, Droplets, Wifi, Monitor, Armchair } from 'lucide-react';

interface FacilityImageProps {
  src: string | null | undefined;
  alt: string;
  category?: string;
  className?: string;
}

export function FacilityImage({ src, alt, category = '', className = 'w-full h-48' }: FacilityImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    const low = category.toLowerCase();
    const Icon = low.includes('hazard') || low.includes('fan') || low.includes('electric')
      ? Zap
      : low.includes('plumb')
      ? Droplets
      : low.includes('net')
      ? Wifi
      : low.includes('projector')
      ? Monitor
      : low.includes('furn')
      ? Armchair
      : Wrench;

    return (
      <div
        className={`${className} bg-slate-100 border border-slate-200 rounded-lg flex flex-col items-center justify-center p-4 text-center`}
      >
        <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 mb-2">
          <Icon className="w-5 h-5" />
        </div>
        <p className="text-xs font-medium text-slate-700">{category || 'Facility Issue'}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">No photograph attached</p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} object-cover rounded-lg border border-slate-200 bg-slate-100`}
    />
  );
}
