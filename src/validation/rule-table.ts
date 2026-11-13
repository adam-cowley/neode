import { z } from 'zod'
import { isInt } from 'neo4j-driver'

import { isRecord } from '../services/type-guards.js'
import { NeodeError } from '../errors/index.js'

import type { PropertySchema } from '../meta/property-schema.js'
import { PropertyType } from '../meta/property-schema.js'
import {
  anySchema,
  booleanSchema,
  dateSchema,
  datetimeSchema,
  durationSchema,
  floatSchema,
  integerSchema,
  isStringFormed,
  localdatetimeSchema,
  localtimeSchema,
  numberSchema,
  pointSchema,
  stringSchema,
  timeSchema,
  uuidSchema,
} from './value-schemas.js'

/**
Rule table — ports neode's Joi rule names (src/Services/Validator.js) onto
Zod. Each property builds a Zod schema from its PropertyType base schema
plus the rule options present on it, exactly like neode's
BuildValidationSchema did with Joi.

All rules are applied as refines/transforms on the base schema so they
compose with any base type and with each other, and so every failing check
is collected (zod runs all checks per value ≙ abortEarly: false).
*/

/**
Which family a base schema belongs to — decides which rules can apply
*/
type RuleKind = 'string' | 'number' | 'boolean' | 'temporal' | 'point' | 'duration' | 'any'

interface BuildContext {
  key: string
  kind: RuleKind
  config: Record<string, unknown>
}

interface BuildState {
  insensitive: boolean
  allowValues: unknown[]
  truncated: boolean
}

/**
Structural keys consumed by the metamodel, never rules (neode's ignore list)
*/
const IGNORED_KEYS = new Set([
  'labels',
  'type',
  'default',
  'alias',
  'properties',
  'primary',
  'relationship',
  'target',
  'direction',
  'eager',
  'hidden',
  'readonly',
  'index',
  'unique',
  'cascade',
  // neode-ogm metamodel keys
  'array',
  'protected',
  'exists',
  'onCreateSet',
  'onMatchSet',
  'alwaysSet',
  'createdAt',
  'updatedAt',
  'version',
])

/**
Rules applied only when their option is exactly true (neode's `booleans`)
*/
const BOOLEAN_TRUE_RULES = new Set([
  'optional',
  'forbidden',
  'strip',
  'positive',
  'negative',
  'port',
  'integer',
  'iso',
  'isoDate',
  'insensitive',
  'required',
  'truncate',
  'creditCard',
  'alphanum',
  'token',
  'hostname',
  'lowercase',
  'uppercase',
  'truthy',
  'falsy',
])

/**
Rules applied with an options object, or with defaults when true, and
skipped when falsy (neode's `booleanOrOptions`)
*/
const BOOLEAN_OR_OPTIONS_RULES = new Set(['email', 'ip', 'uri', 'base64', 'normalize', 'hex'])

// Pre-built format checks — used inside refines so they compose with any base
const IS_EMAIL = z.email()
const IS_URL = z.url()
const IS_IPV4 = z.ipv4()
const IS_IPV6 = z.ipv6()
const IS_UUID = z.uuid()
const IS_UUID_V4 = z.uuidv4()
const IS_CREDIT_CARD = z.creditCard()
const ISO_DATE = z.iso.date()
const ISO_DATETIME = z.iso.datetime({ offset: true, local: true })

const HOSTNAME_PATTERN =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

function failUnsupported(rule: string, key: string): never {
  // NTS-446: what failed, where, and the fix
  throw new NeodeError(
    `Cannot validate property "${key}": unknown validation rule "${rule}" — ` +
      'check the rule name in the property definition against the documented rules',
  )
}

/**
Rule options as a record; non-object options (true, a string, …) carry none
*/
function ruleOptions(options: unknown): Record<string, unknown> {
  return isRecord(options) ? options : {}
}

function asNumber(value: unknown): number | null {
  if (isInt(value)) {
    return value.toNumber()
  }

  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function doesMatch(value: unknown, expected: unknown, isInsensitive: boolean): boolean {
  return isInsensitive && typeof value === 'string' && typeof expected === 'string'
    ? value.toLowerCase() === expected.toLowerCase()
    : value === expected
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value
  }

  if (typeof value === 'number') {
    return new Date(value)
  }

  const string_ = parseableString(value)

  if (string_ !== null) {
    const date = new Date(string_)

    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

/**
The string form of a value: strings pass through; engine value objects
(the driver temporal classes and the embedded engine's Cypher value
classes) go through their declared toString.
*/
function parseableString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }

  return isStringFormed(value) ? value.toString() : null
}

