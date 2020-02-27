import {assert, expect} from 'chai';
import FindAll from '../../src/Services/FindAll';
import Create from '../../src/Services/Create';
import Node from '../../src/Node';

const TIMEOUT = 10000;

describe('Services/FindAll.js', () => {
    let instance;
    let model;

    const other_label = 'FindAllEager';
    const label = 'FindAllTest';
    const schema = {
        uuid: {
            type: 'uuid',
            primary: true,
        },
        name: {
            type: 'string',
            required: true,
        },
        relationshipsToModel: {
            type: 'relationship',
            relationship: 'RELATIONSHIP_TO_MODEL',
            target: label,
            direction: 'out',
            alias: 'node',
            properties: {
                since: {
                    type: 'int',
                    default: Date.now
                }
            },
        },
        relationshipToOther: {
            type: 'relationship',
            relationship: 'RELATIONSHIP_TO_OTHER',
            target: other_label,
            direction: 'out',
            eager: true,
            alias: 'node',
            properties: {
                since: {
                    type: 'int',
                    default: Date.now
                }
            },
        },
        forArray: {
            type: 'node',
            relationship: 'FOR_ARRAY',
            target: label,
            direction: 'out',
        },
        nodeToOther: {
            type: 'node',
            relationship: 'RELATIONSHIP_TO_OTHER',
            target: other_label,
            direction: 'out',
            eager: true,
        },
        arrayOfRelationships: {
            type: 'nodes',
            relationship: [ 'RELATIONSHIP_TO_MODEL', 'FOR_ARRAY' ],
            // target: other_label,
            direction: 'out',
            eager: true,
        },
    };

    before(() => {
        instance = require('../instance')();
        instance.model(other_label, {id: 'number'});
        model = instance.model(label, schema);
    });

    afterEach(done => {
        instance.deleteAll(label)
            // .then(() => {
            //     return instance.close()
            // })
            .then(() => done());
    });

    after(() => instance.close());

    it('should find nodes filtered by properties', done => {
        const name = 'Filtered Node';
        const eager_name = 'Eager Node';
        const other_id = 1;
        Create(instance, model, {
            name,
            relationshipsToModel: {
                since: 100,
                node: {
                    name: eager_name,
                },
            },
            nodeToOther: {
                id: other_id,
            },
            forArray: {
                name: 'For Array'
            },
        })
            .then(() => {
                return FindAll(instance, model, { name })
                    .then(collection => {
                        expect(collection.length).to.equal(1);

                        const first = collection.first();

                        expect(first).to.be.an.instanceOf(Node);
                        expect(first.get('name')).to.equal(name);

                        // Eager
                        expect( first._eager.get('nodeToOther').get('id') ).to.equal(other_id);
                        expect( first._eager.get('relationshipToOther').otherNode().get('id') ).to.equal(other_id);
                        expect( first._eager.get('arrayOfRelationships').length ).to.equal(2);
                    });
            })
            .then(() => done())
            .catch(e => {
                console.log(e)
                done(e)
            });
    });

    it('should apply the alias to an order', done => {
        // TODO: Reinstate
        // Promise.all([
        //     instance.create(label, { name: '100' }),
        //     instance.create(label, { name: '300' }),
        //     instance.create(label, { name: '150' }),
        // ])
        // .then(() => {
        //     return FindAll(instance, model, {}, 'name')
        //         .then(res => {
        //             const actual = res.map(r => r.get('name'));
        //             const expected = [ '100', '150', '300' ];

        //             expect( actual ).to.deep.equal( expected );
        //         })
        //         .then(() => done())
        //         .catch(e => done(e));
        // });
        done()
    });

    it('should apply the alias to a map of orders', done => {
        // TODO: Reinstate
        // Promise.all([
        //     instance.create(label, { name: '100' }),
        //     instance.create(label, { name: '300' }),
        //     instance.create(label, { name: '150' }),
        // ])
        // .then(() => {
        //     return FindAll(instance, model, {}, { name: 'DESC' })
        //         .then(res => {
        //             const actual = res.map(r => r.get('name'));
        //             const expected = [ '300', '150', '100' ];

        //             expect( actual ).to.deep.equal( expected );
        //         });
        // })
        // .then(() => done())
        // .catch(e => done(e));
        done()
    });

});