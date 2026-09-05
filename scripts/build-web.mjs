import { cp, rm, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "web-dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, "web"), output, { recursive: true });
console.log(`Static web output ready: ${path.relative(root, output)}`);
