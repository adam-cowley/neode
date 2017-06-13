import {assert, expect} from 'chai';
import Neode, {Model, Node, Errors} from '../src/index';
import uuid from 'uuid';

describe('Model.js', () => {
    const connection_string = 'bolt://localhost';
    const username = 'neo4j';
    const password = 'neo'

    const instance = new Neode(connection_string, username, password);
    const schema = {
        id: 'uuid',
        name: {
            type: 'string',
            required: true,
            alphanumberic: true,
            min: 3,
            max: 10
        },
        random: {
            type: 'float',
            required: true,
            default: function() {
                return Math.random();
            },
        },
        defaulted: {
            type: 'string',
            default: 'Default',
        },
        age: 'int',
        living: 'boolean'
    };

    let Thing, created;

    after(function(done) {
        instance.cypher('MATCH (t:Thing) DELETE t')
            .then(done())
            .catch(e => done(e));
    });

    it('should register a new model definition', () => {
        Thing = instance.model('Thing', schema);

        expect(Thing).to.be.an.instanceOf(Model);
    });

    it('should return model definition when no configuration is supplied', () => {
        const Thing = instance.model('Thing');

        expect(Thing).to.be.an.instanceOf(Model);
        expect(Thing.name()).to.equal('Thing');
    });

    it('should create a new node with default values', (done) => {
        const data = {
            id: uuid.v4(),
            name: 'Tester',
            age: 99,
            living: true
        };

        Thing.create(data)
            .then(res => {
                created = res;

                expect(res).to.be.an.instanceOf(Node);
                expect(res.get('name')).to.equal(data.name);
                expect(res.get('id')).to.equal(data.id);
                expect(res.get('age')).to.equal(data.age);
                expect(res.get('living')).to.equal(data.living);
                expect(res.get('random')).to.be.a('number');

                expect(res.get('defaulted')).to.equal(schema.defaulted.default);
            })
            .then(done)
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