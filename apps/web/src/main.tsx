import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { requestPersistentStorage } from "./storage";
import { UpdatePrompt } from "./UpdatePrompt";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

void requestPersistentStorage();

createRoot(root).render(
  <StrictMode>
    <App />
    <UpdatePrompt />
  </StrictMode>,
);
