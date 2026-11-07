import { bench, describe } from 'vitest';
import { getModel } from '../src/meta';
import { defineModel } from '../src/meta/map-schema';
import EntitySchema from '../src/meta/entity/entity-schema';
import type { GraphNode, GraphRelationship } from '../src/driver/types';
import type { EagerRelationship, EagerNode } from '../src/utilities';
import { hydrateNode } from '../src/utilities';

// ---- Fixtures (map-based models; registry is global per file) ---------------

const Post = defineModel('BenchHydrationPost', {
    id: { type: 'uuid', primary: true },
    title: 'string',
});

const User = defineModel('BenchHydrationUser', {
    id: { type: 'uuid', primary: true },
    name: 'string',
    email: 'string',
    age: 'number',
    active: 'boolean',
});

const Author = defineModel('BenchHydrationAuthor', {
    id: { type: 'uuid', primary: true },
    name: 'string',
    posts: {
        type: 'relationships',
        relationship: 'WROTE',
        direction: 'out',
        target: 'BenchHydrationPost',
    },
});

const userSchema = getModel(User) as EntitySchema;
const authorSchema = getModel(Author) as EntitySchema;

const POSTS_PER_AUTHOR = 3;

const uuid = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function userNode(i: number): GraphNode {
    return {
        elementId: `4:0:${i}`,
        labels: [ 'BenchHydrationUser' ],
        properties: {
            id: uuid(i),
            name: `User ${i}`,
            email: `user${i}@example.com`,
            age: i % 80,
            active: i % 2 === 0,
        },
    };
}

function postNode(i: number): GraphNode {
    return {
        elementId: `4:1:${i}`,
        labels: [ 'BenchHydrationPost' ],
        properties: { id: uuid(i), title: `Post ${i}` },
    };
}

// Flat synthetic result records (as returned by the driver, pre-hydration)
const flat10 = Array.from({ length: 10 }, (_, i) => userNode(i));
const flat100 = Array.from({ length: 100 }, (_, i) => userNode(i));
const flat1000 = Array.from({ length: 1000 }, (_, i) => userNode(i));

// 100 authors, each with POSTS_PER_AUTHOR eagerly loaded posts in the
// legacy hand-built shape ({ rel, start, end, other })
const EAGER_AUTHORS = 100;

const authorNodes = Array.from({ length: EAGER_AUTHORS }, (_, i) => userNode(i));

const authorEagers = authorNodes.map((node, i) => ({
    posts: Array.from({ length: POSTS_PER_AUTHOR }, (_, p) => {
        const relId = i * POSTS_PER_AUTHOR + p;
        const rel: GraphRelationship = {
            elementId: `5:0:${relId}`,
            type: 'WROTE',
            startElementId: node.elementId,
            endElementId: `4:1:${relId}`,
            properties: {},
        };
        const other: EagerNode = { node: postNode(relId) };

        return { rel, start: { node } as EagerNode, end: other, other } satisfies EagerRelationship;
    }),
}));

describe('hydrateNode — synthetic result records', () => {
    bench('10 nodes (flat)', () => {
        for (const node of flat10) hydrateNode(userSchema, User, node);
    });

    bench('100 nodes (flat)', () => {
        for (const node of flat100) hydrateNode(userSchema, User, node);
    });

    bench('1000 nodes (flat)', () => {
        for (const node of flat1000) hydrateNode(userSchema, User, node);
    });

    bench('100 nodes with 1-degree eager nesting (3 posts each)', () => {
        for (let i = 0; i < EAGER_AUTHORS; i++) {
            hydrateNode(authorSchema, Author, authorNodes[ i ], authorEagers[ i ]);
        }
    });
});
