/**
 * Process utilities for Deno applications
 * @module util/process
 */

/**
 * Terminates a child process.
 *
 * Sends the specified signal (SIGTERM for graceful, SIGKILL for force).
 * Falls back to SIGKILL if the initial attempt fails.
 */
export function killProcessCrossPlatform(
  childProcess: Deno.ChildProcess,
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM"
): void {
  try {
    childProcess.kill(signal);
  } catch (error) {
    console.error(`Failed to kill process with ${signal}:`, error);
    try {
      childProcess.kill("SIGKILL");
    } catch (fallbackError) {
      console.error("Failed to force kill process:", fallbackError);
    }
  }
}
