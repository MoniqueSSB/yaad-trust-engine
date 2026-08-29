import { redirect } from "next/navigation";

/**
 * app.yaadly.co.uk exists to be the portal. Send people to it.
 *
 * This was the build scaffold: "The app starts here", a database health
 * readout, and the three portals listed as NOT BUILT YET. It outlived the
 * thing it described. The client portal is live and has real jobs in it, and
 * the page still said it did not exist.
 *
 * It was also where clients landed. GoTrue sends a confirmation back to the
 * project's Site URL when nothing else is specified, that was the site root,
 * and the session arrives in the URL fragment. This page never looked at the
 * fragment, so somebody who had just confirmed their email stood on a page
 * telling them their portal had not been built, holding a valid session in
 * the address bar. That is the worst screen in the whole journey and it was
 * the one a new client was most likely to see.
 *
 * /portal decides the rest: signed out goes to sign in, signed in goes to the
 * client or worker portal, and somebody who is both gets the door.
 *
 * The marketing site at yaadly.co.uk is a different site and is untouched.
 */
export default function Home() {
  redirect("/portal");
}
