import { useEffect, useState } from "react";

type ServerStatus = "checking" | "ok" | "unreachable";

export function App() {
  const [status, setStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    fetch("/healthz")
      .then((res) => setStatus(res.ok ? "ok" : "unreachable"))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <main>
      <h1>Hello, world</h1>
      <p>Server: {status}</p>
    </main>
  );
}
