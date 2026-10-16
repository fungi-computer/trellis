import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { log } from "node:console";
import * as z from "zod";
import { rebuildCopiesReply } from "@fungi.computer/workflows-wire";

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    installation: { type: "string" },
    "headers-file": { type: "string" },
  },
});
const origin = new globalThis.URL(z.string().url().parse(values.origin));
const installation = z.string().min(1).parse(values.installation);
const headersFile = z.string().min(1).parse(values["headers-file"]);
const headers = new globalThis.Headers(
  z
    .record(z.string(), z.string())
    .parse(JSON.parse(await readFile(headersFile, "utf8"))),
);
headers.set("Content-Type", "application/json");
const endpoint = new globalThis.URL(
  `/apps/${encodeURIComponent(installation)}/methods/rebuildCopies`,
  origin,
);
let cursor = null;
let complete = false;
for (let page = 1; page <= 1024; page++) {
  const response = await globalThis.fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ cursor }),
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(60_000),
  });
  if (!response.ok)
    throw new Error(`Copy rebuild refused (HTTP ${response.status})`);
  const reply = rebuildCopiesReply.parse(await response.json());
  if (reply.done) {
    log(`Trellis copies rebuilt in ${page} page(s).`);
    complete = true;
    break;
  }
  cursor = reply.cursor;
}
if (!complete) throw new Error("Copy rebuild exceeded the page limit");
