import type { EntitySchema } from '../meta/entity/entity-schema.js'
import { PropertyType } from '../meta/property-schema.js'
import { RawExpression } from '../query/expressions.js'
import { isRecord } from '../services/type-guards.js'
import { buildPropertySchema } from './rule-table.js'
import { ValidationError, type ValidationIssue } from './validation-error.js'

/**
Property types that reference entities or internals — never validated as values
*/
const SKIPPED_TYPES = new Set<PropertyType>([
  PropertyType.INTERNAL_ID,
  PropertyType.ONE_TO_ONE,
  PropertyType.ONE_TO_MANY,
  PropertyType.START_NODE,
  PropertyType.END_NODE,
  PropertyType.OTHER_NODE,
  PropertyType.NODE,
  PropertyType.RELATIONSHIP,
])

/**
The neode rule name for a base-schema failure (rule refines carry their
config key in `params.rule` instead — rule-table). Unknown codes pass
through: a future Zod code is more informative than a wrong neode name
(NTS-676 — Zod is an implementation detail; only the mapped names are
part of the contract).
*/
const CODE_RULES: Record<string, string> = {
  invalid_type: 'type',
  invalid_union: 'type',
  invalid_format: 'format',
  // z.custom base checks (temporal, point, duration, driver Integer)
  custom: 'type',
}

function ruleOf(issue: { code: string; params?: unknown }): string {
  const named = isRecord(issue.params) ? issue.params['rule'] : undefined

  return typeof named === 'string' ? named : (CODE_RULES[issue.code] ?? issue.code)
}

/**
Validate an object against an entity schema. Runs the Zod schema for every
registered property (type base + rules), collecting all issues — like
Joi's abortEarly: false — and throwing a ValidationError when anything
fails. Issues are reported in neode's own shape (path, rule, message —
NTS-676), never Zod's.

Unknown keys are always allowed (allowUnknown): only registered properties
are validated. undefined is skipped unless the property is required; null
behaves the same (a required property fails with `"<key>" is required`,
an optional property passes).
*/
export function validate(properties: Record<string, unknown>, schema: EntitySchema): void {
  const issues: ValidationIssue[] = []

  for (const property of schema.getProperties()) {
    if (SKIPPED_TYPES.has(property.getType())) {
      continue
    }

    const key = property.getKey()
    const value = Object.hasOwn(properties, key) ? properties[key] : undefined

    // NTS-629: a raw Cypher expression is evaluated by the database — the
    // JavaScript value is unknown at write time, so the value is not
    // validated (the stored value is checked on the next read)
    if (value instanceof RawExpression) {
      continue
    }

    // Joi's default `empty` value: '' is treated as unset
    const effective = value === '' ? undefined : value

    if (effective === undefined || effective === null) {
      if (property.isRequired()) {
        issues.push({ message: `"${key}" is required`, path: [key], rule: 'required' })
      }

      continue
    }

    const result = buildPropertySchema(property, property.getRules()).safeParse(effective)

    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({
          message: issue.message,
          path: [key, ...issue.path.map(String)],
          rule: ruleOf(issue),
        })
      }
    }
  }

  if (issues.length > 0) {
    throw new ValidationError(issues, properties)
  }
}

export { buildPropertySchema } from './rule-table.js'
