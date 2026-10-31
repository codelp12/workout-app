// Sets the owner's password: `node dist/set-password.js`, or pipe it in.
// Uses DATABASE_PATH like the server, and signs out every existing session.
import { setPassword } from "./auth.js";
import { databasePath, openDb, runMigrations } from "./db.js";

const MIN_LENGTH = 8;

function readHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        value =
          ch === "\u007f" || ch === "\b" ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readStdin(): Promise<string> {
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  return input.replace(/\r?\n$/, "");
}

let password: string;
if (process.stdin.isTTY) {
  password = await readHidden("New password: ");
  if ((await readHidden("Repeat password: ")) !== password) {
    console.error("Passwords don't match.");
    process.exit(1);
  }
} else {
  password = await readStdin();
}

if (password.length < MIN_LENGTH) {
  console.error(`Password must be at least ${MIN_LENGTH} characters.`);
  process.exit(1);
}

const db = openDb(databasePath);
runMigrations(db);
await setPassword(db, password);
db.$client.close();
console.log(
  `Password set in ${databasePath}. Existing sessions are signed out.`,
);
