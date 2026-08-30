/**
 * Lets `node --test` run the app's real TypeScript files unmodified.
 *
 * Node 24 strips types on its own, but it does not do Next's module
 * resolution: it will not guess the ".ts" on an extensionless relative import,
 * it does not know the "@/" alias from tsconfig.json, and it wants the
 * extension on "next/server". Those three gaps are all this file closes.
 *
 * The point is that the tests exercise the SAME files that ship. Copying the
 * source into a test fixture would let the copy drift from the real thing and
 * still go green, which for a signature check is worse than having no test.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, next) {
  if (specifier === "next/server") return next("next/server.js", context);

  if (specifier.startsWith("@/")) {
    for (const ext of ["", ".ts", ".tsx"]) {
      const p = join(WEB, specifier.slice(2) + ext);
      if (existsSync(p)) return next(pathToFileURL(p).href, context);
    }
  }

  try {
    return await next(specifier, context);
  } catch (e) {
    if (specifier.startsWith(".") && context.parentURL) {
      const url = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(specifier + ".ts", context);
    }
    throw e;
  }
}
