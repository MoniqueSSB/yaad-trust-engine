# The admin desk, on its own hostname

`desk/desk.html` is the source. This folder is the deployment: a Cloudflare
Worker serving that one file as static assets, on a hostname of its own.

## Why it is separate

The desk reads client addresses, worker vetting status and money. Three
reasons it does not live on `yaadly.co.uk` or `app.yaadly.co.uk`:

- **Blast radius.** A bad script on the marketing site would be running on the
  same origin as the desk. It is not worth the risk for a page only one person
  uses.
- **Cookies.** A separate origin means separate storage. Nothing the desk holds
  can be read by anything on the other two hosts.
- **Access control.** A hostname of its own can be put behind Cloudflare
  Access, so it is not reachable at all without an identity check. That cannot
  be done to a path on a site the public has to reach.

The sign-in gate, `is_admin()` and RLS are still what protect the data. This
removes shared blast radius; it does not replace the lock.

## Deploying

```
npm run deploy --prefix desk-deploy
```

Then, once, in the Cloudflare dashboard:

1. Workers & Pages → `yaadly-desk` → Settings → Domains & Routes
2. The custom domain `desk.yaadly.co.uk` is already bound in wrangler.jsonc,
   so a deploy sets it up. The workers.dev address is disabled.
3. Zero Trust → Access → Applications → add `desk.yaadly.co.uk`, policy
   "allow the one email that runs it"

Step 3 is the one that matters. Without it the desk is reachable by anyone who
guesses the hostname, and `noindex` keeps it out of search results but nothing
keeps it out of a wordlist.

## Keeping it in step

`desk/desk.html` is the source of truth. After editing it:

```
cp desk/desk.html desk-deploy/public/index.html
```
