import {assert, expect} from 'chai';
import Node from '../src/Node';

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

    describe('::getDefinition', () => {
        it('should identify a label', () => {
            const output = instance.factory.getDefinition([label]);
            expect(definition).to.equal(output);
        });

        it('should return false when definition not found', () => {
            const output = instance.factory.getDefinition('Unknown');
            expect(output).to.equal(false);
        });
    });

    describe('::make', () => {
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

        it('should return a Node object', () => {
            const output = instance.factory.make(node);

            expect(output).to.be.an.instanceOf(Node);
            expect(output._node).to.equal(node);
            expect(output.model()).to.equal(definition);
        });     
    });

});
