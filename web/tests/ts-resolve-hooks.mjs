/**
 * Lets `node --test` run the app's real TypeScript files unmodified.
 *
 * Node 24 strips types on its own, but it does not do Next's module
 * resolution: it will not guess the ".ts" on an extensionless relative import,
 * it does not know the "@/" alias from tsconfig.json, it wants the extension
 * on "next/server", and it refuses a JSON import that does not carry an
 * explicit `with { type: "json" }`. Those four gaps are all this file closes.
 *
 * The JSON one is the reason gates.ts could not be tested at all: it reads
 * CG_VERSION from lib/legal-copy.json, TypeScript resolves that with
 * resolveJsonModule and no attribute, and plain Node then refuses the module
 * with ERR_IMPORT_ATTRIBUTE_MISSING before a single assertion runs. Adding the
 * attribute here rather than to the source keeps the shipped file exactly as
 * Next wants it.
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

/**
 * Supply the import attribute Node wants for JSON, so a module that reads a
 * JSON file can be imported by a test unchanged. Nothing else is touched: any
 * other specifier is handed straight on.
 */
export async function load(url, context, next) {
  if (url.endsWith(".json")) {
    return next(url, { ...context, importAttributes: { ...context.importAttributes, type: "json" } });
  }
  return next(url, context);
}