function decimalPlaces(value: number): number {
  const parts = value.toString().split('.')

  return parts.length > 1 ? (parts[1]?.length ?? 0) : 0
}

function numberRefine(
  schema: z.ZodType,
  rule: string,
  message: string,
  isMatch: (value: number) => boolean,
): z.ZodType {
  return schema.refine(
    (value) => {
      const number_ = asNumber(value)

      return number_ !== null && isMatch(number_)
    },
    // NTS-676: the failing neode rule travels in params so validate() can
    // name it without touching Zod's own issue codes
    { message, params: { rule } },
  )
}

function stringRefine(
  schema: z.ZodType,
  rule: string,
  message: string,
  isMatch: (value: string) => boolean,
): z.ZodType {
  return schema.refine(
    (value) => {
      const string_ = asString(value)

      return string_ !== null && isMatch(string_)
    },
    { message, params: { rule } },
  )
}

/**
Rules applied only when their option is exactly true
*/
function applyBooleanRule(
  schema: z.ZodType,
  rule: string,
  context: BuildContext,
  state: BuildState,
): z.ZodType {
  const { key, kind } = context

  switch (rule) {
    case 'positive':
    case 'negative': {
      if (kind !== 'number') {
        failUnsupported(rule, key)
      }

      const isPositive = rule === 'positive'

      return numberRefine(
        schema,
        rule,
        `"${key}" must be a ${isPositive ? 'positive' : 'negative'} number`,
        (value) => (isPositive ? value > 0 : value < 0),
      )
    }

    case 'port': {
      if (kind !== 'number') {
        failUnsupported(rule, key)
      }

      return numberRefine(
        schema,
        rule,
        `"${key}" must be a valid port`,
        (value) => Number.isSafeInteger(value) && value >= 0 && value <= 65_535,
      )
    }

    case 'integer': {
      if (kind !== 'number') {
        failUnsupported(rule, key)
      }

      return numberRefine(schema, rule, `"${key}" must be an integer`, (value) =>
        Number.isSafeInteger(value),
      )
    }

    case 'isoDate':
    case 'iso': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      return schema.refine(
        (value) => ISO_DATE.safeParse(value).success || ISO_DATETIME.safeParse(value).success,
        { message: `"${key}" must be in ISO 8601 format`, params: { rule } },
      )
    }

    case 'creditCard': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      return schema.refine((value) => IS_CREDIT_CARD.safeParse(value).success, {
        message: `"${key}" must be a valid credit card number`,
        params: { rule },
      })
    }

    case 'alphanum': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      return stringRefine(
        schema,
        rule,
        `"${key}" must only contain alpha-numeric characters`,
        (value) => /^[a-zA-Z0-9]+$/.test(value),
      )
    }

    case 'token': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      return stringRefine(
        schema,
        rule,
        `"${key}" must only contain alpha-numeric and underscore characters`,
        (value) => /^[a-zA-Z0-9_]+$/.test(value),
      )
    }

    case 'hostname': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      return stringRefine(schema, rule, `"${key}" must be a valid hostname`, (value) =>
        HOSTNAME_PATTERN.test(value),
      )
    }

    case 'lowercase': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      return schema.transform((value) => asString(value)?.toLowerCase() ?? value)
    }

    case 'uppercase': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      return schema.transform((value) => asString(value)?.toUpperCase() ?? value)
    }

    case 'truthy':
    case 'falsy': {
      if (kind !== 'boolean') {
        failUnsupported(rule, key)
      }

      const isExpected = rule === 'truthy'

      return schema.refine((value) => value === isExpected, {
        message: `"${key}" must be ${String(isExpected)}`,
        params: { rule },
      })
    }

    case 'truncate': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      // Already handled alongside max (Joi: truncate makes max truncate
      // instead of fail) — don't transform twice
      if (state.truncated) {
        return schema
      }

      const limit = typeof context.config['max'] === 'number' ? context.config['max'] : null

      if (limit === null) {
        throw new NeodeError('"truncate" must have a max limit')
      }

      state.truncated = true

      return schema.transform((value) => {
        const string_ = asString(value)

        return string_ !== null && string_.length > limit ? string_.slice(0, limit) : value
      })
    }

    case 'insensitive': {
      state.insensitive = true

      return schema
    }

    case 'forbidden': {
      return schema.refine(() => false, {
        message: `"${key}" is not allowed`,
        params: { rule },
      })
    }

    // Presence rules are carried by the metamodel (PropertySchema) and
    // applied by validate(); nothing to do on the schema itself
    case 'required':
    case 'optional':
    case 'strip': {
      return schema
    }

    default: {
      failUnsupported(rule, key)
    }
  }
}

