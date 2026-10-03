/**
 * One-shot migration: copy data/*.json into Firestore.
 * Run: node scripts/migrate-to-firestore.mjs
 * Requires FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 * in .env.local.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Minimal .env.local parser (no dotenv dependency).
const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?\s*$/);
  if (m) env[m[1]] = m[2].replace(/\\n/g, "\n");
}

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const app = initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  }),
});
const db = getFirestore(app);

const jobs = [
  ["data/users.json", "tradingAccounts", (doc) => doc.id],
  ["data/futures-bots.json", "futuresBots", (doc) => doc.id],
];

for (const [file, coll, keyOf] of jobs) {
  if (!existsSync(file)) {
    console.log(`skip ${file} (not found)`);
    continue;
  }
  const docs = JSON.parse(readFileSync(file, "utf8"));
  for (const d of docs) {
    await db.collection(coll).doc(keyOf(d)).set(d);
  }
  console.log(`migrated ${docs.length} docs → ${coll}`);
}

if (existsSync("data/settings.json")) {
  await db.doc("appSettings/app").set(JSON.parse(readFileSync("data/settings.json", "utf8")));
  console.log("migrated settings → appSettings/app");
}
console.log("done");
