// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ✅ Middleware neutro: NO hace redirects.
// Útil para cortar loops cuando algún middleware viejo está redirigiendo /panel <-> /admin/panel.
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

// Solo se aplica a panel/admin (así no afecta al resto del sitio)
export const config = {
  matcher: ["/panel/:path*", "/admin/:path*"],
};