/**
Rules applied with an options object, or with defaults when true
*/
function applyStringFormat(
  schema: z.ZodType,
  rule: string,
  options: Record<string, unknown>,
  context: BuildContext,
): z.ZodType {
  const { key } = context

  if (context.kind !== 'string') {
    failUnsupported(rule, key)
  }

  switch (rule) {
    case 'email': {
      return schema.refine((value) => IS_EMAIL.safeParse(value).success, {
        message: `"${key}" must be a valid email`,
        params: { rule },
      })
    }

    case 'uri': {
      return schema.refine((value) => IS_URL.safeParse(value).success, {
        message: `"${key}" must be a valid uri`,
        params: { rule },
      })
    }

    case 'ip': {
      return schema.refine(
        (value) => IS_IPV4.safeParse(value).success || IS_IPV6.safeParse(value).success,
        { message: `"${key}" must be a valid ip address`, params: { rule } },
      )
    }

    case 'base64': {
      const pattern =
        options['paddingRequired'] === false
          ? /^[A-Za-z0-9+/]+(={0,2})?$/
          : /^[A-Za-z0-9+/]+={0,2}$/

      return stringRefine(schema, rule, `"${key}" must be a valid base64 string`, (value) =>
        pattern.test(value),
      )
    }

    case 'hex': {
      const isAllowPrefix = options['prefix'] === true
      const isByteAligned = options['byteAligned'] === true

      return stringRefine(
        schema,
        rule,
        `"${key}" must only contain hexadecimal characters`,
        (value) => {
          const body = isAllowPrefix ? value.replace(/^0x/i, '') : value

          return /^[0-9a-f]+$/i.test(body) && (!isByteAligned || body.length % 2 === 0)
        },
      )
    }

    case 'normalize': {
      const form = typeof options['form'] === 'string' ? options['form'] : 'NFC'

      return schema.transform((value) => asString(value)?.normalize(form) ?? value)
    }

    default: {
      failUnsupported(rule, key)
    }
  }
}

