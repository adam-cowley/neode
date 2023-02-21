/* eslint-disable no-undef */
import { expect, } from 'chai';
import Model from '../src/Model';
import RelationshipType from '../src/RelationshipType';
import Property from '../src/Property';

describe('Model.js', () => {
    let instance;
    let model;
    const name = 'ModelTest';
    const schema = {
        labels: ['Test', 'Labels'],
        uuid: {
            type: 'uuid',
            primary: true,
        },
        boolean: 'boolean',
        int: 'int',
        integer: 'integer',
        number: {
            type: 'number',
            hidden: true,
            readonly: true,
        },
        string: {
            type: 'string',
            index: true,
            unique: true,
            required: true,
            hidden: ['toHide']
        },
        relationship: {
            type: 'relationship',
            relationship: 'RELATIONSHIP',
            target: 'ModelTest',
            eager: true,
            alias: 'nodeattheend',
            properties: {
                updated: 'boolean',
                default: false,
            },
        },
        relationships: {
            type: 'relationships',
            relationship: 'RELATIONSHIPS',
            target: 'ModelTest',
            eager: false,
        },
        node: {
            type: 'node',
            relationship: 'NODE',
            target: 'ModelTest',
            eager: true,
        },
        nodes: {
            type: 'nodes',
            relationship: 'NODES',
            target: 'ModelTest',
            eager: false,
        },
    };

    before(() => {
        instance = require('./instance')();
        model = instance.model(name, schema);
    });

    after(done => {
        instance.deleteAll(name)
            .then(() => {
                return instance.close();
            })
            .then(() => done())
            .catch(e => done(e));
    });

    describe('::constructor', () => {
        it('should construct', () => {
            expect( model.name() ).to.equal(name);
            expect( model.labels() ).to.deep.equal(schema.labels.sort());

            expect( model.primaryKey() ).to.deep.equal('uuid');

            // Check Properties
            const props = ['uuid', 'boolean', 'number', 'string', 'int', 'integer'];
            expect( model.properties().size ).to.equal( props.length );

            props.forEach(name => {
                const prop = model.properties().get(name);

                expect( prop ).to.be.an.instanceof(Property);
                expect( prop.type() ).to.equal(name);
            });

            // Check properties have been set
            const uuid = model.properties().get('uuid');
            expect( uuid.primary() ).to.equal(true);

            expect( model.properties().get('string').indexed() ).to.equal(true);
            expect( model.properties().get('string').unique() ).to.equal(true);
            expect( model.properties().get('string').hidden('toHide') ).to.equal(true);
            expect( model.properties().get('string').hidden('anyOtherGroup') ).to.equal(false);
            
            expect( model.properties().get('number').readonly() ).to.equal(true);
            expect( model.properties().get('number').hidden() ).to.equal(true);

            expect( model.hidden() ).to.deep.equal(['number']);

            expect( model.indexes() ).to.deep.equal(['string']);

            // Check Relationships
            expect( model.relationships().size ).to.equal( 4 );

            const rels = [ 'relationship', 'relationships', 'node', 'nodes' ];

            rels.forEach(rel => {
                expect( model.relationships().get(rel) ).to.be.an.instanceof(RelationshipType);
            });

        });

        it('should guess labels and primary key', () => {
            const model = new Model(instance, name, {});

            expect( model.name() ).to.equal(name);
            expect( model.labels() ).to.deep.equal(['ModelTest']);

            expect( model.primaryKey() ).to.deep.equal('modeltest_id');
        });
    });

    describe('::update', () => {
        it('should update a nodes properties', done => {
            instance.create(name, { string: 'old' })
                .then(node => {
                    return node.update({ string: 'new' });
                })
                .then(node => {
                    expect( node.get('string') ).to.equal('new');
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should not throw an error if required properties are not included', done => {
            instance.create(name, { string: 'old', number: 3 })
                .then(node => {
                    return node.update({ number: 4 });
                })
                .then(node => {
                    expect( node.get('string') ).to.equal('old');
                    expect( node.get('number') ).to.equal(4);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('Relationships', () => {
        it('should create, update and delete a relationship', done => {
            Promise.all([
                instance.create(name, { string: 'first' }),
                instance.create(name, { string: 'second' }),
            ])
                .then(([ first, second]) => {
                    return first.relateTo(second, 'relationship');
                })
                .then(relationship => {
                    return relationship.update({ updated: true })
                        .then(res => {
                            expect( res.get('updated') ).to.be.true;

                            return instance.cypher('MATCH ()-[r]->() WHERE id(r) = $id RETURN r.updated AS updated', { id: res.identity() })
                                .then(( {records} ) => {
                                    expect( records[0].get('updated') ).to.be.true;

                                    return res;
                                });
                        });
                })
                .then(relationship => {
                    return relationship.delete();
                })
                .then(res => {
                    return instance.cypher('MATCH ()-[r]->() WHERE id(r) = $id RETURN r', { id: res.identity() })
                        .then(res => {
                            expect( res.records.length ).to.equal(0);
                        });
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

});
