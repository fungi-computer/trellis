import type {
  AppBrowserAction,
  AppBrowserActionRefusal,
  HostUi,
} from "@fungi.computer/agar";
import { useEffect, useState } from "react";
import * as S from "effect/Schema";
import type * as z from "zod";
import { Button } from "@fungi.computer/caps/components/button";
import { Field } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import { Select } from "@fungi.computer/caps/components/select";
import { Disclosure } from "@fungi.computer/caps/components/disclosure";
import { Alert } from "@fungi.computer/caps/components/alert";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import { shareBundleSchema } from "../../backend/share.js";
import { shareCopyReply } from "@fungi.computer/workflows-wire";
import type { WorkflowClient } from "../workflow-client.js";
import "./portable-share.css";

type Exported = {
  bytes: string;
  sha256: string;
  bundle: typeof shareBundleSchema.Type;
};
type Copied = Extract<z.output<typeof shareCopyReply>, { kind: "saved" }>;

/** These are content disclosures, not secret detection or identity verification. */
function literalValues(
  value: S.Json,
  path = "definition",
): { path: string; value: S.Json }[] {
  if (S.is(S.Array(S.Json))(value))
    return value.flatMap((item, index) =>
      literalValues(item, `${path}[${String(index)}]`),
    );
  if (!S.is(S.JsonObject)(value)) return [];
  if (Object.hasOwn(value, "literal"))
    return [{ path: `${path}.literal`, value: value.literal ?? null }];
  if (Object.hasOwn(value, "template"))
    return [{ path: `${path}.template`, value: value.template ?? null }];
  return Object.entries(value).flatMap(([key, item]) =>
    literalValues(item, `${path}.${key}`),
  );
}
function refusal(reply: Exclude<z.output<typeof shareCopyReply>, Copied>) {
  switch (reply.kind) {
    case "too_large":
      return "The file exceeds 512 KiB.";
    case "digest_mismatch":
      return "The bytes do not match the sender’s SHA-256.";
    case "invalid_bundle":
      return "This is not a valid Workflow share file.";
    case "missing_apps":
      return `Install these Apps before importing: ${reply.appIds.join(", ")}.`;
    case "invalid":
      return reply.issues
        .map(
          (issue) => `${issue.node ? `${issue.node}: ` : ""}${issue.message}`,
        )
        .join("; ");
    case "conflict":
      return "That workflow ID already exists. Choose a new ID.";
    case "not_found":
      return "The published version was not found.";
  }
}

