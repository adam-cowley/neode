import RelationshipType, { DIRECTION_IN, DIRECTION_OUT } from '../src/RelationshipType';
import Property from '../src/Property';
import Model from '../src/Model';
import {assert, expect} from 'chai';

describe('RelationshipType.js', () => {
    let instance;
    let model;


    it('should construct', () => {
        const name = 'test';
        const type = 'relationships';
        const rel = 'TEST_RELATIONSHIP';
        const direction = 'in';
        const target = new Model(null, 'name', {});
        const schema = {
            name: 'string',
        };
        const eager = true;
        const cascade = 'delete';
        const node_alias = 'alias';

        const relationship = new RelationshipType(name, type, rel, direction, target, schema, eager, cascade, node_alias);

        expect(relationship.name()).to.equal(name);
        expect(relationship.type()).to.equal(type);
        expect(relationship.relationship()).to.equal(rel);
        expect(relationship.direction()).to.equal(DIRECTION_IN);
        expect(relationship.target()).to.equal(target);
        expect(relationship.schema()).to.equal(schema);
        expect(relationship.eager()).to.equal(eager);
        expect(relationship.cascade()).to.equal(cascade);
        expect(relationship.nodeAlias()).to.equal(node_alias);

        const props = relationship.properties();

        expect(props).to.be.an.instanceOf(Map);
        expect(props.has('name')).to.equal(true);
        expect(props.get('name')).to.be.an.instanceOf(Property);

        expect(props.get('name').type()).to.equal('string');

        relationship.setDirection('nonesense');

        expect(relationship.direction()).to.equal(DIRECTION_OUT);

    });

});