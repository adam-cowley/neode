import {assert, expect} from 'chai';
import {Model, Node, Errors} from '../src/index';
import RelationshipType, {DIRECTION_IN} from '../src/RelationshipType';
import Relationship from '../src/Relationship';
import uuid from 'uuid';

describe('Model.js', () => {
    const instance = require('./instance');
    const label = 'ModelTest';
    const schema = {
        labels: ['Test', 'ModelTest'],

        id: {
            type: 'uuid',
            primary: true,
        },
        name: {
            type: 'string',
            required: true,
            alphanumberic: true,
            min: 3,
            max: 20,
            index: true,
        },
        random: {
            type: 'float',
            required: true,
            default: function() {
                return Math.random();
            },
            unique: true,
            protected: true,
            hidden: true,
        },
        defaulted: {
            type: 'string',
            default: 'Default',
        },
        age: 'int',
        living: 'boolean',

        knows: {
            type: 'relationship',
            relationship: 'KNOWS',
            direction: 'OUT',
            target: label,
            properties: {
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

    after(function(done) {
        instance.deleteAll(label)
            .then(() => done())
            .catch(e => done(e));
    });

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
            },
            defaulted: {
                type: 'string',
                default: 'default'
            }
        });

        expect(rel).to.be.an.instanceOf(RelationshipType);
    });

    it('should return a relationship if no extra parameters are passed', () => {
        const rel = instance.model(label).relationship('known_by');

        expect(rel).to.be.an.instanceOf(RelationshipType);
    });

    it('should create a new node with default values', (done) => {
        Thing.create(create_data)
            .then(res => {
                created = res;

                expect(res).to.be.an.instanceOf(Node);
                expect(res.get('name')).to.equal(create_data.name);
                expect(res.get('id')).to.equal(create_data.id);
                expect(res.get('age')).to.equal(create_data.age);
                expect(res.get('living')).to.equal(create_data.living);
                expect(res.get('random')).to.be.a('number');

                expect(res.get('defaulted')).to.equal(schema.defaulted.default);
            })
            .then(() => done())
            .catch(e => done(e));
    });

    it('should throw exception when validation fails', (done) => {
        const data = {
            name: null
        };

        Thing.create(data)
            .then(res => {
                expect(false).to.equal(true, 'This should throw an exception');
            })
            .catch(e => {
                expect(e).to.be.instanceOf(Error);
                expect(e.details).to.be.an('Object');

                expect(e.details.name).to.be.an('array');
            })
            .then(done)
            .catch(done);
    });

    it('should create an outgoing relationship', (done) => {
        let relation;
        const properties = {
            since: 2017
        };

        instance.model(label).create({
            id: uuid.v4(),
            name: 'Relation',
            age: 88,
            living: true
        })
        .then(res => {
            relation = res;

            return created.relateTo(relation, 'knows', properties);
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

        instance.model(label).create({
            id: uuid.v4(),
            name: 'Incoming',
            age: 100,
            living: true
        })
        .then(res => {
            relation = res;

            return created.relateTo(relation, 'known_by', properties);
        })
        .then(res => {
            expect(res).to.be.an.instanceOf(Relationship);
            expect(res.type().relationship()).to.equal('KNOWN_BY');
            expect(res.type().type()).to.equal('known_by');
            expect(res.to()).to.equal(created);
            expect(res.from()).to.equal(relation);

            done();
        })
        .catch(e => done(e));
    });

    it('should merge a model on its indexes', (done) => {
        const {id, name, random} = created.properties();

        const merge_data = Object.assign({}, {id, name, random}, {
            living: false
        });

        Thing.merge(merge_data)
            .then(res => {
                expect(res).to.be.an.instanceOf(Node);

                // ID's should match up
                expect(res.id()).to.equal(created.id());

                // Shouldn't overwrite protected fields
                expect(res.get('id')).to.equal(created.get('id'));

                // TODO: Should set new values
                // Returning false, yet property is successfully set
                // expect(res.get('living')).to.equal(merge_data.living);

            })
            .then(() => done())
            .catch(e => done(e));
    });

    it('should merge on specific properties', (done) => {
        const match = {
            id: created.get('id')
        };
        const set = Object.assign({name: 'Specific Merge', living: true});
        Thing.mergeOn(match, set)
            .then(res => {
                expect(res).to.be.an.instanceOf(Node);

                // ID's should match up
                expect(res.id()).to.equal(created.id());

                // Shouldn't overwrite protected fields
                expect(res.get('id')).to.equal(created.get('id'));

                // Should set new values
                expect(res.get('living')).to.equal(true);
            })
            .then(() => done())
            .catch(e => done(e));
    });

    it('should update a node', (done) => {
        const data = {
            name: 'Updated Tester'
        };

        created.update(data)
            .then(res => {
                expect(res).to.be.an.instanceOf(Node);
                expect(res.id()).to.equal(created.id());
                expect(res.get('name')).to.equal(data.name);
            })
            .then(done)
            .catch(e => done(e));
    });

    it('should convert to string and return the primary key', () => {
        const str = created.toString();

        expect(str).to.be.a('string');
        expect(str).to.equal(created.get('id'));
    });

    it('should convert to JSON object and hide hidden properties', (done) => {
        const expected = ['_id', 'id', 'name', 'living', 'defaulted', 'age'];
        const hidden = ['random'];

        created.toJson()
            .then(json => {
                expected.forEach(key => {
                    expect(json).to.have.property(key);
                });

                hidden.forEach(key => {
                    expect(json).to.not.have.property(key);
                });
            })
            .then(() => done())
            .catch(e => done(e));
    });

    it('should delete a node', (done) => {
        const id = created.idInt();

        created.delete()
            .then(() => {
                return instance.cypher('MATCH (n) WHERE id(n) = {id} RETURN n', {id});
            })
            .then(res => {
                expect(res.records.length).to.equal(0);
            })
            .then(done)
            .catch(e => done(e));
    });
});