import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams, origin } = new URL(request.url);
    const code = searchParams.get("code");
    // if "next" is in param, use it as the redirect URL
    const next = searchParams.get("next") ?? "/dashboard";

    if (code) {
      const cookieStore = await cookies();
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
            setAll(cookiesToSet: { name: string; value: string; options?: Parameters<typeof cookieStore.set>[2] }[]) {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options),
              );
            },
          },
        },
      );

      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error && data.session) {
        // NOW verify with backend BEFORE proceeding
        try {
          const backendResponse = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/user/verify`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${data.session.access_token}`,
                "Content-Type": "application/json",
              },
            },
          );

          if (backendResponse.ok) {
            // Backend verification successful - proceed with redirect
            const forwardedHost = request.headers.get("x-forwarded-host");
            const isLocalEnv = process.env.NODE_ENV === "development";
            if (isLocalEnv) {
              return NextResponse.redirect(`${origin}${next}`);
            } else if (forwardedHost) {
              return NextResponse.redirect(`https://${forwardedHost}${next}`);
            } else {
              return NextResponse.redirect(`${origin}${next}`);
            }
          } else {
            // Backend verification failed - clear the session and redirect to error
            console.error("Backend verification failed after OAuth success");
            await supabase.auth.signOut();
            return NextResponse.redirect(
              `${origin}/auth-error?reason=backend_verification_failed`,
            );
          }
        } catch (backendError) {
          // Backend connection failed - clear the session and redirect to error
          console.error(
            "Backend connection failed after OAuth success:",
            backendError,
          );
          await supabase.auth.signOut();
          return NextResponse.redirect(
            `${origin}/auth-error?reason=backend_connection_failed`,
          );
        }
      } else {
        console.error("OAuth exchange failed:", error);
        return NextResponse.redirect(
          `${origin}/auth-error?reason=oauth_exchange_failed`,
        );
      }
    }

    // return the user to an error page with instructions
    return NextResponse.redirect(`${origin}/auth-error?reason=no_code`);
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(
      `${new URL(request.url).origin}/auth-error?reason=callback_error`,
    );
  }
}