export function PortableShare({
  client,
  browserActions,
  workflowId,
  onImported,
}: {
  client: Pick<
    WorkflowClient,
    "exportWorkflow" | "importWorkflow" | "forkWorkflow" | "listVersions"
  >;
  browserActions: Pick<HostUi, "requestBrowserAction">;
  workflowId: string | null;
  onImported: (workflowId: string) => void;
}) {
  const [dialog, setDialog] = useState<"export" | "import" | "fork" | null>(
    null,
  );
  const [versions, setVersions] = useState<
    Awaited<ReturnType<WorkflowClient["listVersions"]>>
  >([]);
  const [version, setVersion] = useState("");
  const [exported, setExported] = useState<Exported | null>(null);
  const [bytes, setBytes] = useState("");
  const [sha256, setSha256] = useState("");
  const [target, setTarget] = useState("");
  const [saved, setSaved] = useState<{
    workflowId: string;
    reply: Copied;
    /** The imported file; a fork copies a published version of this library. */
    bundle: typeof shareBundleSchema.Type | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setExported(null);
    setVersions([]);
    setVersion("");
    if ((dialog === "export" || dialog === "fork") && workflowId)
      void client
        .listVersions(workflowId)
        .then((items) => {
          if (!active) return;
          setVersions(items);
          setVersion(String(items.at(0)?.version ?? ""));
        })
        .catch((cause: unknown) => {
          if (active)
            setError(
              new Error("Published versions could not be loaded.", { cause }),
            );
        });
    return () => {
      active = false;
    };
  }, [client, workflowId, dialog]);
  useEffect(() => {
    let active = true;
    setExported(null);
    setDetailsOpen(false);
    setCopied(null);
    if (dialog !== "export" || !workflowId || !version) {
      setPreparing(false);
      return;
    }
    setPreparing(true);
    setError(null);
    void client
      .exportWorkflow({ workflowId, version: Number(version) })
      .then((result) => {
        if (!active) return;
        if ("kind" in result) {
          setError(
            new Error(
              result.kind === "too_large"
                ? "This workflow is too large to share as a file."
                : "That version could not be found.",
            ),
          );
          return;
        }
        const bundle = S.decodeUnknownSync(S.fromJsonString(shareBundleSchema))(
          result.bytes,
          { onExcessProperty: "error" },
        );
        setExported({ ...result, bundle });
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            new Error(
              "The file could not be prepared. Choose the version again to retry.",
              { cause },
            ),
          );
      })
      .finally(() => {
        if (active) setPreparing(false);
      });
    return () => {
      active = false;
    };
  }, [client, workflowId, version, dialog]);
  async function importDraft() {
    setBusy(true);
    setError(null);
    try {
      const reply = await client.importWorkflow({
        bytes,
        sha256,
        workflowId: target,
      });
      if (reply.kind === "saved") {
        const bundle = S.decodeUnknownSync(S.fromJsonString(shareBundleSchema))(
          bytes,
          { onExcessProperty: "error" },
        );
        setSaved({ workflowId: target, reply, bundle });
      } else setError(new Error(refusal(reply)));
    } catch (cause) {
      setError(
        new Error("The draft could not be imported. Try again.", { cause }),
      );
    } finally {
      setBusy(false);
    }
  }
  async function forkDraft() {
    if (!workflowId) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await client.forkWorkflow({
        sourceWorkflowId: workflowId,
        version: Number(version),
        workflowId: target,
      });
      if (reply.kind === "saved")
        setSaved({ workflowId: target, reply, bundle: null });
      else setError(new Error(refusal(reply)));
    } catch (cause) {
      setError(
        new Error("The draft could not be forked. Try again.", { cause }),
      );
    } finally {
      setBusy(false);
    }
  }
  async function readFile(file: File) {
    setError(null);
    setSaved(null);
    setBytes("");
    if (file.size > 512 * 1024) {
      setError(new Error("The file exceeds 512 KiB."));
      return;
    }
    try {
      setBytes(await file.text());
    } catch (cause) {
      setError(new Error("The file could not be read.", { cause }));
    }
  }
  async function browserAction(action: AppBrowserAction, success: string) {
    setBusy(true);
    setError(null);
    setCopied(null);
    try {
      const outcome = await browserActions.requestBrowserAction(action);
      if (outcome.kind === "refused") {
        const messages = {
          "no-user-gesture":
            "Click the save or copy button again to allow this action.",
          "too-large": "The file or text is too large for this host.",
          "invalid-request":
            "This file could not be used. Choose the version again.",
          unavailable: "This browser cannot save or copy this content.",
          denied:
            "Your browser blocked this action. You can still find the file text in Details.",
          busy: "Another save or copy is in progress. Try again when it finishes.",
        } satisfies Record<AppBrowserActionRefusal["reason"], string>;
        setError(new Error(messages[outcome.reason]));
      } else setCopied(success);
    } catch (cause) {
      setError(
        new Error("The host could not save or copy this export.", { cause }),
      );
    } finally {
      setBusy(false);
    }
  }
  function copy(part: "bytes" | "sha256") {
    if (!exported) return;
    void browserAction(
      { kind: "copyText", text: exported[part] },
      part === "bytes" ? "Copied." : "Copied verification code.",
    );
  }
  function download() {
    if (!exported) return;
    void browserAction(
      {
        kind: "saveFile",
        name: `${exported.bundle.source.workflowId}-v${String(exported.bundle.source.version)}.json`,
        mime: "application/json",
        bytes: new TextEncoder().encode(exported.bytes),
      },
      "Download started.",
    );
  }
  const warnings = exported
    ? literalValues(S.decodeUnknownSync(S.Json)(exported.bundle.definition))
    : [];
  return (
    <>
      <Button
        aria-label="Export workflow"
        variant="ghost"
        size="sm"
        disabled={!workflowId}
        onClick={() => {
          setDialog("export");
          setError(null);
        }}
      >
        Export
      </Button>
      <Button
        aria-label="Import workflow"
        variant="ghost"
        size="sm"
        onClick={() => {
          setDialog("import");
          setError(null);
          setSaved(null);
          setDetailsOpen(false);
        }}
      >
        Import
      </Button>
      <Button
        aria-label="Fork workflow"
        variant="ghost"
        size="sm"
        disabled={!workflowId}
        onClick={() => {
          setDialog("fork");
          setError(null);
          setSaved(null);
          setDetailsOpen(false);
        }}
      >
        Fork
      </Button>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
      >
        <DialogContent className="wf-portable-share">
          <DialogHeader>
            <DialogTitle>
              {dialog === "export"
                ? "Export a published workflow"
                : dialog === "fork"
                  ? "Fork a published workflow"
                  : "Import a workflow"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "export"
                ? "Anyone you send this to gets their own copy. You can't take it back."
                : saved
                  ? `${dialog === "fork" ? "Forked" : "Imported"} as a draft: ${saved.reply.title}. It hasn't been published or run, and no triggers are on.`
                  : dialog === "fork"
                    ? "Save an editable copy of a published version under a new ID."
                    : "Save a copy in your own workflow library."}
            </DialogDescription>
          </DialogHeader>
          {dialog === "export" ? (
            <>
              <Field label="Published version">
                <Select
                  aria-label="Published version"
                  value={version}
                  onChange={(event) => {
                    setVersion(event.currentTarget.value);
                    setExported(null);
                  }}
                >
                  {!versions.length ? (
                    <option value="">Publish a version first</option>
                  ) : null}
                  {versions.map((item) => (
                    <option key={item.version} value={String(item.version)}>
                      v{item.version} · {item.message}
                    </option>
                  ))}
                </Select>
              </Field>
              {warnings.length ? (
                <Alert
                  tone="warning"
                  description="This includes text you typed into steps: check it for anything private."
                />
              ) : null}
              <div className="wf-actions">
                <Button
                  disabled={busy || preparing || !exported}
                  onClick={download}
                >
                  Download file
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || preparing || !exported}
                  onClick={() => {
                    copy("bytes");
                  }}
                >
                  Copy
                </Button>
              </div>
              {preparing ? <p role="status">Getting the file ready…</p> : null}
              {copied ? <p role="status">{copied}</p> : null}
              {exported ? (
                <Disclosure
                  summary="Details"
                  open={detailsOpen}
                  onOpenChange={setDetailsOpen}
                >
                  <p>
                    Source:{" "}
                    {exported.bundle.source.origin ??
                      exported.bundle.source.workflowId}
                    , v{exported.bundle.source.version}. Sender information is
                    not verified.
                  </p>
                  {warnings.length ? (
                    <ul>
                      {warnings.map((warning) => (
                        <li key={warning.path}>
                          <code>{warning.path}</code>
                          <pre>{JSON.stringify(warning.value)}</pre>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Field label="SHA-256">
                    <Input
                      aria-label="Export SHA-256"
                      readOnly
                      value={exported.sha256}
                    />
                  </Field>
                  <Field label="Raw JSON">
                    <Textarea
                      aria-label="Export JSON"
                      readOnly
                      value={exported.bytes}
                    />
                  </Field>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      copy("sha256");
                    }}
                  >
                    Copy verification code
                  </Button>
                </Disclosure>
              ) : null}
            </>
          ) : saved ? (
            <section aria-label="Imported draft review">
              {saved.reply.review.gitAccess.length ? (
                <Alert
                  tone="warning"
                  title="Git access"
                  description="Check access to these repositories before running."
                >
                  <ul>
                    {saved.reply.review.gitAccess.map((scope) => (
                      <li key={`${scope.graph}/${scope.node}`}>
                        {scope.repository}
                        {"branches" in scope ? (
                          <ul>
                            {scope.branches.map((branch) => (
                              <li key={branch}>
                                <code>{branch}</code>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          " (read only)"
                        )}
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              {saved.reply.review.writeNodes.length ? (
                <Alert
                  tone="warning"
                  title="Write steps"
                  description="These steps can change data or contact services when you run the workflow."
                >
                  <ul>
                    {saved.reply.review.writeNodes.map((node) => (
                      <li key={`${node.graph}/${node.node}`}>
                        {node.appId} · {node.method}
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              {saved.reply.review.triggers.length ? (
                <Alert
                  tone="warning"
                  title="Triggers"
                  description="This copy includes trigger settings. They are all turned off."
                >
                  {saved.bundle ? (
                    <ul>
                      {saved.bundle.definition.triggers?.map((trigger) => (
                        <li key={trigger.id}>
                          {trigger.on === "schedule"
                            ? `${trigger.id}: ${trigger.cron.expression} (${trigger.cron.timeZone})`
                            : `Event: ${trigger.id}`}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Alert>
              ) : null}
              <Button
                onClick={() => {
                  onImported(saved.workflowId);
                  setDialog(null);
                }}
              >
                Open draft
              </Button>
              {saved.bundle ? (
                <Disclosure
                  summary="Details"
                  open={detailsOpen}
                  onOpenChange={setDetailsOpen}
                >
                  <p>
                    Sender information:{" "}
                    {saved.bundle.source.origin ??
                      saved.bundle.source.workflowId}
                    , v{saved.bundle.source.version} ·{" "}
                    {saved.bundle.source.commit}. This information is not
                    verified.
                  </p>
                  <Field label="SHA-256">
                    <Input readOnly value={sha256} />
                  </Field>
                  <Field label="Raw JSON">
                    <Textarea readOnly value={bytes} />
                  </Field>
                </Disclosure>
              ) : null}
            </section>
          ) : dialog === "fork" ? (
            <>
              <Field label="Published version">
                <Select
                  aria-label="Published version"
                  value={version}
                  onChange={(event) => {
                    setVersion(event.currentTarget.value);
                  }}
                >
                  {!versions.length ? (
                    <option value="">Publish a version first</option>
                  ) : null}
                  {versions.map((item) => (
                    <option key={item.version} value={String(item.version)}>
                      v{item.version} · {item.message}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="New workflow ID">
                <Input
                  aria-label="New workflow ID"
                  value={target}
                  onChange={(event) => {
                    setTarget(event.currentTarget.value);
                  }}
                />
              </Field>
              <p>
                The copy is a draft you can edit. You decide when to publish or
                run it, or turn on any triggers.
              </p>
              <Button
                disabled={busy || !version || !target}
                onClick={() => void forkDraft()}
              >
                Fork as draft
              </Button>
            </>
          ) : (
            <>
              <Field label="Choose a workflow file">
                <Input
                  type="file"
                  accept=".json,application/json"
                  aria-label="Choose a workflow file"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.item(0);
                    if (file) void readFile(file);
                  }}
                />
              </Field>
              <Field label="Or paste a workflow">
                <Textarea
                  aria-label="Workflow JSON"
                  rows={6}
                  value={bytes}
                  onChange={(event) => {
                    setBytes(event.currentTarget.value);
                  }}
                />
              </Field>
              <Field label="Verification code from the sender">
                <Input
                  aria-label="Verification code from the sender"
                  value={sha256}
                  onChange={(event) => {
                    setSha256(event.currentTarget.value);
                  }}
                />
              </Field>
              <Field label="New workflow ID">
                <Input
                  aria-label="New workflow ID"
                  value={target}
                  onChange={(event) => {
                    setTarget(event.currentTarget.value);
                  }}
                />
              </Field>
              <p>
                This saves a draft in your library. You decide when to publish
                or run it, or turn on any triggers.
              </p>
              <Button
                disabled={busy || !bytes || !sha256 || !target}
                onClick={() => void importDraft()}
              >
                Import as draft
              </Button>
            </>
          )}
          {busy ? (
            <p role="status">
              {dialog === "export" ? "One moment…" : "Saving your copy…"}
            </p>
          ) : null}
          {error ? <p role="alert">{error.message}</p> : null}
          <DialogClose disabled={busy}>Close</DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}
