import "./ask-agent.css";
import { useEffect, useRef, useState } from "react";
import * as z from "zod";
import type { HostUi } from "@fungi.computer/agar";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import { Button } from "@fungi.computer/caps/components/button";
import { Field } from "@fungi.computer/caps/components/field";
import { Loader } from "@fungi.computer/caps/components/loader";
import { Select } from "@fungi.computer/caps/components/select";
import { Surface } from "@fungi.computer/caps/components/surface";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import { Sigil } from "@fungi.computer/sigils";
import type { WorkflowClient } from "../workflow-client.js";

const capabilityDenied = z.object({ code: z.literal("CAPABILITY_DENIED") });
/** How often the count of the Agent's saves is read while it builds. */
const POLL_MS = 2000;
/** With saves made and none for this long, the Agent is taken to be done. */
const QUIET_MS = 45_000;
const askIds = defineIdFamily({
  family: "trellis-ask-agent",
  version: 1,
  kinds: { request: { prefix: "ask" } },
});

/** The chat an Agent is asked in. */
export type AskTarget = Readonly<{ agentId: string; sessionId: string }>;

type Chat = Awaited<ReturnType<WorkflowClient["listChats"]>>[number];

/** The Agent's name where the directory has it; the chat's own title otherwise. */
function nameOf(
  chat: Chat,
  agents: readonly Readonly<{ agentId: string; name: string }>[],
) {
  return agents.find((agent) => agent.agentId === chat.agentId)?.name;
}

/**
 * Describe what to build and send it into one of the person's chats. The Agent
 * edits the same draft with the same methods the canvas uses; this panel only
 * asks, counts the Agent's saves while it builds, and stops it on request.
 * `prepare` makes the draft first when there is none yet (the first run).
 */
