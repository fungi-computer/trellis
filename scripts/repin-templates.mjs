// Regenerates the Trellis template pins from the maintained App declarations:
// the Prints/Shed/Inkcap/Bonsai catalog fixtures in test/fixtures and every
// methodDigest in templates/*.json. `--check` writes nothing and fails when stale.
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { log } from "node:console";
import { argv, exit } from "node:process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { catalogMethods } from "@fungi.computer/braid";
import { buildAppApi } from "@fungi.computer/agar/backend-declaration";
import { appBackend as prints } from "../../prints/backend/methods.ts";
import { appBackend as shed } from "../../shed/backend/methods.ts";
import { appBackend as inkcap } from "../../inkcap/backend/methods.ts";
import { appBackend as bonsai } from "../../bonsai/backend/methods.ts";

const command = "pnpm repin:templates";
const check = argv.includes("--check");
const path = (relative) =>
  fileURLToPath(new globalThis.URL(relative, import.meta.url));

const methodsOf = (backend) => buildAppApi(backend).methods;
const apps = {
  prints: methodsOf(prints),
  shed: methodsOf(shed),
  inkcap: methodsOf(inkcap),
  bonsai: methodsOf(bonsai),
};
const catalogs = Object.fromEntries(
  await Promise.all(
    Object.entries(apps).map(async ([app, methods]) => [
      app,
      await catalogMethods(methods),
    ]),
  ),
);

// Fixture file -> the catalog it must equal (Save-step Apps pin one method).
const single = (app, name) => ({
  methods: { [name]: catalogs[app].methods[name] },
});
const fixtures = {
  "prints-catalog.json": catalogs.prints,
  "shed-catalog.json": single("shed", "run"),
  "inkcap-catalog.json": single("inkcap", "writeFile"),
  "bonsai-catalog.json": single("bonsai", "repos.list"),
};

const stale = [];
const written = [];
const emit = async (file, text, current) => {
  if (text === current) return;
  stale.push(file);
  if (!check) {
    await writeFile(file, text);
    written.push(file);
  }
};

for (const [name, catalog] of Object.entries(fixtures)) {
  const file = path(`../test/fixtures/${name}`);
  const current = await readFile(file, "utf8");
  // Compare as data: the committed text is prettier-formatted, the write below is formatted after.
  await emit(
    file,
    isDeepStrictEqual(JSON.parse(current), catalog)
      ? current
      : `${JSON.stringify(catalog, null, 2)}\n`,
    current,
  );
}

// Template pins: replace each app step's methodDigest in place, keeping the file's text.
const pinned = (text) => {
  const steps = [];
  JSON.parse(text, (_key, value) => {
    if (value?.kind === "app" && value.methodDigest) steps.push(value);
    return value;
  });
  return steps;
};
const templatesDir = path("../templates/");
for (const name of (await readdir(templatesDir)).filter((n) =>
  n.endsWith(".json"),
)) {
  const file = `${templatesDir}${name}`;
  const text = await readFile(file, "utf8");
  let next = text;
  for (const step of pinned(text)) {
    const digest = catalogs[step.app]?.methods[step.method]?.digest;
    if (!digest)
      throw new Error(
        `${name}: no ${step.app}.${step.method} in the maintained declaration`,
      );
    next = next.replaceAll(
      `"methodDigest": "${step.methodDigest}"`,
      `"methodDigest": "${digest}"`,
    );
  }
  await emit(file, next, text);
}

if (!check && written.length > 0) {
  execFileSync(
    path("../../../node_modules/.bin/prettier"),
    ["--write", ...written],
    { stdio: "inherit" },
  );
}
if (check && stale.length > 0) {
  log(
    `Trellis template pins are stale: ${stale.join(", ")}\nRun \`${command}\` and commit the result.`,
  );
  exit(1);
}
log(
  check
    ? "Trellis template pins are current."
    : `Repinned ${written.length} file(s).`,
);
