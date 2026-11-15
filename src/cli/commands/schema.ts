/**
 * `timewright schema` - print the JSON Schema for the world format.
 *
 * The schema is what an agent reads: it describes every record, every field
 * and what is required, so a model can write valid YAML without guessing.
 */

import { writeFile } from "node:fs/promises";

import { worldJsonSchema } from "../../core/schema.js";

export interface SchemaOptions {
  out?: string | undefined;
}

export async function runSchema(options: SchemaOptions = {}): Promise<number> {
  const text = `${JSON.stringify(worldJsonSchema(), null, 2)}\n`;
  if (options.out !== undefined) {
    await writeFile(options.out, text, "utf8");
    console.log(`wrote ${options.out}`);
  } else {
    process.stdout.write(text);
  }
  return 0;
}
