import type { SigilName } from "@fungi.computer/sigils";

/**
 * Presentation for the first-party Apps Trellis workflows use, independent of
 * whether the current Team has installed or granted them yet.
 */
export const appMarks = new Map<string, { name: string; icon: SigilName }>([
  ["app_prints", { name: "Prints", icon: "prints" }],
  ["app_bonsai", { name: "Bonsai", icon: "bonsai" }],
  ["app_shed", { name: "Shed", icon: "computer" }],
  ["app_inkcap", { name: "Inkcap", icon: "inkcap" }],
]);
