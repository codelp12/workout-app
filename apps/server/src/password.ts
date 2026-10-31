import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

// OWASP's argon2id baseline: 19 MiB, 2 passes, 1 lane.
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1 };
type Params = typeof PARAMS;

const PHC =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const b64 = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "");

function derive(
  password: string,
  nonce: Buffer,
  params: Params,
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      { message: password, nonce, tagLength, ...params },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Hashes with Node's built-in argon2id and returns a PHC string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, PARAMS, 32);
  const { memory, passes, parallelism } = PARAMS;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const m = PHC.exec(stored);
  if (!m) return false;
  const expected = Buffer.from(m[5]!, "base64");
  const params = {
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
  };
  const actual = await derive(
    password,
    Buffer.from(m[4]!, "base64"),
    params,
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}
