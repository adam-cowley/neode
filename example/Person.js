/**
 * Person Definition
 */
export default {
    person_id: {
        type: 'uuid',
        primary: true,
    },
    name: {
        type: 'string',
        index: true,
    },
    age: 'number',
    knows: {
        type: 'relationship',
        relationship: 'KNOWS',
        direction: 'out',
        properties: {
            since: 'number',
        },
    }
};