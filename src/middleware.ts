import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { isAdminUserId } from './lib/adminAllowlist';

// Pages: /admin, /admin/feedback, /admin-admin … API: /api/admin-*
const isAdminRoute = createRouteMatcher(['/admin(.*)', '/api/admin(.*)']);

export default clerkMiddleware(async (auth, req) => {
  // Signed-in visitors to the landing page go straight to the dashboard, decided
  // here on the server, so the landing page can render immediately for everyone
  // else instead of waiting for Clerk to load in the browser. Query params (e.g. a
  // ?ref= referral code) carry over; the dashboard captures them.
  if (req.nextUrl.pathname === '/' && process.env.NEXT_PUBLIC_WAITLIST_MODE !== '1') {
    const { userId } = await auth();
    if (userId) {
      const dest = req.nextUrl.clone();
      dest.pathname = '/dashboard';
      return NextResponse.redirect(dest);
    }
  }

  if (isAdminRoute(req)) {
    const { userId } = await auth();
    console.log('[admin-mw]', req.nextUrl.pathname, 'userId=', userId, 'isAdmin=', isAdminUserId(userId));
    if (!isAdminUserId(userId)) {
      // API callers get a clean 403; page visitors are bounced home so the
      // admin shells never even render for non-admins.
      if (req.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', req.url));
    }
  }
});

export const config = {
  matcher: [
    // Static files skip Clerk entirely. Videos matter most: the landing page streams
    // 10 clips with many range requests each, and none of them need auth.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|avif|png|gif|svg|ttf|otf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mov|splat|ply|glb)).*)',
    '/(api|trpc)(.*)',
  ],
};
