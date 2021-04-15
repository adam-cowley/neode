/* eslint-disable no-undef */
import {assert, expect} from 'chai';
import MergeOn from '../../src/Services/MergeOn';
import Node from '../../src/Node';

const TIMEOUT = 10000;

describe('Services/MergeOn.js', () => {
    let instance;
    let model;

    const label = 'MergeOnTest';
    const schema = {
        uuid: {
            type: 'uuid',
            primary: true,
        },
        name: {
            type: 'string',
            min: 3,
        },
        age: 'integer',
        boolean: 'boolean',

        relationship: {
            type: 'relationship',
            relationship: 'RELATIONSHIP',
            target: label,
            direction: 'out',
            properties: {},
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
            properties: {},
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
        }
    };
    const merge_on = ['name'];

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

    describe('::MergeOn', () => {
        describe('Properties', () => {
            it('should throw an error when no merge fields are present', done => {
                MergeOn(instance, model, merge_on, {})
                    .then(() => {
                        assert(false, 'Error should be thrown');
                    })
                    .catch(e => {
                        assert(true);

                        done();
                    });
            }).timeout(TIMEOUT);

            it('should perform validation', done => {
                MergeOn(instance, model, merge_on, {name: 'al'})
                    .then(() => {
                        assert(false, 'Error should be thrown');
                    })
                    .catch(e => {
                        expect(e.details).to.be.instanceOf(Array);
                        expect(e.details[0].path[0]).to.equal('name');
                    })
                    .then(() => done());
            }).timeout(TIMEOUT);

            it('should merge and generate default values', done => {
                const data = {
                    name: 'Adam',
                    age: 30,
                    boolean: false,
                };

                MergeOn(instance, model, merge_on, data)
                    .then(res => {
                        expect(res).to.be.an.instanceOf(Node);

                        expect( res.get('name') ).to.equal(data.name);
                        expect( res.get('age').toInt()) .to.equal(data.age);
                        expect( res.get('boolean')) .to.equal(data.boolean);

                        assert( res.get('uuid').match(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i) )
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);

            it('should not attempt to overwrite a primary key ', done => {
                const name = 'Keep my primary key';

                MergeOn(instance, model, merge_on, { name })
                    .then(first => {
                        return MergeOn(instance, model, merge_on, { name })
                            .then(second => [ first, second ])
                    })
                    .then(( [first, second] ) => {
                        expect( first.id() ).to.equal( second.id() );
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);
        });

        describe('-> node', () => {
            it('should create a relationship to a Node instance', done => {
                const name = 'End';

                MergeOn(instance, model, merge_on, { name })
                    .then(end_node => {
                        return MergeOn(instance, model, merge_on, {
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
                const name = 'End node 2';

                MergeOn(instance, model, merge_on, { name })
                    .then(end_node => {
                        return MergeOn(instance, model, merge_on, {
                            name: 'Start node 2',
                            node: end_node.get('uuid'),
                        })
                        .then(res => {
                            expect( res.get('name') ).to.equal('Start node 2');
                            expect( res.get('node').get('name') ).to.equal(name)
                        })
                        .then(() => done())
                        .catch(e => done(e));
                    });
            }).timeout(TIMEOUT);

            it('should recursively create nodes', done => {
                const data = {
                    name: 'Start node 3',
                    node: {
                        name: 'End node 3',
                    },
                };

                MergeOn(instance, model, merge_on, data)
                    .then(res => {
                        expect( res.get('name') ).to.equal('Start node 3');
                        expect( res.get('node').get('name') ).to.equal('End node 3')
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

                MergeOn(instance, model, merge_on, data)
                    .then(res => {
                        assert(false, 'Should throw an exception')
                    })
                    .catch(e => {
                        const expected = 'A target defintion must be defined for relationshipToAnything on model MergeOnTest';
                        expect( e.message ).to.equal(expected);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('-> nodes', () => {
            it('should create relationships to an array of Node instances', done => {
                const name = 'End';

                MergeOn(instance, model, merge_on, { name })
                    .then(end_node => {
                        return MergeOn(instance, model, merge_on, {
                            name: 'Start',
                            nodes: [end_node]
                        })
                            .then(res => {
                                expect( res.get('name') ).to.equal('Start');
                                expect( res.get('nodes').first().get('name') ).to.equal(name);
                            })
                            .then(() => done())
                            .catch(e => done(e));
                    });
            }).timeout(TIMEOUT);

            it('should create a relationship to an array of nodes by their primary key', done => {
                const name = 'End';

                MergeOn(instance, model, merge_on, { name })
                    .then(end_node => {
                        return MergeOn(instance, model, merge_on, {
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

            it('should recursively merge nodes', done => {
                const data = {
                    name: 'Start',
                    nodes: [{
                        name: 'End',
                    }],
                };

                MergeOn(instance, model, merge_on, data)
                    .then(res => {
                        expect( res.get('name') ).to.equal('Start');
                        expect( res.get('nodes').first().get('name') ).to.equal('End')
                    })
                    .then(() => done())
                    .catch(e => done(e));
            }).timeout(TIMEOUT);

            it('should recursively merge nodes to multiple degrees', done => {
                const data = {
                    name: 'Start',
                    nodes: [{
                        name: 'Middle',
                        nodes: {
                            name: 'End',
                        },
                    }],
                };

                MergeOn(instance, model, merge_on, data)
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

                MergeOn(instance, model, merge_on, { name })
                    .then(end_node => {
                        return MergeOn(instance, model, merge_on, {
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

                MergeOn(instance, model, merge_on, { name })
                    .then(end_node => {
                        return MergeOn(instance, model, merge_on, {
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

                MergeOn(instance, model, merge_on, data)
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

                MergeOn(instance, model, merge_on, data)
                    .then(res => {
                        assert(false, 'Should throw an exception')
                    })
                    .catch(e => {
                        const expected = 'You cannot create a node with the ambiguous relationship: ambiguousRelationship on model MergeOnTest';
                        expect( e.message ).to.equal(expected);
                    })
                    .then(() => done())
                    .catch(e => done(e));
            });
        });

        describe('-> relationships', () => {
            it('should create relationships to an array of Node instances', done => {
                const name = 'Rel End 1';

                MergeOn(instance, model, merge_on, { name })
                    .then(end_node => {
                        return MergeOn(instance, model, merge_on, {
                            name: 'Rel Start 1',
                            relationships: [{
                                since: 100,
                                otherEnd: end_node
                            }]
                        })
                        .then(res => {
                            expect( res.get('name') ).to.equal('Rel Start 1');
                            expect( res.get('relationships').first().get('since') ).to.equal(100);
                            expect( res.get('relationships').first().otherNode().get('name') ).to.equal(name);
                        })
                        .then(() => done())
                        .catch(e => done(e));
                    })
            }).timeout(TIMEOUT);

            it('should create a relationship to a single node by its primary key', done => {
                const name = 'Rel End 2';

                MergeOn(instance, model, merge_on, { name })
                    .then(end_node => {
                        return MergeOn(instance, model, merge_on, {
                            name: 'Rel Start 2',
                            relationship: {
                                since: 100,
                                otherEnd: end_node.get('uuid'),
                            },
                        })
                        .then(res => {
                            expect( res.get('name') ).to.equal('Rel Start 2');
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

                MergeOn(instance, model, merge_on, data)
                    .then(never => {
                        const gonna = never.get('relationship').otherNode();

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
