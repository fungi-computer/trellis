import {
  CenteredCard,
  CardContent,
} from "@fungi.computer/caps/components/card";
import { useState } from "react";
import { RunWorkflow } from "../src/runs/run-workflow.js";
import { Triggers } from "../src/triggers/triggers.js";
import { TriggerFields } from "../src/editor/trigger-fields.js";
import { triggerUiFixture } from "./triggers.fixture.js";
import "../src/editor/editor.css";
export default { title: "Workflow inputs and triggers" };
export function Run() {
  const [fixture] = useState(triggerUiFixture);
  const [started, setStarted] = useState(false);
  return (
    <CenteredCard>
      <CardContent>
        <h1>Run Storyboard</h1>
        <p role="note">Local UI fixture · no Workflow executes.</p>
        {started ? (
          <p role="status">Run request accepted by the fixture.</p>
        ) : null}
        <RunWorkflow
          client={fixture.client}
          workflowId="storyboard"
          version={1}
          onRun={() => {
            setStarted(true);
          }}
        />
      </CardContent>
    </CenteredCard>
  );
}
export function Published() {
  const [fixture] = useState(triggerUiFixture);
  return (
    <>
      <p role="note">Local UI fixture · trigger state is simulated.</p>
      <Triggers
        client={fixture.client}
        workflowId="storyboard"
        control={fixture.control}
      />
    </>
  );
}
export function Authoring() {
  const [fixture] = useState(triggerUiFixture);
  const [definition, setDefinition] = useState(fixture.draft.definition);
  return (
    <CenteredCard>
      <CardContent>
        <h1>Storyboard triggers</h1>
        <p role="note">Local draft fixture · editing does not arm a trigger.</p>
        <TriggerFields
          definition={definition}
          catalog={fixture.catalog}
          appDisplay={{ Bonsai: { displayName: "Bonsai" } }}
          onChange={setDefinition}
        />
      </CardContent>
    </CenteredCard>
  );
}

export function UnionInput() {
  const [fixture] = useState(() =>
    triggerUiFixture({
      type: "object",
      properties: {
        choice: {
          description: "Use auto, or enter a whole number of rounds.",
          oneOf: [
            { type: "string", enum: ["auto"] },
            { type: "integer", minimum: 1 },
          ],
        },
      },
      required: ["choice"],
    }),
  );
  return (
    <CenteredCard>
      <CardContent>
        <h1>Run with a custom input</h1>
        <p role="note">Local UI fixture · no Workflow executes.</p>
        <RunWorkflow
          client={fixture.client}
          workflowId="union"
          version={1}
          onRun={() => undefined}
        />
      </CardContent>
    </CenteredCard>
  );
}

export function NumericInput() {
  const [fixture] = useState(() =>
    triggerUiFixture({
      type: "object",
      properties: {
        offset: {
          type: "number",
          minimum: -10,
          maximum: 10,
          default: 0,
          description: "A signed fractional offset.",
        },
      },
      required: ["offset"],
    }),
  );
  return (
    <CenteredCard>
      <CardContent>
        <h1>Run with a number</h1>
        <p role="note">Local UI fixture · no Workflow executes.</p>
        <RunWorkflow
          client={fixture.client}
          workflowId="number"
          version={1}
          onRun={() => undefined}
        />
      </CardContent>
    </CenteredCard>
  );
}
