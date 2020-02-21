import {assert, expect} from 'chai';
import Collection from '../src/Collection';
import Factory from '../src/Factory';
import Model from '../src/Model';
import Node from '../src/Node';
import Relationship from '../src/Relationship';
import { EAGER_ID, EAGER_LABELS, EAGER_TYPE, eagerNode, } from '../src/Query/EagerUtils';
import neo4j from 'neo4j-driver';
import RelationshipType from '../src/RelationshipType';

describe('Factory.js', () => {
    let instance;
    let factory;
    let model;
    let alt_model;

    before(done => {
        instance = require('./instance')();
        factory = new Factory(instance);

        model = instance.model('FactoryTest', {
            id: 'number'
        });

        alt_model = instance.model('AnotherFactoryTest', {
            id: 'number',
            relationship: {
                type: 'relationship',
                relationship: 'RELATIONSHIP',
                target: 'AnotherFactoryTest',
                direction: 'out',

                eager: true,

                properties: {
                    prop: 'float',
                },
            },
            relationships: {
                type: 'relationships',
                relationship: 'RELATIONSHIPS',
                target: 'AnotherFactoryTest',
                alias: 'alias',
                direction: 'in',

                eager: true,
            },
            node: {
                type: 'node',
                relationship: 'NODE',
                target: 'AnotherFactoryTest',
                direction: 'out',

                eager: true,
            },
            nodes: {
                type: 'nodes',
                relationship: 'NODES',
                target: 'AnotherFactoryTest',
                direction: 'in',

                eager: true,
            },
        });

        Promise.all([
            instance.create('FactoryTest', { id: 1 }),
            instance.create('FactoryTest', { id: 2 })
        ])
            .then(() => done())
            .catch(e => done(e));
    });

    after(done => {
        instance.deleteAll('FactoryTest')
            .then(() => instance.close())
            .then(() => done())
            .catch(e => done(e));
    });

    describe('::getDefinition', () => {
        it('should get a model definition based on an array of labels', () => {
            const output = factory.getDefinition(['FactoryTest']);

            expect(output).to.be.an.instanceOf(Model);
        });

        it('should return false when definition not found', () => {
            const output = factory.getDefinition(['Unknown']);

            expect(output).to.equal(false);
        });
    });

    describe('::hydrateFirst', () => {
        it('should return false on invalid result', () => {
            expect( factory.hydrateFirst(false) ).to.equal(false);
        });

        it('should return false on empty result', () => {
            expect( factory.hydrateFirst({ records: [] }) ).to.equal(false);
        });

        it('should hydrate alias from first result', done => {
            instance.cypher(`
                MATCH (n:FactoryTest)
                RETURN n {
                    .*,
                    ${EAGER_ID}: id(n),
                    ${EAGER_LABELS}: labels(n)
                } ORDER BY n.id ASC LIMIT 1
            `)
                .then(res => {
                    return factory.hydrateFirst(res, 'n');
                })
                .then(res => {
                    expect( res ).to.be.an.instanceOf( Node );
                    expect( res._model ).to.equal( model );

                    expect( res.get('id') ).to.equal(1);

                })
                .then(() => done())
                .catch(e => done(e))
        });

        it('should hydrate alias from first result with specific model definition', done => {
            instance.cypher(`
                MATCH (n:FactoryTest)
                RETURN n {
                    .*,
                    ${EAGER_ID}: id(n),
                    ${EAGER_LABELS}: labels(n)
                } ORDER BY n.id ASC LIMIT 1
            `)
                .then(res => {
                    return factory.hydrateFirst(res, 'n', alt_model);
                })
                .then(res => {
                    expect( res ).to.be.an.instanceOf( Node );
                    expect( res._model ).to.equal( alt_model );

                    expect( res.get('id') ).to.equal(1);

                })
                .then(() => done())
                .catch(e => done(e))
        });

    });

    describe('::hydrate', () => {
        it('should return false on invalid result', () => {
            expect( factory.hydrate(false) ).to.equal(false);
        });

        it('should return an empty node collection', () => {
            const output = factory.hydrate({ records: [] });

            expect( output ).to.be.an.instanceOf(Collection);
            expect( output.length ).to.equal(0);
        });

        it('should hydrate alias', done => {
            instance.cypher(`
                MATCH (n:FactoryTest)
                RETURN n {
                    .*,
                    ${EAGER_ID}: id(n),
                    ${EAGER_LABELS}: labels(n)
                } ORDER BY n.id ASC
            `)
                .then(res => {
                    return factory.hydrate(res, 'n');
                })
                .then(res => {
                    expect( res ).to.be.an.instanceOf(Collection);
                    expect( res.length ).to.equal(2);

                    expect( res.get(0).get('id') ).to.equal(1);
                    expect( res.get(1).get('id') ).to.equal(2);

                    expect( res.get(0) ).to.be.an.instanceOf( Node );

                })
                .then(() => done())
                .catch(e => done(e))
        });

        it('should hydrate alias from first result with specific model definition', done => {
            instance.cypher(`
                MATCH (n:FactoryTest)
                RETURN n {
                    .*,
                    ${EAGER_ID}: id(n),
                    ${EAGER_LABELS}: labels(n)
                } ORDER BY n.id ASC
            `)
                .then(res => {
                    return factory.hydrate(res, 'n', alt_model);
                })
                .then(res => {
                    expect( res ).to.be.an.instanceOf(Collection);
                    expect( res.length ).to.equal(2);

                    expect( res.get(0).get('id') ).to.equal(1);
                    expect( res.get(0)._model ).to.equal(alt_model);
                    expect( res.get(1).get('id') ).to.equal(2);
                    expect( res.get(1)._model ).to.equal(alt_model);

                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should hydrate a node and eager relationships', done => {
            instance.cypher(`
                CREATE (t:AnotherFactoryTest { id: 3 })
                CREATE (t)-[:RELATIONSHIP { prop: 1.234 }]->(:AnotherFactoryTest {id: 4})
                CREATE (t)<-[:RELATIONSHIPS]-(:AnotherFactoryTest {id: 5})
                CREATE (t)-[:NODE]->(:AnotherFactoryTest {id: 6})
                CREATE (t)<-[:NODES]-(:AnotherFactoryTest {id: 7})

                RETURN ${eagerNode(instance, 3, 't', alt_model)}
            `)
                .then(res => {
                    return factory.hydrate(res, 't')
                })
                .then(res => {
                    expect( res.length ).to.equal(1)

                    const node = res.get(0);

                    // Correctly hydrated node?
                    expect( node ).to.be.an.instanceOf(Node);
                    expect( node.get('id').toNumber() ).to.equal(3);

                    // Outgoing Relationship
                    const relationship = node.get('relationship');
                    expect( relationship ).to.be.an.instanceOf(Relationship);

                    expect( relationship.type() ).to.equal('RELATIONSHIP');
                    expect( relationship.definition() ).to.be.an.instanceOf(RelationshipType);

                    expect( relationship.startNode().get('id').toNumber() ).to.equal(3);
                    expect( relationship.endNode().get('id').toNumber() ).to.equal(4);
                    expect( relationship.otherNode().get('id').toNumber() ).to.equal(4);

                    expect( relationship.get('prop') ).to.equal(1.234);

                    // Incoming Relationships
                    expect( node.get('relationships') ).to.be.an.instanceOf(Collection);

                    expect( node.get('relationships').first().startNode().get('id').toNumber() ).to.equal(5);
                    expect( node.get('relationships').first().endNode().get('id').toNumber() ).to.equal(3);
                    expect( node.get('relationships').first().otherNode().get('id').toNumber() ).to.equal(5);

                    // Outgoing Node
                    expect( node.get('node') ).to.be.an.instanceOf(Node);
                    expect( node.get('node').get('id').toNumber() ).to.equal(6);

                    // Incoming Nodes
                    expect( node.get('nodes') ).to.be.an.instanceOf(Collection);
                    expect( node.get('nodes').first().get('id').toNumber() ).to.equal(7);

                    return relationship.toJson();
                })
                .then(json => {
                    expect(json).to.deep.include({
                        _type: 'RELATIONSHIP',
                        prop: 1.234,
                    });

                    expect(json.node).to.deep.include({
                        id: 4,
                    });
                })
                .then(() => {
                    return instance.cypher(`MATCH (n:AnotherFactoryTest) WHERE n.id IN [3, 4, 5, 6, 7] DETACH DELETE n`);
                })
                .then(() => done())
                .catch(e => done(e))

        });

        it('should convert and hydrate a native node', done => {
            instance.cypher(`CREATE (t:AnotherFactoryTest { id: 8 }) RETURN t`)
                .then(res => {
                    return factory.hydrate(res, 't')
                })
                .then(output => {
                    expect( output ).to.be.an.instanceOf(Collection);
                    expect( output.length ).to.equal(1);

                    const first = output.first();

                    expect( first ).to.be.an.instanceOf(Node);
                    expect( first.model() ).be.an.instanceOf(Model);
                    expect( first.model().name() ).to.equal('AnotherFactoryTest');
                    expect( first.get('id').toNumber() ).to.equal(8);

                    return first.delete();
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });
});