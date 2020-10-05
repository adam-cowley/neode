import {assert, expect} from 'chai';
import Neode from '../src/index';
import Model from '../src/Model';
import Node from '../src/Node';
import Collection from '../src/Collection';
import Property from '../src/Property';
import Builder from '../src/Query/Builder';
import Relationship from '../src/Relationship';
import { ERROR_TRANSACTION_FAILED } from '../src/TransactionError';

describe('index.js', () => {
    const label = 'IndexTest';
    const schema = {
        name: {type: 'string', primary: true},
        setme: 'string',
        relate_test: {
            type: 'relationship',
            relationship: 'RELATE_TEST',
            direction: 'OUT',
            properties: {
                test: 'boolean',
            },
        },
    };
    let instance;

    before(() => instance = require('./instance')() );

    after(done => {
        instance.cypher(`MATCH (n:${label}) DETACH DELETE n`)
            .then(() => instance.close())
            .then(() => done())
            .catch(e => done(e));
    });

    it('should instantiate', () => {
        expect(instance).to.be.an.instanceOf(Neode);
        // expect(instance.driver).to.be.an.instanceOf(neo4j.driver);
    });

    it('should instantiate with enterprise mode', () => {
        const enterprise = new Neode('bolt://localhost:3000', 'username', 'password', true, 'defaultdb');

        expect(enterprise).to.be.an.instanceOf(Neode);
        expect(enterprise.enterprise()).to.equal(true);
        expect(enterprise.database).to.equal('defaultdb');
    });

    it('should load models using `with` and return self', () => {
        const output = instance.with({
            WithTest: {
                name: 'string'
            }
        });

        expect(output).to.equal(instance);
        expect(output.model('WithTest')).to.be.an.instanceOf(Model);
    });

    it('should load modules from a directory', () => {
        const output = instance.withDirectory(__dirname + '/fixtures');
        const properties = require('./fixtures/ScanDirTest');

        expect(output).to.equal(instance);
        expect(output.model('ScanDirTest')).to.be.an.instanceOf(Model);
        expect(output.model('ScanDirTest').properties().get('id')).to.be.an.instanceOf(Property);
        expect(output.model('ScanDirTest').properties().get('name')).to.be.an.instanceOf(Property);
    });

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

    it('should run a cypher read query', (done) => {
        instance.readCypher('MATCH (n) RETURN count(n)')
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
                {query: 'MATCH (n) WHERE n.name = $name RETURN n', params: {name: 'name'}}
            ];

            instance.batch(queries)
                .then(res => {
                    assert.isArray(res)
                    expect(res.length).to.equal(2)
                })
                .then(done)
                .catch(done)
        });

        it('should throw a transaction error on error', done => {
            instance.batch([
                'MATCH (a) RETURN b',
                'RETURN x'
            ])
                .then(() => {
                    done( new Error('No TransactionError thrown') );
                })
                .catch(e => {
                    expect(e).to.be.an.instanceOf(Error);
                    expect(e.message).to.equal(ERROR_TRANSACTION_FAILED);
                    expect(e.errors.length).to.equal(2);

                    done();
                })

        });
    });

    describe('::model', () => {
        it('should register a new model', () => {
            const model = instance.model(label, schema);

            expect(model).to.be.an.instanceOf(Model);
            expect(model.name()).to.equal(label);
        });
    });

    describe('::extend', () => {
        it('should extend a model with new properties', () => {
            const extended_label = 'ExtendedTest';
            const using = {
                extended_id: {
                    primary: true
                },
                somethingelse: 'string'
            };

            const model = instance.extend(label, extended_label, using);

            expect(model).to.be.an.instanceOf(Model);
            expect(model.name()).to.equal(extended_label);
            expect(model.labels()).to.contain(label, extended_label);

            expect(model.primaryKey()).to.equal('extended_id');

            const newprop = model.properties().get('somethingelse');

            expect(newprop).to.be.an.instanceOf(Property);
            expect(newprop.type()).to.equal('string');

            expect(instance.model(extended_label)).to.equal(model);
        });
    });

    describe('::create', () => {
        it('should create a new model', (done) => {
            const create_data = {name: 'Test'};

            instance.create(label, create_data)
                .then(res => {
                    expect(res).to.be.an.instanceOf(Node);
                    expect(res.get('name')).to.equal(create_data.name);

                    expect( res.properties() ).to.deep.equal(create_data);

                    expect( res.get('unknown', 'default') ).to.equal('default');

                    return res.toJson();
                })
                .then(json => {
                    expect(json.name).to.equal(create_data.name);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::merge', () => {
        it('should merge a model', (done) => {
            const create_data = {name: 'Test'};

            Promise.all([
                instance.merge(label, create_data),
                instance.merge(label, create_data),
            ])
                .then(([ first, second ]) => {
                    expect(first).to.be.an.instanceOf(Node);
                    expect(first.get('name')).to.equal(create_data.name);

                    expect(second).to.be.an.instanceOf(Node);
                    expect(second.get('name')).to.equal(create_data.name);

                    expect(first.id()).to.equal(second.id());
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::mergeOn', () => {
        it('should merge a model on specific properties', (done) => {
            const match = {name: 'Test'};
            const set = {setme: 'set'};

            Promise.all([
                instance.mergeOn(label, match, set),
                instance.mergeOn(label, match, set),
            ])
                .then(([ first, second ]) => {
                    expect(first).to.be.an.instanceOf(Node);
                    expect(first.get('name')).to.equal(match.name);
                    expect(first.get('setme')).to.equal(set.setme);

                    expect(second).to.be.an.instanceOf(Node);
                    expect(second.get('name')).to.equal(match.name);
                    expect(second.get('setme')).to.equal(set.setme);

                    expect(first.id()).to.equal(second.id());
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
            const props = { test: true };
            Promise.all([
                instance.create(label, {name: 'From'}),
                instance.create(label, {name: 'To'}),
            ])
                .then(([from, to]) => {
                    return instance.relate(from, to, 'relate_test', props)
                        .then(rel => {
                            expect(rel).to.be.instanceof(Relationship);
                            expect(rel.get('test')).to.equal( props.test );

                            return rel;
                        })
                        .then(rel => {
                            expect( rel.properties() ).to.deep.equal(props);

                            return rel;
                        });
                })
                .then(rel => {
                    return instance.cypher(
                        'MATCH (start)-[rel]->(end) WHERE id(start) = $start AND id(rel) = $rel AND id(end) = $end RETURN count(*) as count',
                        {
                            start: rel.startNode().identity(),
                            rel: rel.identity(),
                            end: rel.endNode().identity(),
                        }
                    )
                        .then(res => {
                            expect( res.records[0].get('count').toNumber() ).to.equal(1);
                        });
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should create a second relationship when forced', (done) => {
            const props = { test: true };
            Promise.all([
                instance.create(label, {name: 'From'}),
                instance.create(label, {name: 'To'}),
            ])
                .then(([from, to]) => {
                    return instance.relate(from, to, 'relate_test', props)
                        .then(rel => {
                            expect(rel).to.be.instanceof(Relationship);
                            expect(rel.get('test')).to.equal( props.test );

                            return rel;
                        })
                        .then(rel => {
                            expect( rel.properties() ).to.deep.equal(props);

                            return rel;
                        });
                })
                .then(rel => {
                    return instance.relate(rel.startNode(), rel.endNode(), 'relate_test', props, true)
                        .then(rel => {
                            expect(rel).to.be.instanceof(Relationship);
                            expect(rel.get('test')).to.equal( props.test );

                            return rel;
                        })
                        .then(rel => {
                            expect( rel.properties() ).to.deep.equal(props);

                            return rel;
                        });
                })
                .then(rel => {
                    return instance.cypher(
                        `MATCH (start)-[:${ rel.type() }]->(end) WHERE id(start) = $start AND id(end) = $end RETURN count(*) as count`,
                        {
                            start: rel.startNode().identity(),
                            rel: rel.identity(),
                            end: rel.endNode().identity(),
                        }
                    )
                        .then(res => {
                            expect( res.records[0].get('count').toNumber() ).to.equal(2);
                        });
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should throw an error for an unknown relationship type', done => {
            Promise.all([
                instance.create(label, {name: 'From'}),
                instance.create(label, {name: 'To'}),
            ])
                .then(([from, to]) => {
                    return instance.relate(from, to, 'unknown')
                        .then(rel => {
                            assert(false, 'Error should be thrown on unknown relationship type');
                        })
                        .catch(e => {
                            done();
                        });
                })
        });
    });

    describe('::detachFrom', () => {
        it('should detach two nodes', (done) => {
            Promise.all([
                instance.create(label, {name: 'From'}),
                instance.create(label, {name: 'To'}),
            ])
                .then(([from, to]) => from.detachFrom(to))
                .then(([from, to]) => {
                    return instance.cypher(
                        'MATCH (start)-[rel]->(end) WHERE id(start) = $start AND id(end) = $end RETURN count(*) as count',
                        {
                            start: from.identity(),
                            end: to.identity(),
                        }
                    )
                        .then(res => {
                            expect(res.records[0].get('count').toNumber()).to.equal(0);
                        });
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::query', () => {
        it('should return a query builder', () => {
            const query = instance.query();

            expect(query).to.be.an.instanceOf(Builder);
        });
    });

    describe('::all', () => {
        it('should return a collection of nodes', (done) => {
            instance.all(label, {}, {}, 1, 0)
                .then(res => {
                    expect(res).to.be.an.instanceOf(Collection);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::find', () => {
        it('should find a label by its primary key', (done) => {
            const create_data = {name: 'FindTest'};
            instance.create(label, create_data)
                .then(res => {
                    return instance.find(label, create_data.name)
                        .then(found => {
                            expect(found.id()).to.equal(res.id());
                        })
                        .then(() => res.delete())
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::findById', () => {
        it('should find a label by its internal ID', (done) => {
            const create_data = {name: 'FindByIdTest'};
            instance.create(label, create_data)
                .then(res => {
                    return instance.findById(label, res.id())
                        .then(found => {
                            expect(found.id()).to.equal(res.id());
                        })
                        .then(() => res.delete())
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('::first', () => {
        it('should find a label by a property', (done) => {
            const key = 'name';
            const value = 'FirstTest';

            instance.create(label, { [key] : value })
                .then(res => {
                    return instance.first(label, key, value)
                        .then(found => {
                            expect(found).to.be.instanceOf(Node);

                            expect(found.id()).to.equal(res.id());
                        });
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should find a label by a map of properties', (done) => {
            const key = 'name';
            const value = 'FirstMapTest';

            instance.create(label, { [key] : value })
                .then(res => {
                    return instance.first(label, { [key] : value })
                        .then(found => {
                            expect(found).to.be.instanceOf(Node);

                            expect(found.id()).to.equal(res.id());
                        });
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });


    describe('::cypher', () => {
        it('should execute a function as part of a session', (done) => {
            const session = instance.session();

            instance.cypher('MATCH (n) RETURN COUNT(n)', {}, session)
                .then(res => {
                    expect(session._open).to.equal(true);

                    session.close();
                })
                .then(() => done())
                .catch(e => done(e));
        });

        // it('should execute a function as part of a transaction', (done) => {
        //     done();
        // });
    });

    // TODO: Killing queries, reinstate?
    // describe('::close', () => {
    //     it('should close the neo4j connection', () => {
    //         const output = instance.close();
    //     });
    // });

});