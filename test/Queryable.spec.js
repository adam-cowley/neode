import {assert, expect} from 'chai';
import Node from '../src/Node';

describe('Queryable.js', () => {
    const instance = require('./instance');
    const label = 'QueryableTest';
    const schema = {
        id: {
            type: 'uuid',
            primary: true,
        },
        name: 'string'
    };

    const model = instance.model(label, schema);

    let created;

    before(done => {
        Promise.all([
            model.create({name: 'Created 1'}),
            model.create({name: 'Created 2'}),
            model.create({name: 'Created 3'}),
        ])
        .then(res => {
            created = res;
        })
        .then(() => done())
        .catch(e => done(e));
    });

    after(done => {
        instance.deleteAll(label)
            .then(() => done())
            .catch(e => done(e));
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
                }))
            })
            .then(() => done())
            .catch(e => done(e));
        });
    })

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