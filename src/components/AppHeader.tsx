'use client';

import Image from 'next/image';

export default function AppHeader({
  title = 'Panel de Trabajadores',
  subtitle = 'Control y rendimiento',
}: {
  title?: string;
  subtitle?: string;
}) {
  return (
    <header className="w-full border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 overflow-hidden rounded-md">
            <Image
              src="/logo.png"
              alt="Logo"
              fill
              className="object-contain"
              priority
            />
          </div>

          <div className="leading-tight">
            <div className="text-base font-semibold">{title}</div>
            <div className="text-xs text-gray-500">{subtitle}</div>
          </div>
        </div>

        <div className="text-xs text-gray-500">
          {/* aquí luego pondremos mes actual, rol, etc. */}
        </div>
      </div>
    </header>
  );
}