export function AskAgent({
  client,
  workflowId,
  prepare,
  building,
  onBuilding,
  permissions,
  notify,
  titled = true,
}: {
  client: Pick<
    WorkflowClient,
    "listChats" | "listScheduleAgents" | "askAgent" | "draftHead"
  >;
  workflowId: string | null;
  prepare?: (() => Promise<string>) | undefined;
  /** The chat being asked, while its Agent builds. */
  building: AskTarget | null;
  /** The request went out (with the draft it names), or building ended. */
  onBuilding: (building: AskTarget | null, workflowId: string) => void;
  permissions?: Pick<HostUi, "requestAppPermissions"> | undefined;
  notify: (message: string) => void;
  /** Show the panel's own heading; a host that introduces it already says no. */
  titled?: boolean;
}) {
  const [chats, setChats] = useState<readonly Chat[] | null>(null);
  const [agents, setAgents] = useState<
    readonly Readonly<{ agentId: string; name: string }>[]
  >([]);
  const [chosen, setChosen] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [saves, setSaves] = useState(0);
  // True once the Agent has saved and then gone quiet: Stop gives way to Done.
  const [quiet, setQuiet] = useState(false);
  const lastSave = useRef({ saves: 0, at: 0 });
  useEffect(() => {
    let active = true;
    void client.listChats().then(
      (found) => {
        if (!active) return;
        setChats(found);
        setChosen((current) =>
          current === "" && found[0]
            ? `${found[0].agentId}/${found[0].sessionId}`
            : current,
        );
      },
      (cause: unknown) => {
        console.error("Chats could not be listed", cause);
        if (active) {
          setChats([]);
          notify("Your chats could not be read. Try again in a moment.");
        }
      },
    );
    void client.listScheduleAgents().then(
      (listed) => {
        if (active) setAgents(listed);
      },
      (cause: unknown) => {
        // Names are a courtesy: the chat's title stands in for one.
        console.error("Agent names could not be read", cause);
      },
    );
    return () => {
      active = false;
    };
  }, [client, notify]);
  const chat = chats?.find(
    (item) => `${item.agentId}/${item.sessionId}` === chosen,
  );
  const who =
    building === null
      ? undefined
      : (agents.find((agent) => agent.agentId === building.agentId)?.name ??
        chats?.find((item) => item.agentId === building.agentId)?.title ??
        "The Agent");
  // While the Agent builds, read how many times it has saved; Stop ends this.
  useEffect(() => {
    if (building === null || workflowId === null) return;
    let active = true;
    let timer: number | undefined;
    lastSave.current = { saves: 0, at: Date.now() };
    setQuiet(false);
    const tick = () => {
      void client
        .draftHead(workflowId)
        .then(
          (head) => {
            if (!active || head === null) return;
            const made = head.changedSince.filter(
              (change) =>
                change.actor.kind === "agent" &&
                change.actor.agentId === building.agentId,
            ).length;
            setSaves(made);
            if (made !== lastSave.current.saves)
              lastSave.current = { saves: made, at: Date.now() };
            setQuiet(made > 0 && Date.now() - lastSave.current.at >= QUIET_MS);
          },
          (cause: unknown) => {
            console.error("The draft's saves could not be read", cause);
          },
        )
        .finally(() => {
          if (active) timer = window.setTimeout(tick, POLL_MS);
        });
    };
    tick();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [client, workflowId, building]);
  async function send(
    target: AskTarget,
    draftId: string,
    intent: "build" | "stop",
  ) {
    const request =
      intent === "build"
        ? ({ intent, text: text.trim() } as const)
        : ({ intent } as const);
    const ask = () =>
      client.askAgent({
        ...request,
        ...target,
        workflowId: draftId,
        requestId: askIds.request.generate(),
      });
    try {
      return await ask();
    } catch (cause) {
      if (!capabilityDenied.safeParse(cause).success || !permissions)
        throw cause;
      const outcome = await permissions.requestAppPermissions({
        agents: ["agent.send"],
      });
      if (outcome === "declined")
        throw new Error(
          "Trellis needs your approval to send messages into your chats.",
          { cause },
        );
      return await ask();
    }
  }
  function refusal(reply: Awaited<ReturnType<WorkflowClient["askAgent"]>>) {
    if ("status" in reply) return null;
    if ("retryAfterMs" in reply)
      return `Too many messages just now. Try again in ${String(Math.ceil(reply.retryAfterMs / 1000))} seconds.`;
    if (reply.error === "no_chat")
      return "That chat is no longer there. Pick another.";
    return "Trellis isn't allowed to message your chats. Approve it to continue.";
  }
  async function build() {
    if (!chat || text.trim() === "" || sending) return;
    setSending(true);
    try {
      const draftId = workflowId ?? (await prepare?.());
      if (draftId === undefined)
        throw new Error("There is no draft to build into.");
      const target = { agentId: chat.agentId, sessionId: chat.sessionId };
      const reason = refusal(await send(target, draftId, "build"));
      if (reason !== null) {
        notify(reason);
        return;
      }
      setSaves(0);
      onBuilding(target, draftId);
    } catch (cause) {
      console.error("The build request could not be sent", cause);
      notify(
        cause instanceof Error
          ? cause.message
          : "The request could not be sent.",
      );
    } finally {
      setSending(false);
    }
  }
  async function stop() {
    if (building === null || workflowId === null) return;
    const target = building;
    // Polling ends first; then the Agent is told to stop.
    onBuilding(null, workflowId);
    try {
      const reason = refusal(await send(target, workflowId, "stop"));
      if (reason !== null) notify(`Couldn't tell the Agent to stop. ${reason}`);
    } catch (cause) {
      console.error("The stop request could not be sent", cause);
      notify(
        `Couldn't tell the Agent to stop: ${cause instanceof Error ? cause.message : "it could not be sent."}`,
      );
    }
  }
  return (
    <Surface
      role="region"
      aria-label="Ask an Agent"
      placement="embedded"
      size="sm"
      className={building === null ? "wf-ask" : "wf-ask wf-ask-bar"}
    >
      {titled && building === null ? (
        <h2>
          <Sigil name="trellis" size={16} />
          Ask an Agent to build it
        </h2>
      ) : null}
      {building !== null ? (
        <p className="wf-ask-building" role="status">
          {quiet ? null : <Loader decorative size="sm" />}
          <strong>{`${who ?? "The Agent"} ${quiet ? "seems done" : "is building"}`}</strong>
          <span className="wf-muted">
            {saves === 0
              ? "Waiting for its first save"
              : `${String(saves)} ${saves === 1 ? "save" : "saves"}${quiet ? "" : " so far"}`}
          </span>
          <Button
            className="wf-ask-end"
            size="sm"
            variant="outline"
            onClick={() => {
              if (quiet && workflowId !== null) onBuilding(null, workflowId);
              else void stop();
            }}
          >
            {quiet ? "Done" : "Stop"}
          </Button>
        </p>
      ) : chats === null ? (
        <p className="wf-muted">Finding your chats…</p>
      ) : chats.length === 0 ? (
        <p className="wf-muted">
          You have no chats yet. Start one with an Agent, then come back.
        </p>
      ) : (
        <>
          <Field label="Chat">
            <Select
              value={chosen}
              onChange={(event) => {
                setChosen(event.currentTarget.value);
              }}
            >
              {chats.map((item) => {
                const name = nameOf(item, agents);
                return (
                  <option
                    key={`${item.agentId}/${item.sessionId}`}
                    value={`${item.agentId}/${item.sessionId}`}
                  >
                    {name === undefined
                      ? item.title
                      : `${item.title} · ${name}`}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label="What should it build?">
            <Textarea
              rows={3}
              value={text}
              placeholder="Every morning, water the ferns and tell me if it rained"
              onChange={(event) => {
                setText(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void build();
                }
              }}
            />
          </Field>
          <span className="wf-ask-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={text.trim() === "" || sending}
              onClick={() => {
                void build();
              }}
            >
              {sending ? "Sending…" : "Send"}
            </Button>
          </span>
        </>
      )}
    </Surface>
  );
}
