/**
 * index is the one bundled entry point, for the action and for the command
 * line both.
 *
 * One artifact rather than two because it is committed: a second bundle would
 * put another two and a half megabytes of vendored release-please in the
 * repository to say the same thing twice. The runner invokes the action with
 * no arguments and the command line always has at least one, so which is
 * wanted is decided by whether there are any.
 */

import { action } from "./action.js";
import { cli } from "./main.js";

const argv = process.argv.slice(2);

(argv.length > 0 ? cli(argv) : action()).catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  // The first line again as an annotation, so the failure is on the run's
  // summary page and not only in a log someone has to open.
  if (process.env["GITHUB_ACTIONS"]) {
    process.stdout.write(`::error::${message.split("\n")[0]}\n`);
  }
  process.exitCode = 1;
});
