import {assert, expect} from 'chai';
import Neode from '../src/index';
import Model from '../src/Model';
import Node from '../src/Node';
import NodeCollection from '../src/NodeCollection';
import Builder from '../src/Query/Builder';
import neo4j from 'neo4j-driver';
import {Driver} from 'neo4j-driver/lib/v1/driver';

describe('index.js', () => {
    const instance = require('./instance');
    const label = 'IndexTest';
    const schema = {
        name: {type: 'string', primary: true},
        setme: 'string',
        relate_test: {
            type: 'relationship',
            relationship: 'RELATE_TEST',
            direction: 'OUT'
        }
    };

    it('should instantiate', () => {
        expect(instance).to.be.an.instanceOf(Neode);
        expect(instance.driver).to.be.an.instanceOf(Driver);
    });

    it('should instantiate with enterprise mode', () => {
        const enterprise = new Neode('bolt://localhost:3000', 'username', 'password', true);

        expect(enterprise).to.be.an.instanceOf(Neode);
        expect(enterprise.enterprise()).to.equal(true);
    });

    it('should load models using `with` and return self', () => {
        const output = instance.with({
            WithTest: {
                name: 'string'
            }
        });

        expect(output).to.equal(instance);
        expect(output.model('WithTest')).to.be.an.instanceOf(Model);
    })

    it('should run cypher query', (done) => {
        instance.cypher('MATCH (n) RETURN count(n)')
            .then(res => {
                expect(res.records).to.be.an('array');
                expect(res.records.length).to.equal(1);

                done();
            })
            .catch(err => {
                done(err);
            });
    });

    it('should handle error in syntax query', (done) => {
        instance.cypher('MATCH (n) RETURN coutn(n)')
            .catch(err => {
                done();
            });
    });

    describe('::batch', () => {
        it('should handle a batch of queries', (done) => {
            const queries = [
                'MATCH (n) RETURN count(n)',
                {query: 'MATCH (n) WHERE n.name = {name} RETURN n', params: {name: 'name'}}
            ];

            instance.batch(queries)
                .then(res => {
                    assert.isArray(res)
                    expect(res.length).to.equal(2)
                })
                .then(done)
                .catch(done)
        });

        it('should register a new model', () => {
            const model = instance.model(label, schema);

            expect(model).to.be.an.instanceOf(Model);
            expect(model.name()).to.equal(label);
        });
    });

    describe('::create', () => {
        it('should create a new model', (done) => {
            const create_data = {name: 'Test'};
            instance.create(label, create_data)
                .then(res => {
                    expect(res).to.be.an.instanceOf(Node);
                    expect(res.get('name')).to.equal(create_data.name);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::merge', () => {
        it('should merge a model', (done) => {
            const create_data = {name: 'Test'};
            instance.merge(label, create_data)
                .then(res => {
                    expect(res).to.be.an.instanceOf(Node);
                    expect(res.get('name')).to.equal(create_data.name);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::mergeOn', () => {
        it('should merge a model on specific properties', (done) => {
            const match = {name: 'Test'};
            const set = {setme: 'set'};
            instance.mergeOn(label, match, set)
                .then(res => {
                    expect(res).to.be.an.instanceOf(Node);
                    expect(res.get('name')).to.equal(match.name);
                    expect(res.get('setme')).to.equal(set.setme);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::delete', () => {
        it('should delete a node', (done) => {
            const create_data = {name: 'DeleteTest'};
            instance.create(label, create_data)
                .then(node => instance.delete(node))
                .then(() => done())
                .catch(e => done(e));
        })
    });

    describe('::relateTo', () => {
        it('should relate two nodes', (done) => {
            Promise.all([
                instance.create(label, {name: 'From'}),
                instance.create(label, {name: 'To'}),
            ])
            .then(([from, to]) => {
                return instance.relate(from, to, 'relate_test')
            })
            .then(() => done())
            .catch(e => done(e));
        })
    });

    describe('::query', () => {
        it('should return a query builder', () => {
            const query = instance.query();

            expect(query).to.be.an.instanceOf(Builder);
        });
    });

    describe('::close', () => {
        it('should close the neo4j connection', () => {
            const output = instance.close();
        });
    });

    describe('::all', () => {
        it('should return a collection of nodes', (done) => {
            instance.all(label, {}, {}, 1, 0)
                .then(res => {
                    expect(res).to.be.an.instanceOf(NodeCollection);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::find', () => {
        it('should find a label by its primary key', (done) => {
            instance.find(label, 1)
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::findById', () => {
        it('should find a label by its primary key', (done) => {
            instance.findById(label, 1)
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::first', () => {
        it('should find a label by a property', (done) => {
            instance.first(label, 'key', 'value')
                .then(() => done())
                .catch(e => done(e));
        });
    });

});