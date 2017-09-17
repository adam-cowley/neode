import {assert, expect} from 'chai';
import Node from '../src/Node';
import NodeCollection from '../src/NodeCollection';

describe('Queryable.js', () => {
    const instance = require('./instance');
    const label = 'QueryableTest';
    const schema = {
        id: {
            type: 'uuid',
            primary: true,
        },
        name: 'string',
        children: {
            type: 'relationship',
            relationship: 'HAS_CHILD',
            direction: 'OUT',
            eager: true
        }
    };

    const model = instance.model(label, schema);

    let created;

    before(done => {
        Promise.all([
            model.mergeOn({name: 'Created 1'}),
            model.mergeOn({name: 'Created 2'}),
            model.mergeOn({name: 'Created 3'}),
        ])
        .then(res => {
            created = res;
        })
        .then(() => {
            return created[0].relateTo(created[1], 'children');
        })
        .then(() => done())
        .catch(e => done(e));
    });

    after(done => {
        instance.deleteAll(label)
            .then(() => done())
            .catch(e => done(e));
    });

    describe('::all', () => {
        let first;

        it('should return a Collection of Nodes', (done) => {
            model.all()
                .then(res => {
                    expect(res).to.be.an.instanceOf(NodeCollection);
                    expect(res.length).to.equal(3);

                    expect(res.get(0)).to.be.an.instanceOf(Node);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should apply parameters', (done) => {
            model.all({name: 'Created 1'})
                .then(res => {
                    expect(res.length).to.equal(1);
                    expect(res.get(0)).to.be.an.instanceOf(Node);

                    expect(res.get(0).get('name')).to.equal('Created 1');
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should apply an order', (done) => {
            model.all({}, 'name')
                .then(res => {
                    const original = created.map(node => node.get('name')).sort();
                    const results = res.map(node => node.get('name'));

                    expect(original).to.deep.equal(results);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should handle object/apply a reverse order', (done) => {
            model.all({}, {name:'desc'})
                .then(res => {
                    const original = created.map(node => node.get('name')).sort().reverse();
                    const results = res.map(node => node.get('name'));

                    expect(original).to.deep.equal(results);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should apply a limit value', (done) => {
            const limit = 2;
            model.all({}, {name:'asc'}, limit)
                .then(res => {
                    expect(res.length).to.equal(limit);

                    first = res.get(0);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should apply a skip value', (done) => {
            const limit = 1;
            const skip = 1;
            model.all({}, {name:'asc'}, limit, skip)
                .then(res => {
                    expect(res.length).to.equal(limit);

                    expect(res.get(0).get('id')).to.not.equal(first.get('id'));
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should load eager relationships', (done) => {
            model.all({name: 'Created 1'})
                .then(res => {
                    const children = res.get(0).get('children');

                    expect(children).to.be.an.instanceOf(NodeCollection);
                    expect(children.length).to.equal(1);
                    expect(children.first().get('name')).to.equal(created[1].get('name'));
                })
                .then(() => done())
                .catch(e => done(e));

        });
    });

    describe('::find', () => {
        it('should find by primary key', (done) => {
            Promise.all(created.map(node => {
                return model.find(node.get('id'));
            }))
            .then(res => {
                expect(res.length).to.equal(3);

                return Promise.all(res.map((node, index) => {
                    expect(node).to.be.an.instanceOf(Node);
                    expect(node.id()).to.equal(created[ index ].id());
                    expect(node.get('id')).to.equal(created[ index ].get('id'));

                    const children = node.get('children');
                    expect(children).to.be.an.instanceOf(NodeCollection);

                    if ( node.get('id') == created[0].get('id') ) {
                        expect(children.length).to.equal(1);
                        expect(children.first().get('id')).to.equal( created[1].get('id') );
                    }
                    else {
                        expect(children.length).to.equal(0);
                    }
                }))
            })
            .then(() => done())
            .catch(e => done(e));
        });
    });

    describe('::findById', () => {
        it('should find by Node ID', (done) => {
            Promise.all(created.map(node => {
                return model.findById(node.id());
            }))
            .then(res => {
                expect(res.length).to.equal(3);

                return Promise.all(res.map((node, index) => {
                    expect(node).to.be.an.instanceOf(Node);
                    expect(node.id()).to.equal(created[ index ].id());
                    expect(node.get('id')).to.equal(created[ index ].get('id'));

                    const children = node.get('children');
                    expect(children).to.be.an.instanceOf(NodeCollection);

                    if ( node.get('id') == created[0].get('id') ) {
                        expect(children.length).to.equal(1);
                        expect(children.first().get('id')).to.equal( created[1].get('id') );
                    }
                    else {
                        expect(children.length).to.equal(0);
                    }
                }))
            })
            .then(() => done())
            .catch(e => done(e));
        });
    });

    describe('::first', () => {
        it('should find first record using (key, value)', (done) => {
            Promise.all(created.map(node => {
                return model.first('id', node.get('id'));
            }))
            .then(res => {
                expect(res.length).to.equal(3);

                return Promise.all(res.map((node, index) => {
                    expect(node).to.be.an.instanceOf(Node);
                    expect(node.id()).to.equal(created[ index ].id());
                    expect(node.get('id')).to.equal(created[ index ].get('id'));

                    const children = node.get('children');
                    expect(children).to.be.an.instanceOf(NodeCollection);

                    if ( node.get('id') == created[0].get('id') ) {
                        expect(children.length).to.equal(1);
                        expect(children.first().get('id')).to.equal( created[1].get('id') );
                    }
                    else {
                        expect(children.length).to.equal(0);
                    }
                }))
            })
            .then(() => done())
            .catch(e => done(e));
        });

        it('should find first record using object of properties', (done) => {
            Promise.all(created.map(node => {
                return model.first({id: node.get('id')});
            }))
            .then(res => {
                expect(res.length).to.equal(3);

                return Promise.all(res.map((node, index) => {
                    expect(node).to.be.an.instanceOf(Node);
                    expect(node.id()).to.equal(created[ index ].id());
                    expect(node.get('id')).to.equal(created[ index ].get('id'));
                }))
            })
            .then(() => done())
            .catch(e => done(e));
        });
    });

});