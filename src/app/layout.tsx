import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { ClerkProvider } from '@clerk/nextjs';
import { Fraunces, DM_Sans, JetBrains_Mono, Montserrat } from 'next/font/google';
import { ConvexClerkProvider } from '@/components/ConvexClerkProvider';
import { PostHogProvider } from '@/components/PostHogProvider';
import { NavLoadingProvider } from '@/components/NavLoadingOverlay';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { DARK_ROUTE_PREFIXES } from '@/lib/darkRoutes';
import { LANG_COOKIE, normalizeLang } from '@/lib/language';
import './globals.css';

// SettingsProvider sets `.dark` in an effect, which is one paint too late: the
// dashboard would show a frame of cream before flipping. Same rule, run before
// the body renders, off the one prefix list. Client navigation is the effect's
// job — this only has to be right for the first paint.
const DARK_CLASS_SCRIPT = `(function(){try{var p=location.pathname,r=${JSON.stringify(
  DARK_ROUTE_PREFIXES,
)};document.documentElement.classList.toggle("dark",r.some(function(x){return p===x||p.indexOf(x+"/")===0}));}catch(e){}})();`;

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dmsans',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['400', '500'],
  display: 'swap',
});

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  weight: ['700', '800'],
  display: 'swap',
});

// Metadata is static (crawlers don't carry the language cookie), so it ships
// in the site's default language — Japanese. See lib/language DEFAULT_LANG.
const SITE_DESCRIPTION = 'AIバーバー。これまでで一番シャープな仕上がりを。';

export const metadata: Metadata = {
  metadataBase: new URL('https://tryshapeup.cc'),
  title: 'ShapeUp',
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    title: 'ShapeUp',
    description: SITE_DESCRIPTION,
    url: 'https://tryshapeup.cc',
    siteName: 'ShapeUp',
    images: [{ url: '/shapeup_logo.png', width: 1200, height: 630, alt: 'ShapeUp' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ShapeUp',
    description: SITE_DESCRIPTION,
    images: ['/shapeup_logo.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the cookie opts the whole tree into dynamic rendering. That costs
  // us nothing worth keeping: every page users actually land on is either a
  // client component (/, /chair, /barber) or already force-dynamic (/b/<slug>),
  // and the handful of server-rendered legal/marketing pages are cheap. The
  // alternative — an English first paint that React then throws away for every
  // es/ja barber — is worse.
  const language = normalizeLang((await cookies()).get(LANG_COOKIE)?.value);

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      // Point Clerk at our own routes (which render <SignUpWidget />) so any time
      // Clerk needs to send the user to "sign in / sign up" — e.g. the fallback
      // during the Google OAuth callback — it uses our UI instead of Clerk's
      // hosted Account Portal.
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      {/* suppressHydrationWarning: the script below writes `dark` onto <html>
          before React hydrates, so the class list legitimately differs from
          the server's. */}
      <html lang={language} suppressHydrationWarning className={`${fraunces.variable} ${dmSans.variable} ${jetbrains.variable} ${montserrat.variable}`}>
        <body style={{ fontFamily: 'var(--font-dmsans), system-ui, var(--font-cjk), sans-serif' }}>
          <script dangerouslySetInnerHTML={{ __html: DARK_CLASS_SCRIPT }} />
          <style>{`
            /* None of the Latin webfonts carry CJK glyphs, so every stack ends in
               the platform Japanese faces before the generic family — otherwise
               ja copy lands on the browser's last-resort font. */
            :root { --font-cjk: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', Meiryo; }
            .font-display { font-family: var(--font-fraunces), Georgia, var(--font-cjk), serif !important; font-variation-settings: 'SOFT' 50, 'WONK' 1, 'opsz' 144; }
            .font-serif   { font-family: var(--font-fraunces), Georgia, var(--font-cjk), serif !important; font-variation-settings: 'SOFT' 30, 'opsz' 14; }
            .font-sans    { font-family: var(--font-dmsans), system-ui, var(--font-cjk), sans-serif !important; }
            .font-mono    { font-family: var(--font-jetbrains), ui-monospace, var(--font-cjk), monospace !important; }
          `}</style>
          <PostHogProvider>
            <ConvexClerkProvider>
              <SettingsProvider initialLanguage={language}>
                <NavLoadingProvider>
                  {children}
                </NavLoadingProvider>
              </SettingsProvider>
            </ConvexClerkProvider>
          </PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
