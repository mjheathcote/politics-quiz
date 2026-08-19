// Shared schema-validation helper, used by both scripts/validate.mjs (the CI/manual
// "check what's on disk" tool) and scripts/fetch-policies.mjs (the pipeline, which
// validates each API response before it's allowed to touch disk at all).
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCHEMA_PATH = path.join(ROOT, "scripts", "schema.json");

let _validate;
function getValidator() {
  if (!_validate) {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    _validate = ajv.compile(schema);
  }
  return _validate;
}

/**
 * Validates a parsed party-policy object.
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validatePartyData(partyId, data) {
  const validate = getValidator();
  const valid = validate(data);
  const errors = [];

  if (!valid) {
    for (const err of validate.errors) {
      errors.push(`${err.instancePath || "/"} ${err.message}`);
    }
  }
  if (valid && data.partyId !== partyId) {
    errors.push(`partyId field ("${data.partyId}") does not match expected "${partyId}"`);
  }
  if (valid && new Set(data.policies.map((p) => p.id)).size !== data.policies.length) {
    errors.push("duplicate policy id within this party's own policy list");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export { ROOT };
