/**
 * Adapts our Zod-generated JSON Schemas to OpenAI Structured Outputs strict
 * mode, and maps the response back:
 * - every object lists all properties as required and forbids extra ones;
 * - originally optional properties become nullable (strict mode has no optional);
 * - keywords strict mode does not accept are dropped (our Zod validation still
 *   enforces them on the result);
 * - system-only properties (evidence_origin) are not offered to the model.
 * stripOptionalNulls() removes the nulls the model returns for originally
 * optional properties, so the result validates against the original schema.
 */

type Json = Record<string, unknown>;

const DROPPED_KEYWORDS = new Set(["$schema", "minLength", "maxLength", "default", "format", "$id", "title"]);
const SYSTEM_ONLY_PROPERTIES = new Set(["evidence_origin"]);

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function nullable(schema: Json): Json {
  if (Array.isArray(schema.anyOf)) {
    return (schema.anyOf as Json[]).some((s) => s.type === "null") ? schema : { anyOf: [...(schema.anyOf as Json[]), { type: "null" }] };
  }
  return { anyOf: [schema, { type: "null" }] };
}

export function toStrictJsonSchema(schema: unknown): Json {
  if (!isObj(schema)) return {};
  const out: Json = {};
  for (const [k, v] of Object.entries(schema)) {
    if (DROPPED_KEYWORDS.has(k)) continue;
    if (k === "properties" || k === "required" || k === "additionalProperties") continue;
    if (k === "items") out.items = toStrictJsonSchema(v);
    else if (k === "anyOf" && Array.isArray(v)) out.anyOf = v.map(toStrictJsonSchema);
    else out[k] = v;
  }
  if (schema.type === "object" || isObj(schema.properties)) {
    const props = isObj(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const strictProps: Json = {};
    for (const [name, sub] of Object.entries(props)) {
      if (SYSTEM_ONLY_PROPERTIES.has(name)) continue;
      const converted = toStrictJsonSchema(sub);
      strictProps[name] = required.has(name) ? converted : nullable(converted);
    }
    out.type = "object";
    out.properties = strictProps;
    out.required = Object.keys(strictProps);
    out.additionalProperties = false;
  }
  return out;
}

/** Picks the branch of a schema that describes this value (object or array) when the schema is a union. */
function branchFor(schema: Json, value: unknown): Json | null {
  if (!Array.isArray(schema.anyOf)) return schema;
  const branches = schema.anyOf as Json[];
  if (Array.isArray(value)) return branches.find((b) => b.type === "array") ?? null;
  if (isObj(value)) return branches.find((b) => b.type === "object" || isObj(b.properties)) ?? null;
  return null;
}

export function stripOptionalNulls(value: unknown, originalSchema: unknown): unknown {
  if (!isObj(originalSchema)) return value;
  const schema = branchFor(originalSchema, value);
  if (!schema) return value;
  if (Array.isArray(value)) return value.map((item) => stripOptionalNulls(item, schema.items));
  if (!isObj(value)) return value;
  const props = isObj(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const out: Json = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null && !required.has(k)) continue;
    out[k] = stripOptionalNulls(v, props[k]);
  }
  return out;
}
