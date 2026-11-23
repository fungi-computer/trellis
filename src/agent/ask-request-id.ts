import { defineIdFamily } from "@fungi.computer/cairn/id";

const askIds = defineIdFamily({
  family: "trellis-ask-agent",
  version: 1,
  kinds: { request: { prefix: "ask" } },
});

/** A fresh idempotency key for one Ask action, retained across its retries. */
export function newAskRequestId(): string {
  return askIds.request.generate();
}