/**
Rules applied with their options as-is, on whichever base type supports them
*/
function applyGenericRule(
  schema: z.ZodType,
  rule: string,
  options: unknown,
  context: BuildContext,
  state: BuildState,
): z.ZodType {
  const { key, kind } = context

  switch (rule) {
    case 'min':
    case 'max': {
      if (typeof options !== 'number' || (kind !== 'string' && kind !== 'number')) {
        failUnsupported(rule, key)
      }

      const limit: number = options
      const isMin = rule === 'min'

      if (kind === 'number') {
        return numberRefine(
          schema,
          rule,
          isMin
            ? `"${key}" must be greater than or equal to ${String(limit)}`
            : `"${key}" must be less than or equal to ${String(limit)}`,
          (value) => (isMin ? value >= limit : value <= limit),
        )
      }

      // Joi semantics: truncate makes max truncate the value instead of
      // failing, so the limit is applied as a transform
      if (!isMin && context.config['truncate'] === true) {
        state.truncated = true

        return schema.transform((value) => {
          const string_ = asString(value)

          return string_ !== null && string_.length > limit ? string_.slice(0, limit) : value
        })
      }

      return stringRefine(
        schema,
        rule,
        isMin
          ? `"${key}" length must be at least ${String(limit)} characters long`
          : `"${key}" length must be less than or equal to ${String(limit)} characters long`,
        (value) => (isMin ? value.length >= limit : value.length <= limit),
      )
    }

    case 'length': {
      if (kind !== 'string' || typeof options !== 'number') {
        failUnsupported(rule, key)
      }

      return stringRefine(
        schema,
        rule,
        `"${key}" length must be ${String(options)} characters long`,
        (value) => value.length === options,
      )
    }

    case 'precision': {
      if (kind !== 'number' || typeof options !== 'number') {
        failUnsupported(rule, key)
      }

      return numberRefine(
        schema,
        rule,
        `"${key}" must have no more than ${String(options)} decimal places`,
        (value) => decimalPlaces(value) <= options,
      )
    }

    case 'multiple': {
      if (kind !== 'number' || typeof options !== 'number') {
        failUnsupported(rule, key)
      }

      return numberRefine(
        schema,
        rule,
        `"${key}" must be a multiple of ${String(options)}`,
        (value) => value % options === 0,
      )
    }

    case 'regex': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      const isRegExp = options instanceof RegExp
      const options_ = isRegExp ? {} : ruleOptions(options)
      const pattern = isRegExp ? options : options_['pattern']
      const isInvert = options_['invert'] === true
      const name = typeof options_['name'] === 'string' ? options_['name'] : null

      if (!(pattern instanceof RegExp)) {
        failUnsupported(rule, key)
      }

      const patternName = name === null || name === '' ? 'required' : `"${name}"`

      return stringRefine(
        schema,
        rule,
        `"${key}" fails to match the ${patternName} pattern`,
        (value) => pattern.test(value) !== isInvert,
      )
    }

    case 'replace': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      const options_ = ruleOptions(options)
      const pattern = options_['pattern']
      const replacement = typeof options_['replace'] === 'string' ? options_['replace'] : ''

      if (typeof pattern !== 'string' && !(pattern instanceof RegExp)) {
        failUnsupported(rule, key)
      }

      // Function form so user-supplied replacement strings never get their
      // `$` patterns expanded by String#replace
      return schema.transform(
        (value) => asString(value)?.replace(pattern, () => replacement) ?? value,
      )
    }

    case 'before':
    case 'after': {
      if (kind !== 'temporal') {
        failUnsupported(rule, key)
      }

      const isBefore = rule === 'before'

      return schema.refine(
        (value) => {
          const valueDate = toDate(value)
          const boundary = options === 'now' ? new Date() : toDate(options)

          if (valueDate === null || boundary === null) {
            return false
          }

          return isBefore
            ? valueDate.getTime() <= boundary.getTime()
            : valueDate.getTime() >= boundary.getTime()
        },
        {
          message: `"${key}" must be ${isBefore ? 'before' : 'after'} the expected boundary`,
          params: { rule },
        },
      )
    }

    case 'guid': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      const options_ = ruleOptions(options)
      const version = options_['version'] === 'uuidv4' ? IS_UUID_V4 : IS_UUID

      return schema.refine((value) => version.safeParse(value).success, {
        message: `"${key}" must be a valid GUID`,
        params: { rule },
      })
    }

    case 'trim': {
      if (kind !== 'string') {
        failUnsupported(rule, key)
      }

      return options === undefined || options === false
        ? schema
        : schema.transform((value) => asString(value)?.trim() ?? value)
    }

    case 'allow': {
      const values: unknown[] = Array.isArray(options) ? options : [options]

      state.allowValues.push(...values)

      return schema
    }

    case 'valid': {
      const values: unknown[] = Array.isArray(options) ? options : [options]

      return schema.refine(
        (value) => values.some((expected) => doesMatch(value, expected, state.insensitive)),
        { message: `"${key}" must be one of ${JSON.stringify(values)}`, params: { rule } },
      )
    }

    case 'invalid': {
      const values: unknown[] = Array.isArray(options) ? options : [options]

      return schema.refine(
        (value) => values.every((expected) => !doesMatch(value, expected, state.insensitive)),
        { message: `"${key}" contains an invalid value`, params: { rule } },
      )
    }

    // We never coerce types, so Joi's strict mode is the default
    case 'strict': {
      return schema
    }

    // Empty values are treated as unset by validate() (Joi's default
    // `empty` value is ''); per-property empty sets need rule storage in
    // the metamodel first
    case 'empty': {
      return schema
    }

    default: {
      failUnsupported(rule, key)
    }
  }
}

function applyRule(
  schema: z.ZodType,
  rule: string,
  options: unknown,
  context: BuildContext,
  state: BuildState,
): z.ZodType {
  if (BOOLEAN_OR_OPTIONS_RULES.has(rule)) {
    if (options === undefined || options === false) {
      return schema
    }

    const options_ = ruleOptions(options)

    return applyStringFormat(schema, rule, options_, context)
  }

  if (BOOLEAN_TRUE_RULES.has(rule)) {
    return options === true ? applyBooleanRule(schema, rule, context, state) : schema
  }

  return applyGenericRule(schema, rule, options, context, state)
}

