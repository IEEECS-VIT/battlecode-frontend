"use client";

import Image from "next/image";

export default function SponsoredBy() {
  return (
    <div className="relative -mt-1 flex flex-col items-center gap-1.5 lg:gap-2">
      <div className="flex items-center gap-3 lg:gap-4">
        <span
          aria-hidden
          className="h-[1.5px] w-10 lg:w-16 bg-gradient-to-r from-transparent via-orange-400/50 to-orange-500"
        />
        <span className="flex items-center gap-2 uppercase tracking-[0.28em] text-[0.6rem] lg:text-[0.7rem] text-white/75 font-medium">
          <span>Sponsored</span>
          <span>by</span>
        </span>
        <span
          aria-hidden
          className="h-[1.5px] w-10 lg:w-16 bg-gradient-to-l from-transparent via-orange-400/50 to-orange-500"
        />
      </div>
      <Image
        src="/BOB_logo.png"
        alt="Bank of Baroda"
        width={431}
        height={150}
        className="h-12 lg:h-16 w-auto object-contain -translate-x-2 [filter:drop-shadow(0_0_10px_rgba(249,115,22,0.28))_drop-shadow(0_0_22px_rgba(255,255,255,0.12))]"
        priority
      />
    </div>
  );
}
