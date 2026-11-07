import { bench, describe } from 'vitest';
import { getModel } from '../src/meta';
import { defineModel } from '../src/meta/map-schema';
import EntitySchema from '../src/meta/entity/entity-schema';
import PropertySchema from '../src/meta/property-schema';
import { validate, buildPropertySchema } from '../src/validation';

// ---- Fixtures (map-based models; registry is global per file) ---------------

// Small entity: 3 properties, no rules beyond required
const Small = defineModel('BenchValidationSmall', {
    id: { type: 'uuid', primary: true },
    name: { type: 'string', required: true },
    age: 'number',
});

// Rule-heavy entity: 8 properties, most with chained rules
const Heavy = defineModel('BenchValidationHeavy', {
    id: { type: 'uuid', primary: true },
    email: { type: 'string', min: 5, email: true },
    website: { type: 'string', uri: true },
    handle: { type: 'string', alphanum: true, min: 3, max: 20 },
    tagline: { type: 'string', max: 200, truncate: true },
    ip: { type: 'string', ip: true },
    score: { type: 'number', positive: true, integer: true },
    joined: { type: 'string', isoDate: true },
});

const smallSchema = getModel(Small) as EntitySchema;
const heavySchema = getModel(Heavy) as EntitySchema;

const UUID = '1b671a64-40d5-491e-99b0-da01ff1f3341';

const smallProps = { id: UUID, name: 'Adam', age: 35 };

const heavyProps: Record<string, unknown> = {
    id: UUID,
    email: 'adam@example.com',
    website: 'https://example.com',
    handle: 'adamcowley',
    tagline: 'hello',
    ip: '192.168.0.1',
    score: 42,
    joined: '2026-01-01',
};

describe('validate() — Zod throughput', () => {
    bench('small entity (3 props)', () => validate(smallProps, smallSchema));

    bench('rule-heavy entity (8 props, chained rules)', () => validate(heavyProps, heavySchema));
});

describe('buildPropertySchema — rebuilt per call vs cached', () => {
    const email = heavySchema.getProperty('email') as PropertySchema;
    const emailRules = email.getRules();

    bench('rebuild per call (single property)', () => buildPropertySchema(email, emailRules));

    const cachedEmail = buildPropertySchema(email, emailRules);

    bench('cached schema .safeParse (single property)', () =>
        cachedEmail.safeParse('adam@example.com'));

    // validate() rebuilds the Zod schema for every property on every call.
    // Cached counterpart of validate() for the heavy entity: build once,
    // then parse every property per call — the rebuild overhead is the
    // difference against the "rule-heavy entity" bench above.
    const cachedHeavy = heavySchema
        .getProperties()
        .map(property => ({
            schema: buildPropertySchema(property, property.getRules()),
            value: heavyProps[ property.getKey() ],
        }));

    bench('heavy entity — cached schemas, validate-shaped loop', () => {
        for (const { schema, value } of cachedHeavy) {
            schema.safeParse(value);
        }
    });
});