function baseSchemaFor(property: PropertySchema): { schema: z.ZodType; kind: RuleKind } {
  switch (property.getType()) {
    case PropertyType.STRING: {
      return { schema: stringSchema, kind: 'string' }
    }
    case PropertyType.INTEGER: {
      return { schema: integerSchema, kind: 'number' }
    }
    case PropertyType.FLOAT: {
      return { schema: floatSchema, kind: 'number' }
    }
    case PropertyType.NUMBER: {
      return { schema: numberSchema, kind: 'number' }
    }
    case PropertyType.BOOLEAN: {
      return { schema: booleanSchema, kind: 'boolean' }
    }
    case PropertyType.UUID: {
      return { schema: uuidSchema, kind: 'string' }
    }
    case PropertyType.DATE: {
      return { schema: dateSchema, kind: 'temporal' }
    }
    case PropertyType.TIME: {
      return { schema: timeSchema, kind: 'temporal' }
    }
    case PropertyType.DATETIME: {
      return { schema: datetimeSchema, kind: 'temporal' }
    }
    case PropertyType.LOCALTIME: {
      return { schema: localtimeSchema, kind: 'temporal' }
    }
    case PropertyType.LOCALDATETIME: {
      return { schema: localdatetimeSchema, kind: 'temporal' }
    }
    case PropertyType.POINT: {
      return { schema: pointSchema, kind: 'point' }
    }
    case PropertyType.DURATION: {
      return { schema: durationSchema, kind: 'duration' }
    }
    case PropertyType.ANY:
    case PropertyType.INTERNAL_ID:
    case PropertyType.ALL_PROPERTIES:
    case PropertyType.ONE_TO_ONE:
    case PropertyType.ONE_TO_MANY:
    case PropertyType.RELATED_ONE:
    case PropertyType.RELATED_MANY:
    case PropertyType.RELATIONSHIP_COUNT:
    case PropertyType.RELATIONSHIP_EXISTS:
    case PropertyType.LABEL_PRESENT:
    case PropertyType.COMPUTED:
    case PropertyType.EXPRESSION:
    case PropertyType.START_NODE:
    case PropertyType.END_NODE:
    case PropertyType.OTHER_NODE:
    case PropertyType.NODE:
    case PropertyType.RELATIONSHIP: {
      return { schema: anySchema, kind: 'any' }
    }
    default: {
      return { schema: anySchema, kind: 'any' }
    }
  }
}

/**
One engine validation issue, declared structurally — NTS-676: the Zod
types stay inside the implementation, out of the built type surface.
validate() maps these onto neode's own ValidationIssue shape.
*/
export interface SchemaIssue {
  code: string
  message: string
  path: PropertyKey[]
  params?: unknown
}

/**
The piece of the engine schema validate() / relationship-values consume —
the Zod schema satisfies this structurally.
*/
export interface PropertyCheck {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: { issues: SchemaIssue[] } }
}

/**
Build the Zod schema for one property: its PropertyType base schema plus
the neode-style rule options (`{ min: 2, max: 50, email: true }`, keys in
neode's rule names). Unknown rules, or rules the base type does not
support, throw `Not sure how to validate <rule> on <key>` like neode.

The neode-ogm metamodel does not store rule options yet (PropertySchema
has no config bag), so rules travel in the `config` argument — validate()
builds configless schemas until rule storage lands.
*/
export function buildPropertySchema(
  property: PropertySchema,
  config: Record<string, unknown> = {},
): PropertyCheck {
  const { schema: base, kind } = baseSchemaFor(property)
  const context: BuildContext = { key: property.getKey(), kind, config }
  const state: BuildState = { insensitive: false, allowValues: [], truncated: false }

  let schema = base

  for (const [rule, ruleOptions] of Object.entries(config)) {
    if (IGNORED_KEYS.has(rule)) {
      continue
    }

    schema = applyRule(schema, rule, ruleOptions, context, state)
  }

  // allow values bypass every other check (Joi semantics)
  if (state.allowValues.length > 0) {
    schema = z.union([
      z.custom((value) =>
        state.allowValues.some((expected) => doesMatch(value, expected, state.insensitive)),
      ),
      schema,
    ])
  }

  return property.isArray() ? z.array(schema) : schema
}
