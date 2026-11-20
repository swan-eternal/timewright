/**
 * Opening the user's browser is a nicety: if it fails (no xdg-open, a
 * stripped-down machine), the printed URL still gets them there.
 */

import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  let command: string;
  let args: string[];
  if (process.platform === "win32") {
    command = "cmd";
    // The empty string is the window title; without it a URL with an
    // ampersand would be taken for the title and truncated.
    args = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      // No browser opener on this machine; the console URL is the fallback.
    });
    child.unref();
  } catch {
    // Never let a courtesy become a crash.
  }
}
