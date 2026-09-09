import { pathToFileURL } from "node:url";

import { resolveReviewOutcomeRequestJson } from "./review-outcome-resolution.ts";
import { openReviewOutcomeReader } from "./review-store.ts";

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runReviewOutcomeResolutionCli(): Promise<number> {
  let reader: ReturnType<typeof openReviewOutcomeReader> | undefined;
  try {
    const input = await readStandardInput();
    const configuredDatabasePath =
      process.env.RTQ_REVIEW_STORE_DATABASE_PATH?.trim();
    reader = openReviewOutcomeReader(
      configuredDatabasePath
        ? { databasePath: configuredDatabasePath }
        : undefined,
    );
    process.stdout.write(resolveReviewOutcomeRequestJson(input, reader));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    process.stderr.write(`Review outcome resolution failed: ${message}\n`);
    return 1;
  } finally {
    reader?.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  process.exitCode = await runReviewOutcomeResolutionCli();
}
