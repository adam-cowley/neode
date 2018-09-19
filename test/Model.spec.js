import {assert, expect} from 'chai';
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
        },
        relationship: {
            type: 'relationship',
            relationship: 'RELATIONSHIP',
            target: 'ModelTest',
            eager: true,
            alias: 'nodeattheend',
            properties: {
<<<<<<< HEAD
                since: {
                    type: 'number',
                    required: true,
                },
                defaulted: {
                    type: 'string',
                    default: 'default',
                }
            }
        }
    };

    let Thing, created;

    const create_data = {
        id: uuid.v4(),
        name: 'Tester',
        age: 99,
        living: true
    };

    // after(function(done) {
    //     instance.deleteAll(label)
    //         .then(() => done())
    //         .catch(e => done(e));
    // });

    it('should register a new model definition', () => {
        Thing = instance.model(label, schema);

        expect(Thing).to.be.an.instanceOf(Model);
        expect(Thing.labels()).to.be.an('array');
    });

    it('should return model definition when no configuration is supplied', () => {
        const Thing = instance.model(label);

        expect(Thing).to.be.an.instanceOf(Model);
        expect(Thing.name()).to.equal(label);
    });

    it('should define a new relationship', () => {
        const rel = instance.model(label).relationship('known_by', 'KNOWN_BY', DIRECTION_IN, label, {
            since: {
                type: 'number',
                required: true,
=======
                updated: 'boolean',
                default: false,
>>>>>>> release/0.2.0
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
                return instance.close()
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

                expect( prop ).to.be.an.instanceof(Property)
                expect( prop.type() ).to.equal(name);
            })
            
            // Check properties have been set
            const uuid = model.properties().get('uuid');
            expect( uuid.primary() ).to.equal(true);

            expect( model.properties().get('string').indexed() ).to.equal(true);
            expect( model.properties().get('string').unique() ).to.equal(true);

            expect( model.properties().get('number').readonly() ).to.equal(true);
            expect( model.properties().get('number').hidden() ).to.equal(true);

            expect( model.hidden() ).to.deep.equal(['number']);

<<<<<<< HEAD
    it('should force create an outgoing relationship', (done) => {
        let relation;
        const properties = {
            since: 0
        };

        instance.model(label).create({
            id: uuid.v4(),
            name: 'Relation',
            age: 88,
            living: true
        })
        .then(res => {
            relation = res;

            return created.relateTo(relation, 'knows', properties, true);
        })
        .then(res => {
            expect(res).to.be.an.instanceOf(Relationship);
            expect(res.type().relationship()).to.equal('KNOWS');
            expect(res.type().type()).to.equal('knows');
            expect(res.from()).to.equal(created);
            expect(res.to()).to.equal(relation);
            expect(res.properties()).to.be.an('object');
            expect(res.get('since')).to.equal(properties.since);
            expect(res.get('defaulted')).to.equal(schema.knows.properties.defaulted.default);

            done();
        })
        .catch(e => done(e));
    });

    it('should create an incoming relationship and invert from and to properties', (done) => {
        let relation;
        const properties = {
            since: 2017
        };
=======
            expect( model.indexes() ).to.deep.equal(['string']);
>>>>>>> release/0.2.0

            // Check Relationships
            expect( model.relationships().size ).to.equal( 4 )

            const rels = [ 'relationship', 'relationships', 'node', 'nodes' ];

            rels.forEach(rel => {
                expect( model.relationships().get(rel) ).to.be.an.instanceof(RelationshipType)
            })

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
                    return node.update({ string: 'new' })
                })
                .then(node => {
                    expect( node.get('string') ).to.equal('new');
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
                return first.relateTo(second, 'relationship')
            })
            .then(relationship => {
                return relationship.update({ updated: true })
                    .then(res => {
                        expect( res.get('updated') ).to.be.true

                        return instance.cypher('MATCH ()-[r]->() WHERE id(r) = {id} RETURN r.updated AS updated', { id: res.identity() })
                            .then(( {records} ) => {
                                expect( records[0].get('updated') ).to.be.true
                                
                                return res;
                            });
                    });
            })
            .then(relationship => {
                return relationship.delete();
            })
            .then(res => {
                return instance.cypher('MATCH ()-[r]->() WHERE id(r) = {id} RETURN r', { id: res.identity() })
                    .then(res => {
                        expect( res.records.length ).to.equal(0);
                    });
            })
            .then(() => done())
            .catch(e => done(e));
        });


    });

<<<<<<< HEAD
    it('should cascade delete a node', (done) => {
        Promise.all([
            Thing.create({id: uuid.v4(), 'name': "Parent"}),
            Thing.create({id: uuid.v4(), 'name': "Child"}),
        ])
        .then(res => {
            const [parent, child] = res;
            return parent.relateTo(child, 'knows', {since: 2017})
                .then(() => {
                    return res;
                });
        })
        .then(res => {
            const [parent, child] = res;
            return parent.delete()
                .then(() => {
                    return res;
                });
        })
        .then(res => {
            const [ parent, child ] = res;

            return instance.cypher('MATCH (n) WHERE id(n) IN [{parent}, {child}] RETURN count(n) AS count', {parent:parent.idInt(), child:child.idInt()})
                .then(res => {
                    expect(res.records.length).to.equal(1);
                    expect(res.records[0].get('count').toNumber()).to.equal(0);

                })

        })
        .then(done)
        .catch(e => done(e))
    });
=======
>>>>>>> release/0.2.0
});