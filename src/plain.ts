/**
 * plain builds release-please's non-manifest configuration from one entry
 * point's options.
 *
 * Both entry points offer the same options under the same names, and each
 * used to assemble the object itself -- which is how the command line came to
 * accept a `release-type` the action rejects. One builder, and the difference
 * between them is narrowed to how they read an option and how they name one
 * in an error.
 *
 * Every value is validated against release-please's own registry rather than
 * passed through, so a typo is a named error listing what is valid instead of
 * a confusing failure deep inside the manifest build -- or, worse, a
 * projection quietly computed from a configuration nobody asked for.
 */

import { getReleaserTypes, getVersioningStrategyTypes } from "release-please";
import type { PlainConfig } from "./project.js";

/** Read answers with an option's value, or undefined when it is unset. */
export type Read = (name: string) => string | undefined;

/**
 * Named writes an option's name the way its own entry point does: the action
 * says ``input `release-type` ``, the command line says `--release-type`. The
 * message either way has to name something the reader can go and change.
 */
export type Named = (name: string) => string;

/** ANCHORED is a whole version and nothing else, which is what someone who
 * meant to force one wrote. release-please parses this with `Version.parse`,
 * which throws from inside the strategy on anything else. */
const ANCHORED = /^\d+\.\d+\.\d+(?:-[^+\s]+)?(?:\+\S+)?$/;

/**
 * plainConfig reads the non-manifest configuration, or undefined when the
 * repository uses a manifest.
 *
 * `release-type` is the switch, exactly as it is on release-please-action:
 * setting it means there is no release-please-config.json to read and the one
 * package is configured here instead.
 */
export function plainConfig(read: Read, named: Named): PlainConfig | undefined {
  const value = (name: string) => (read(name) ?? "").trim();

  const releaseType = value("release-type");
  if (!releaseType) return undefined;
  oneOf(named, "release-type", releaseType, getReleaserTypes());

  const path = value("package-path");
  const component = value("component");
  const separator = value("tag-separator");
  const includeComponentInTag = value("include-component-in-tag");

  // Both of these reach release-please only in this mode: release-please
  // -action passes them to `Manifest.fromConfig` and to nothing else, so a
  // manifest repository declares them in its config file instead.
  const versioning = value("versioning-strategy");
  if (versioning) {
    oneOf(named, "versioning-strategy", versioning, getVersioningStrategyTypes());
  }
  const releaseAs = value("release-as");
  if (releaseAs && !ANCHORED.test(releaseAs)) {
    throw new Error(
      `${named("release-as")} must be a version, like \`1.2.3\`;` +
        ` got \`${releaseAs}\``,
    );
  }

  return {
    releaseType: releaseType as PlainConfig["releaseType"],
    ...(path ? { path } : {}),
    ...(component ? { component } : {}),
    ...(separator ? { tagSeparator: separator } : {}),
    ...(includeComponentInTag
      ? { includeComponentInTag: bool(named, "include-component-in-tag", includeComponentInTag) }
      : {}),
    ...(versioning
      ? { versioning: versioning as NonNullable<PlainConfig["versioning"]> }
      : {}),
    ...(releaseAs ? { releaseAs } : {}),
  };
}

/** oneOf rejects a value release-please's registry does not hold, listing
 * what it does. */
function oneOf(
  named: Named,
  name: string,
  value: string,
  known: readonly string[],
): void {
  if (known.includes(value)) return;
  throw new Error(
    `${named(name)} must be one of ${[...known].sort().join(", ")};` +
      ` got \`${value}\``,
  );
}

/** bool reads a value written as `true` or `false`, case-insensitively. */
function bool(named: Named, name: string, value: string): boolean {
  const text = value.toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  throw new Error(`${named(name)} must be true or false, got \`${value}\``);
}
