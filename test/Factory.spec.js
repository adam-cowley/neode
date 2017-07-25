import {assert, expect} from 'chai';
import Node from '../src/Node';
import NodeCollection from '../src/NodeCollection';

describe('Factory.js', () => {
    const instance = require('./instance');
    const label = 'QueryableTest';
    const schema = {
        id: {
            type: 'uuid',
            primary: true,
        },
        name: 'string'
    };

    const definition = instance.model(label, schema);
    let node;

    before(done => {
        instance.create(label, {name: "Test"})
            .then(res => {
                node = res._node;

                done();
            })
            .catch(e => done(e));
    });

    after(done => {
        instance.deleteAll(label)
            .then(() => done())
            .catch(e => done(e));
    });

    describe('::getDefinition', () => {
        it('should identify a label', () => {
            const output = instance.factory.getDefinition([label]);
            expect(definition.name()).to.equal(output.name());
        });

        it('should return false when definition not found', () => {
            const output = instance.factory.getDefinition('Unknown');
            expect(output).to.equal(false);
        });
    });

    describe('::make', () => {
        it('should return a Node object', () => {
            const output = instance.factory.make(node);

            expect(output).to.be.an.instanceOf(Node);
            expect(output._node).to.equal(node);
            expect(output.model().name()).to.equal(definition.name());
        });
    });

    describe('::hydrateAll', () => {
        it('should hydrate an array of nodes into a NodeCollection', () => {
            const output = instance.factory.hydrateAll([node]);

            expect(output.length).to.equal(1);
            expect(output).to.be.an.instanceOf(NodeCollection);
            expect(output.first()).to.be.an.instanceOf(Node);
            expect(output.first().idInt()).to.equal(node.identity);
            expect(output.first().model().name()).to.equal(definition.name());
        });
    });

});
