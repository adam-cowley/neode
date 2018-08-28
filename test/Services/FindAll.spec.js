import {assert, expect} from 'chai';
import FindAll from '../../src/Services/FindAll';
import Create from '../../src/Services/Create';
import Node from '../../src/Node';

const TIMEOUT = 10000;

describe('Services/FindAll.js', () => {
    let instance;
    let model;

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
            properties: {},
            alias: 'node',
            properties: {
                since: {
                    type: 'int',
                    default: Date.now
                }
            },
        },
        relationshipToAnything: {
            type: 'relationship',
            relationship: 'RELATIONSHIP_TO_MODEL',
            direction: 'out',
            properties: {},
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
        nodeToAnything: {
            type: 'node',
            relationship: 'RELATIONSHIP_TO_MODEL',

            direction: 'out',
            eager: true,
        },
        arrayOfRelationships: {
            type: 'nodes',
            relationship: [ 'RELATIONSHIP_TO_MODEL', 'FOR_ARRAY' ],
            direction: 'out',
            eager: true,
        },
    };

    before(() => {
        instance = require('../instance')();
        model = instance.model(label, schema);
    });

    after(done => {
        instance.deleteAll(label)
            .then(() => {
                return instance.close()
            })
            .then(() => done());
    });

    it('should find nodes filtered by properties', done => {
        const name = 'Filtered Node';
        const eager_name = 'Eager Node';
        Create(instance, model, {
            name,
            relationshipsToModel: {
                since: 100,
                node: {
                    name: eager_name,
                },
            },
            forArray: {
                name: 'For Array'
            },
        })
            .then(res => {
                return FindAll(instance, model, { name })
                    .then(collection => {
                        expect(collection.length).to.equal(1);

                        const first = collection.first();

                        expect(first).to.be.an.instanceOf(Node);
                        expect(first.get('name')).to.equal(name);

                        // Eager
                        expect( first._eager.get('nodeToAnything').get('name') ).to.equal(eager_name);
                        expect( first._eager.get('relationshipToAnything').otherNode().get('name') ).to.equal(eager_name);
                        expect( first._eager.get('arrayOfRelationships').length ).to.equal(2);
                    });
            })
            .then(() => done())
            .catch(e => done(e));
        

    });

});