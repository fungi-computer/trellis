import type { Catalog } from "@fungi.computer/braid";
import type { Draft } from "../src/editor/draft-store.js";
/** UI proof only. These are deliberately not claims about deployed App methods. */
export const fixtureCatalog: Catalog = {
  Prints: {
    methods: {
      generate: {
        description: "Generate a panel",
        digest: "fixture-generate",
        effect: "write",
        approval: "none",
        requires: [],
        input: {
          type: "object",
          properties: { prompt: { type: "string" } },
          required: ["prompt"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { image: { type: "string", format: "fungi:image" } },
          required: ["image"],
          additionalProperties: false,
        },
      },
    },
  },
  Shed: {
    methods: {
      run: {
        description: "Process a generated image",
        digest: "fixture-run",
        effect: "external",
        approval: "queue",
        requires: [],
        input: {
          type: "object",
          properties: {
            file: { type: "string", format: "fungi:image" },
            command: { type: "string" },
          },
          required: ["file", "command"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { output: { type: "string", format: "fungi:file" } },
          required: ["output"],
          additionalProperties: false,
        },
      },
    },
  },
};
export const fixtureDraft: Draft = {
  definition: {
    format: "fungi.workflow/v1",
    title: "Panel to plates",
    apps: { prints: { appId: "Prints" }, shed: { appId: "Shed" } },
    input: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
      additionalProperties: false,
    },
    nodes: [
      {
        id: "generate",
        kind: "app",
        app: "prints",
        method: "generate",
        methodDigest: "fixture-generate",
        values: {},
      },
      {
        id: "review",
        kind: "review",
        title: "Keep this panel?",
        show: [{ node: "generate", port: "image" }],
        reviewers: "runner",
        timeout: 86400000,
      },
      {
        id: "plates",
        kind: "app",
        app: "shed",
        method: "run",
        methodDigest: "fixture-run",
        values: { command: { literal: "upscale image" } },
      },
    ],
    edges: [
      {
        from: { node: "$input", port: "prompt" },
        to: { node: "generate", port: "prompt" },
      },
      {
        from: { node: "review", port: "approved" },
        to: { node: "plates", port: "file" },
      },
    ],
    output: { file: { node: "plates", port: "output" } },
  },
  layout: {
    $input: { x: 0, y: 40 },
    generate: { x: 360, y: 40 },
    review: { x: 0, y: 250 },
    plates: { x: 360, y: 250 },
  },
};
