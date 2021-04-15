import {assert, expect} from 'chai';
import Schema from '../src/Schema';

describe('Schema.js', () => {
    const label = 'SchemaThing';
    let instance;

    before(() => {
        instance = require('./instance')();

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
    });

    after(() => {
        instance.close();
    });

    it('should construct', () => {
        assert.instanceOf(instance.schema, Schema);
        assert.isFunction(instance.schema.install);
        assert.isFunction(instance.schema.drop);
    });

    it('should install the schema', (done) => {
        // TODO: Tests for Enterprise Mode
        instance.schema.install()
            .then(() => instance.cypher('CALL db.awaitIndexes'))
            .then(() => instance.cypher('CALL db.constraints'))
            .then(constraints => {
                let id_unique = false;
                let id_exists = false;
                let name_exists = false;

                // Check Constraints
                const is_unique = /CONSTRAINT ON \( ([a-z0-9]+):([A-Za-z0-9]+) \) ASSERT ([a-z0-9]+).([A-Za-z0-9]+) IS UNIQUE/;
                const will_exist = /CONSTRAINT ON \( ([a-z0-9]+):([A-Za-z0-9]+) \) ASSERT exists\(([a-z0-9]+).([A-Za-z0-9]+)\)/;

                constraints.records.forEach(constraint => {
                    const description = constraint.get('description');

                    const unique = description.match(is_unique);
                    const exists = description.match(will_exist);

                    if (unique && unique[2] == label) {
                        if ( unique[4] == 'id' ) {
                            id_unique = true;
                        }
                    }

                    if (exists && exists[2] == label) {
                        if ( exists[4] == 'id' ) {
                            id_exists = true;
                        }
                        else if ( exists[4] == 'name' ) {
                            name_exists = true;
                        }
                    }
                })

                // Assertions
                // expect(id_unique).to.equal(true);

                // Enterprise?
                if (instance.enterprise()) {
                    expect(id_exists).to.equal(true);
                    expect(name_exists).to.equal(true);
                }
            })
            .then(() => instance.cypher('CALL db.indexes'))
            .then(indexes => {
                const expected = {
                    'SchemaThing.age': true
                };
                let actual = {};

                indexes.records.forEach(index => {
                    actual[ index.get('labelsOrTypes')[0] + '.'+ index.get('properties')[0] ] = true;
                });

                expect(actual).to.include(expected);
            })
            .then(() => done())
            .catch(e => {
                done(e);
            })
    });

    it('should drop the schema', (done) => {
        instance.schema.drop()
            .then(() => instance.cypher('CALL db.constraints'))
            .then(constraints => {
                let id_unique = false;
                let id_exists = false;
                let name_exists = false;

                // Check Constraints
                const is_unique = /CONSTRAINT ON \( ([a-z0-9]+):([A-Za-z0-9]+) \) ASSERT ([a-z0-9]+).([A-Za-z0-9]+) IS UNIQUE/;
                const will_exist = /CONSTRAINT ON \( ([a-z0-9]+):([A-Za-z0-9]+) \) ASSERT exists\(([a-z0-9]+).([A-Za-z0-9]+)\)/;

                constraints.records.forEach(constraint => {
                    const description = constraint.get('description');

                    const unique = description.match(is_unique);
                    const exists = description.match(will_exist);

                    if (unique && unique[2] == label) {
                        if ( unique[4] == 'id' ) {
                            id_unique = true;
                        }
                    }

                    if (exists && exists[2] == label) {
                        if ( exists[4] == 'id' ) {
                            id_exists = true;
                        }
                        else if ( exists[4] == 'name' ) {
                            name_exists = true;
                        }
                    }
                })

                // Assertions
                expect(id_unique).to.equal(false);
                expect(id_exists).to.equal(false);

                // Enterprise?
                if (instance.enterprise()) {
                    expect(name_exists).to.equal(false);
                }
            })
            .then(() => instance.cypher('CALL db.indexes'))
            // TODO: Reinstate
            // .then(indexes => {
            //     const unexpected = {
            //         age: true
            //     };
            //     let actual = {};

            //     const has_index = /INDEX ON :([A-Za-z0-9]+)\(([A-Za-z0-9]+)\)/

            //     indexes.records.forEach(index => {
            //         const description = index.get('description');
            //         const is_indexed =  description.match(has_index);

            //         if (is_indexed && is_indexed[1] == label) {
            //             actual[is_indexed[2]] = true;
            //         }
            //     });

            //     expect(actual).to.not.include(unexpected);
            // })
            .then(() => done())
            .catch(e => done(e))
    });

});