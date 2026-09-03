"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The far end of a recovery link, with the password box taken out.
 *
 * This page used to set a password: two fields and supabase.auth.updateUser
 * ({ password }). It was the only thing in the whole application that could
 * create one. Sign in has been passwordless since 31 August 2026 and says so
 * in its own comment, so what this page minted was a credential nothing could
 * accept: an unmanaged second key on a door that no longer has that lock. It
 * was also linked from nowhere, and reachable by URL by anyone.
 *
 * It is NOT deleted, because a recovery link may still be sitting in somebody's
 * inbox and a 404 is a worse answer than a working one. A recovery link carries
 * a real session, and sign in already knows what to do with one: read it out of
 * the fragment, set the session, and let the person in. Its own comment says
 * exactly that, that letting them in is "the useful thing to do with it".
 *
 * So this forwards there and gets out of the way.
 *
 * The forward has to happen in the browser, and the hash has to be carried
 * across by hand. GoTrue returns the session in the URL FRAGMENT, a fragment is
 * never sent to the server, and a server redirect would therefore drop the
 * session on the floor and land somebody on a sign in form holding credentials
 * that had just been thrown away. That is the exact failure the site root had
 * before it was fixed, and it is not worth repeating one route further down.
 *
 * replace(), not push(), so the back button does not bounce them back here.
 */
export default function Reset() {
  useEffect(() => {
    const hash = window.location.hash || "";
    window.location.replace("/portal/sign-in" + hash);
  }, []);

  return (
    <div className="mx-auto max-w-[420px] py-16 text-center">
      <p className="text-[10.5px] font-bold uppercase tracking-[.2em] text-tealb">
        Signing you in
      </p>
      <h1 className="mt-2 font-display text-[26px] uppercase leading-none">
        One moment
      </h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
        Yaadly does not use passwords any more. Your link still works: it signs
        you straight in, and there is nothing for you to choose.
      </p>
      <p className="mt-4 text-[13px] text-dim">
        Not moving?{" "}
        <Link href="/portal/sign-in" className="font-semibold text-purpleb">
          Go to sign in
        </Link>
      </p>
    </div>
  );
}
