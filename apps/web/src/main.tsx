import Dexie from "dexie";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { requestPersistentStorage } from "./storage";
import { UpdatePrompt } from "./UpdatePrompt";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

void requestPersistentStorage();
// The Phase 0 spike store; its notes were test data.
void Dexie.delete("workout-app-spike");

createRoot(root).render(
  <StrictMode>
    <App />
    <UpdatePrompt />
  </StrictMode>,
);
