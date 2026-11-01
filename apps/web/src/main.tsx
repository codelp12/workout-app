import Dexie from "dexie";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
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
    <BrowserRouter>
      <ToastProvider>
        <App />
        <UpdatePrompt />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
