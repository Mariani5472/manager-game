import { pathToFileURL } from "node:url"
import { createCli } from "./client/index.js";

async function main() {
    await createCli().parseAsync(process.argv)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
}