import {assert, expect} from 'chai';
import Create from '../../src/Services/Create';
import Node from '../../src/Node';
import neo4j from 'neo4j-driver';

const TIMEOUT = 10000;

describe('Services/Create.js', () => {
    let instance;
    let model;

    const label = 'CreateTest';
    const schema = {
        uuid: {
            type: 'uuid',
            primary: true,
        },
        name: {
            type: 'string',
            required: true,
        },
        age: 'integer',
        enabled: {
            type: 'boolean',
            default: false,
        },
        dob: {
            type: 'datetime',
            default: Date.now,
        },
        point: {
            type: 'point',
            default: {
                latitude: 51.506164642,
                longitude: -0.124832834,
            },
        },

        relationship: {
            type: 'relationship',
            relationship: 'RELATIONSHIP',
            target: label,
            direction: 'out',
            eager: true,
            alias: 'otherEnd',
            properties: {
                since: {
                    type: 'int',
                    default: Date.now
                }
            },
        },
        thenTo: {
            type: 'relationship',
            relationship: 'THEN_TO',
            target: label,
            direction: 'out',
            eager: true,
            alias: 'leaf',
            properties: {
                since: {
                    type: 'int',
                    default: Date.now
                }
            },
        },
        relationships: {
            type: 'relationships',
            relationship: 'RELATIONSHIP',
            target: label,
            eager: true,
            direction: 'out',
            alias: 'otherEnd',
            properties: {
                since: {
                    type: 'int',
                    default: Date.now
                }
            },
        },
        node: {
            type: 'node',
            relationship: 'RELATIONSHIP',
            target: label,
            direction: 'out',
            eager: true,
        },
        nodes: {
            type: 'nodes',
            relationship: 'RELATIONSHIP',
            target: label,
            direction: 'out',
            eager: true,
        },
        relationshipToAnything: {
            type: 'node',
            relationship: 'RELATIONSHIP',
            direction: 'out',
        },
        ambiguousRelationship: {
            type: 'node',
            relationship: 'AMBIGUOUS_RELATIONSHIP',
            direction: 'out',
            target: [ label, 'Person', 'Thing' ],
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

    describe('::Create', () => {
        describe('Properties', () => {
            it('should perform validation', done => {
                Create(instance, model, {})
                    .then(() => {
                        assert(false, 'Error should be thrown');
                    })
                    .catch(e => {
                        expect(e.details).to.be.instanceOf(Object);
                        // TODO: assertion failing?
                        // expect(e.details.name).to.be.instanceOf(Array);
                        done();
                    })
                    .catch(e => done(e));
            }).timeout(TIMEOUT);

            it('should generate default values', done => {
                const data = {
                    name: 'James',
                    age: 21,
                };

                Create(instance, model, data)
                    .then(res => {
                        expect(res).to.be.an.instanceOf(Node);
                        expect( res.get('name') ).to.equal(data.name);
                        expect( res.get('enabled') ).to.equal(false);
                        expect( res.get('age').toInt()) .to.equal(data.age);
                        assert( res.get('uuid').match(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i) )

                        expect( res.get('point') ).to.be.an.instanceof(neo4j.types.Point);
                        expect( res.get('point').x ).to.equal(schema.point.default.longitude);
                        expect( res.get('point').y ).to.equal(schema.point.default.latitude);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);

            it('should accept valid values', done => {
                const data = {
                    name: 'James',
                    age: 21,
                    point: {
                        latitude: 51.555775,
                        longitude: -1.779718,
                    },
                    dob: (new Date()).toISOString(),
                };

                Create(instance, model, data)
                    .then(res => {
                        expect(res).to.be.an.instanceOf(Node);
                        expect( res.get('name') ).to.equal(data.name);
                        expect( res.get('enabled') ).to.equal(false);
                        expect( res.get('age').toInt()) .to.equal(data.age);
                        assert( res.get('uuid').match(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i) )
                        expect( res.get('dob') ).to.be.an.instanceOf(neo4j.types.DateTime)

                        expect( res.get('point') ).to.be.an.instanceof(neo4j.types.Point);
                        expect( res.get('point').x ).to.equal(data.point.longitude);
                        expect( res.get('point').y ).to.equal(data.point.latitude);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);
        });

        describe('-> node', () => {
            it('should create a relationship to a Node instance', done => {
                const name = 'End';

                Create(instance, model, { name })
                    .then(end_node => {
                        return Create(instance, model, {
                            name: 'Start',
                            node: end_node
                        })
                            .then(res => {
                                expect( res.get('name') ).to.equal('Start');
                                expect( res.get('node').get('name') ).to.equal(name)
                            })
                            .then(() => done())
                            .catch(e => done(e));
                    })
            }).timeout(TIMEOUT);

            it('should create a relationship to a single node by its primary key', done => {
                const name = 'End';

                Create(instance, model, { name })
                    .then(end_node => {
                        return Create(instance, model, {
                            name: 'Start',
                            node: end_node.get('uuid'),
                        })
                            .then(res => {
                                expect( res.get('name') ).to.equal('Start');
                                expect( res.get('node').get('name') ).to.equal(name)
                            })
                            .then(() => done())
                            .catch(e => done(e));
                    });
            }).timeout(TIMEOUT);

            it('should recursively create nodes', done => {
                const data = {
                    name: 'Start',
                    node: {
                        name: 'End',
                    },
                };

                Create(instance, model, data)
                    .then(res => {
                        expect( res.get('name') ).to.equal('Start');
                        expect( res.get('node').get('name') ).to.equal('End')
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);

            it('should throw an error when you try to create a relationship to an ambiguous node', done => {
                const data = {
                    name: 'Start',
                    relationshipToAnything: {
                        name: 'End',
                    },
                };

                Create(instance, model, data)
                    .then(res => {
                        assert(false, 'Should throw an exception')
                    })
                    .catch(e => {
                        const expected = 'A target defintion must be defined for relationshipToAnything on model CreateTest';
                        expect( e.message ).to.equal(expected);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('-> nodes', () => {
            it('should create relationships to an array of Node instances', done => {
                const name = 'End';

                Create(instance, model, { name })
                    .then(end_node => {
                        return Create(instance, model, {
                            name: 'Start',
                            nodes: [end_node]
                        })
                            .then(res => {
                                expect( res.get('name') ).to.equal('Start');
                                expect( res.get('nodes').first().get('name') ).to.equal(name)
                            })
                            .then(() => done())
                            .catch(e => done(e));
                    })
            }).timeout(TIMEOUT);

            it('should create a relationship to a single node by its primary key', done => {
                const name = 'End';

                Create(instance, model, { name })
                    .then(end_node => {
                        return Create(instance, model, {
                            name: 'Start',
                            nodes: [end_node.get('uuid')],
                        })
                            .then(res => {
                                expect( res.get('name') ).to.equal('Start');
                                expect( res.get('nodes').first().get('name') ).to.equal(name)
                            })
                            .then(() => done())
                            .catch(e => done(e));
                    });
            }).timeout(TIMEOUT);

            it('should recursively create nodes', done => {
                const data = {
                    name: 'Start',
                    nodes: [{
                        name: 'End',
                    }],
                };

                Create(instance, model, data)
                    .then(res => {
                        expect( res.get('name') ).to.equal('Start');
                        expect( res.get('nodes').first().get('name') ).to.equal('End')
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);

            it('should recursively create nodes to multiple degrees', done => {
                const data = {
                    name: 'Start',
                    nodes: [{
                        name: 'Middle',
                        nodes: [{
                            name: 'End',
                        }],
                    }],
                };

                Create(instance, model, data)
                    .then(res => {
                        expect( res.get('name') ).to.equal('Start');
                        expect( res.get('nodes').first().get('name') ).to.equal('Middle');
                        expect( res.get('nodes').first().get('nodes').first().get('name') ).to.equal('End');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);
        });

        describe('-> relationship', () => {
            it('should create a relationship to a Node instance', done => {
                const name = 'End';

                Create(instance, model, { name })
                    .then(end_node => {
                        return Create(instance, model, {
                            name: 'Start',
                            relationship: {
                                since: 100,
                                otherEnd: end_node,
                            },
                        })
                            .then(res => {
                                expect( res.get('name') ).to.equal('Start');
                                expect( res.get('relationship').get('since') ).to.equal(100);
                                expect( res.get('relationship').otherNode().get('name') ).to.equal(name)
                            })
                            .then(() => done())
                            .catch(e => done(e));
                    })
            }).timeout(TIMEOUT);

            it('should create a relationship to a single node by its primary key', done => {
                const name = 'End';

                Create(instance, model, { name })
                    .then(end_node => {
                        return Create(instance, model, {
                            name: 'Start',
                            relationship: {
                                since: 200,
                                otherEnd: end_node.get('uuid'),
                            },
                        })
                        .then(res => {
                            expect( res.get('name') ).to.equal('Start');
                            expect( res.get('relationship').get('since') ).to.equal(200);
                            expect( res.get('relationship').otherNode().get('name') ).to.equal(name)
                        })
                        .then(() => done())
                        .catch(e => done(e));
                    });
            }).timeout(TIMEOUT);

            it('should recursively create nodes', done => {
                const data = {
                    name: 'Never',
                    relationship: {
                        since: 300,
                        otherEnd: {
                            name: 'gonna',
                            relationship: {
                                since: 400,
                                otherEnd: {
                                    name: 'give',
                                    thenTo: {
                                        since: 500,
                                        leaf: {
                                            name: 'you up'
                                        },
                                    },
                                },
                            },
                        },
                    },
                };

                Create(instance, model, data)
                    .then(never => {
                        const gonna = never.get('relationship').otherNode();
                        const give = never.get('relationship').otherNode().get('relationship').otherNode();

                        expect( never.get('name') ).to.equal('Never');
                        expect( never.get('relationship').get('since') ).to.equal(300);
                        expect( gonna.get('name') ).to.equal('gonna');
                        expect( gonna.get('relationship').get('since') ).to.equal(400);
                        expect( give.get('name') ).to.equal('give');
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);

            it('should throw an error when trying to create a relationship with ambiguous targets', done => {
                const data = {
                    name: 'Start',
                    ambiguousRelationship: {
                        node: {
                            name: 'End',
                        },
                    },
                };

                Create(instance, model, data)
                    .then(res => {
                        assert(false, 'Should throw an exception')
                    })
                    .catch(e => {
                        const expected = 'You cannot create a node with the ambiguous relationship: ambiguousRelationship on model CreateTest';
                        expect( e.message ).to.equal(expected);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('-> relationships', () => {
            it('should create relationships to an array of Node instances', done => {
                const name = 'End';

                Create(instance, model, { name })
                    .then(end_node => {
                        return Create(instance, model, {
                            name: 'Start',
                            relationships: [{
                                since: 100,
                                otherEnd: end_node
                            }]
                        })
                        .then(res => {
                            expect( res.get('name') ).to.equal('Start');
                            expect( res.get('relationships').first().get('since') ).to.equal(100);
                            expect( res.get('relationships').first().otherNode().get('name') ).to.equal(name);
                        })
                        .then(() => done())
                        .catch(e => done(e));
                    })
            }).timeout(TIMEOUT);

            it('should create a relationship to a single node by its primary key', done => {
                const name = 'End';

                Create(instance, model, { name })
                    .then(end_node => {
                        return Create(instance, model, {
                            name: 'Start',
                            relationship: {
                                since: 100,
                                otherEnd: end_node.get('uuid'),
                            },
                        })
                        .then(res => {
                            expect( res.get('name') ).to.equal('Start');
                            expect( res.get('relationships').first().get('since') ).to.equal(100);
                            expect( res.get('relationships').first().otherNode().get('name') ).to.equal(name);
                        })
                        .then(() => done())
                        .catch(e => done(e));
                    });
            }).timeout(TIMEOUT);

            it('should recursively create nodes', done => {
                const data = {
                    name: 'Never',
                    relationships: [{
                        since: 300,
                        otherEnd: {
                            name: 'gonna',
                            relationships: [
                                { since: 100, otherEnd: {name: 'give you up' }},
                                { since: 200, otherEnd: {name: 'let you down' }},
                                { since: 300, otherEnd: {name: 'run around and desert you' }},
                            ],
                        },
                    }],
                };

                Create(instance, model, data)
                    .then(never => {
                        const gonna = never.get('relationship').otherNode();
                        const give = never.get('relationship').otherNode().get('relationship').otherNode();

                        expect( never.get('name') ).to.equal('Never');
                        expect( never.get('relationships').first().get('since') ).to.equal(300);
                        expect( gonna.get('name') ).to.equal('gonna');

                        const what = gonna.get('relationships');

                        expect( what.length ).to.equal(3);

                        return what.toJson()
                            .then(json => {
                                const since = json.map(row => row.since);

                                expect(since).to.contain(100);
                                expect(since).to.contain(200);
                                expect(since).to.contain(300);

                                expect(since).to.have.members([100, 200, 300]);

                                const things = json.map(row => row.otherEnd.name);

                                expect(things).to.have.members(['let you down', 'give you up', 'run around and desert you']);
                            });
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);
        });
    });

});