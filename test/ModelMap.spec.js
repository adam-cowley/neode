import ModelMap from '../src/ModelMap';
import Model from '../src/Model';
import {assert, expect} from 'chai';

describe('src/ModelMap.js', () => {
    const map = new ModelMap();

    describe('::set', () => {
        it('should set and get a new model', () => {
            const name = 'ModelMap';
            const model = new Model(null, name);

            map.set(name, model);

            expect( map.get(name) ).to.equal(model);
        });
    });

    describe('::getByLabels', () => {
        it('should identify a single label model', () => {
            const name = 'SingleLabelModel';
            const model = new Model(null, name);
            const schema = {}

            map.set(name, model);

            expect( map.getByLabels([ name ]) ).to.equal(model);
        });

        it('should identify a model with multiple labels', () => {
            const name = 'MultipleLabelModel';
            const schema = {
                labels: ['Multiple', 'Labels']
            }
            const model = new Model(null, name, schema);

            map.set(name, model);

            expect( map.getByLabels(schema.labels) ).to.equal(model);
        });

    });

});