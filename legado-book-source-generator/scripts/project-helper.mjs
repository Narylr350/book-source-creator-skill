import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initializeOutputBundle } from "./lib/output-bundle.mjs";
import { validateBookSource } from "./lib/source-validate.mjs";

function readSource(jsonPath) {
  const payload = jsonPath
    ? fs.readFileSync(jsonPath, "utf8")
    : fs.readFileSync(0, "utf8");
  const data = JSON.parse(payload);
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new Error("Book source payload must contain at least one source.");
    }
    return data;
  }
  if (!data || typeof data !== "object") {
    throw new Error("Book source payload must be a JSON object or a non-empty JSON array.");
  }
  return [data];
}


function printUsage() {
  console.error(
    "Usage:\n" +
      "  node project-helper.mjs scaffold-output <outputs-root> <site-url>\n" +
      "  node project-helper.mjs validate-source [book-source.json]",
  );
}


function main(argv) {
  const [command, ...rest] = argv;

  if (command === "scaffold-output") {
    if (rest.length !== 2) {
      printUsage();
      return 2;
    }
    const [rootDir, siteUrl] = rest;
    const bundleDir = initializeOutputBundle(rootDir, siteUrl);
    console.log(bundleDir);
    return 0;
  }

  if (command === "validate-source") {
    if (rest.length > 1) {
      printUsage();
      return 2;
    }
    try {
      const sources = readSource(rest[0]);
      const errors = [];
      for (const [index, source] of sources.entries()) {
        const sourceErrors = validateBookSource(source);
        for (const error of sourceErrors) {
          errors.push(sources.length > 1 ? `[${index}] ${error}` : error);
        }
      }
      if (errors.length > 0) {
        for (const error of errors) {
          console.error(error);
        }
        return 1;
      }
      console.log("Book source JSON is valid.");
      return 0;
    } catch (error) {
      console.error(`Failed to load JSON: ${error.message}`);
      return 2;
    }
  }

  printUsage();
  return 2;
}


if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
