import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "@fungi.computer/caps/fonts.css";
import "./trellis.css";
import { WorkflowApp } from "./app.js";

const root = document.getElementById("trellis-root");
if (!root) throw new Error("Workflow App root is missing");
createRoot(root).render(createElement(WorkflowApp));
