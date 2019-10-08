/* eslint-disable no-undef */
import {expect} from 'chai';

const TIMEOUT = 10000;

describe('Services/DeleteNode.js', () => {
    let instance;

    const label = 'DeleteTest';
    const schema = {
        uuid: {
            type: 'uuid',
            primary: true,
        },
        name: {
            type: 'string',
            required: true,
        },
        toDelete: {
            type: 'node',
            relationship: 'DELETE_ME',
            target: label,
            direction: 'out',
            eager: true,
            cascade: 'delete',
        },
        toDetach: {
            type: 'node',
            relationship: 'DETACH_ME',
            target: label,
            direction: 'out',
            eager: true,
            // cascade: 'detach',
        }
    };

    before(done => {
        instance = require('../instance')();

        instance.model(label, schema);

        instance.deleteAll(label).then(() => done());
    });

    after(done => {
        instance.deleteAll(label)
            .then(() => {
                return instance.close();
            })
            .then(() => done());
    });

    describe('::DeleteNode', () => {
        it('should cascade delete a node to specified depth', done => {
            instance.create(label, {
                name: 'level1',
                toDelete: {
                    name: 'level 2',
                    toDelete: {
                        name: 'level 3',
                        toDelete: {
                            name: 'level 4',
                        }
                    }
                },
                toDetach: {
                    name: 'Detach'
                }
            })
                .then(res => res.delete(2))
                .then(() => {
                    return instance.cypher(`MATCH (n:${label}) RETURN n.name AS name ORDER BY name ASC`)
                        .then(( {records} ) => {
                            expect( records.length ).to.equal(2);

                            const actual = records.map(r => r.get('name'));
                            const expected = [ 'Detach', 'level 4' ];

                            expect( actual ).to.deep.equal( expected );
                        });
                })
                .then(() => done())
                .catch(e => done(e));
        }).timeout(TIMEOUT);
    });

});
