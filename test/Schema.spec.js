import {assert, expect} from 'chai';
import Neode from '../src/index';
import Schema from '../src/Schema';
import uuid from 'uuid';

describe('Schema.js', () => {
    const instance = require('./instance');

    const label = 'SchemaThing';

    instance.model(label, {
        id: {
            type: 'string',
            required: true,
            unique: true,
        },
        name: {
            type: 'string',
            required: true
        },
        age: {
            type: 'number',
            index: true
        }
    });

    it('should construct', () => {
        assert.instanceOf(instance.schema, Schema);
        assert.isFunction(instance.schema.install);
        assert.isFunction(instance.schema.drop);
    });

    it('should install the schema', (done) => {
        // TODO: Tests for Enterprise Mode
        instance.schema.install()
            .then(() => instance.cypher('CALL db.constraints'))
            .then(constraints => {
                const expected = {
                    id: {unique: true},
                };
                let actual = {
                    id: {},
                    name: {}
                };

                // Enterprise?
                if (instance.enterprise()) {
                    expected.id.required = true;
                    expected.name = {index: true};
                }

                // Check Constraints
                const is_unique = /CONSTRAINT ON \( ([a-z0-9]+):([A-Za-z0-9]+) \) ASSERT ([a-z0-9]+).([A-Za-z0-9]+) IS UNIQUE/;
                const will_exist = /CONSTRAINT ON \( ([a-z0-9]+):([A-Za-z0-9]+) \) ASSERT exists\(([a-z0-9]+).([A-Za-z0-9]+)\)/;

                constraints.records.forEach(constraint => {
                    const description = constraint.get('description');

                    const unique = description.match(is_unique);
                    const exists = description.match(will_exist);

                    if (unique && unique[2] == label) {
                        if (!actual[ unique[4] ]) {
                            actual[ unique[4] ] = {}
                        }
                        actual[ unique[4] ].unique = true
                    }

                    if (exists && exists[2] !== label) {
                        if (!actual[ exists[4] ]) {
                            actual[ exists[4] ] = {}
                        }
                        actual[ exists[4] ].exists = true
                    }
                })

                Object.keys(expected).forEach(key => {
                    expect(actual[key]).to.deep.include(expected[key])
                });
            })
            .then(() => instance.cypher('CALL db.indexes'))
            .then(indexes => {
                const expected = {
                    age: true
                };
                let actual = {};

                const has_index = /INDEX ON :([A-Za-z0-9]+)\(([A-Za-z0-9]+)\)/

                indexes.records.forEach(index => {
                    const description = index.get('description');
                    const is_indexed =  description.match(has_index);

                    if (is_indexed && is_indexed[1] == label) {
                        actual[is_indexed[2]] = true;
                    }
                });

                expect(actual).to.include(expected);
            })
            .then(done)
            .catch(done)
    });

    it('should drop the schema', (done) => {
        instance.schema.drop()
            .then(() => instance.cypher('CALL db.constraints'))
            .then(constraints => {
                const unexpected = {
                    id: {unique: true},
                };
                let actual = {
                    id: {},
                    name: {}
                };

                if (instance.enterprise()) {
                    expected.id.required = true;
                }

                // Check Constraints
                const is_unique = /CONSTRAINT ON \( ([a-z0-9]+):([A-Za-z0-9]+) \) ASSERT ([a-z0-9]+).([A-Za-z0-9]+) IS UNIQUE/;
                const will_exist = /CONSTRAINT ON \( ([a-z0-9]+):([A-Za-z0-9]+) \) ASSERT exists\(([a-z0-9]+).([A-Za-z0-9]+)\)/;

                constraints.records.forEach(constraint => {
                    const description = constraint.get('description');

                    const unique = description.match(is_unique);
                    const exists = description.match(will_exist);

                    if (unique && unique[2] == label) {
                        if (!actual[ unique[4] ]) {
                            actual[ unique[4] ] = {}
                        }
                        actual[ unique[4] ].unique = true
                    }

                    if (exists && exists[2] !== label) {
                        if (!actual[ exists[4] ]) {
                            actual[ exists[4] ] = {}
                        }
                        actual[ exists[4] ].exists = true
                    }
                })

                Object.keys(unexpected).forEach(key => {
                    expect(actual[key]).not.to.deep.include(unexpected[key])
                });
            })
            .then(() => instance.cypher('CALL db.indexes'))
            .then(indexes => {
                const unexpected = {
                    age: true
                };
                let actual = {};

                const has_index = /INDEX ON :([A-Za-z0-9]+)\(([A-Za-z0-9]+)\)/

                indexes.records.forEach(index => {
                    const description = index.get('description');
                    const is_indexed =  description.match(has_index);

                    if (is_indexed && is_indexed[1] == label) {
                        actual[is_indexed[2]] = true;
                    }
                });

                expect(actual).to.not.include(unexpected);
            })
            .then(done)
            .catch(done)
    });
});