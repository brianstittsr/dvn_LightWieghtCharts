import { promises as fs } from "node:fs";
import path from "node:path";

/** Tiny JSON-file store under data/ — server-side only. */

const DIR = path.join(process.cwd(), "data");

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DIR, file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(file: string, data: T): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = path.join(DIR, `${file}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, path.join(DIR, file));
}
