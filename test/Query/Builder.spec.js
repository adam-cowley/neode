import { assert, expect } from 'chai';
import Builder, { mode } from '../../src/Query/Builder';
import WhereStatement from '../../src/Query/WhereStatement';
import Integer from 'neo4j-driver/lib/v1/integer';
import RelationshipType from '../../src/RelationshipType';

describe('Query/Builder.js', () => {
    let instance;
    let model;

    const label = 'QueryBuilderTest';

    before(() => {
        instance = require('../instance')();

        model = instance.model(label, {
            id: {
                type: 'string',
                required: true,
                unique: true,
            },
            name: {
                type: 'string',
                required: true,

            },
            age: {
                type: 'number',
                index: true,
                default: 30
            }
        });
    });

    after(() => instance.close());

    describe('MATCH', () => {
        it('should return new query builder from Neode instance', () => {
            const query = instance.query();

            expect(query).to.be.an.instanceOf(Builder);
        });

        it('should build a match query on internal ID', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .whereId('this', 1)
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (id(this) = $where_this_id) ',
                'RETURN',
                'this'
            ].join('\n');
            const expected_params = { where_this_id: new Integer(1) };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a double match query on internal IDs', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .whereId('this', 1)
                .match('that', model)
                .whereId('that', 2)
                .return('this', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (id(this) = $where_this_id) ',
                'MATCH',
                '(that:QueryBuilderTest)',
                'WHERE (id(that) = $where_that_id) ',
                'RETURN',
                'this,that'
            ].join('\n');

            const expected_params = { where_this_id: new Integer(1), where_that_id: new Integer(2) };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with a where clause using labels from a model', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property', 'that')
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) ',
                'RETURN',
                'this'
            ].join('\n');
            const expected_params = { where_this_property: 'that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with a where clause using a label as a string', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', 'QueryBuilderTest')
                .where('this.property', 'that')
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) ',
                'RETURN',
                'this'
            ].join('\n');
            const expected_params = { where_this_property: 'that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should accept an object in the where clause', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', 'QueryBuilderTest')
                .where({'this.property': 'that'})
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) ',
                'RETURN',
                'this'
            ].join('\n');
            const expected_params = { where_this_property: 'that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        })

        it('should build a query with a whereRaw clause', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .whereRaw('this.property >= datetime()')
                .return('this')
                .build();
        })

        it('should build a query with two where clauses', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property', 'that')
                .where('this.other_property', 'not that')
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property AND this.other_property = $where_this_other_property) ',
                'RETURN',
                'this'
            ].join('\n');
            const expected_params = { where_this_property: 'that', where_this_other_property: 'not that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should accept an array of where clauses', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where([
                    ['this.property', 'that'],
                    ['this.other_property', 'not that']
                ])
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property AND this.other_property = $where_this_other_property) ',
                'RETURN',
                'this'
            ].join('\n');
            const expected_params = { where_this_property: 'that', where_this_other_property: 'not that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should accept an object of where clauses', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where({
                    'this.property': 'that',
                    'this.other_property': 'not that'
                })
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property AND this.other_property = $where_this_other_property) ',
                'RETURN',
                'this'
            ].join('\n');
            const expected_params = { where_this_property: 'that', where_this_other_property: 'not that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should accept a raw where clause', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property = "that"')
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = "that") ',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build an `or` query', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property', 'that')
                .or('this.other_property', 'not that')
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) OR (this.other_property = $where_this_other_property) ',
                'RETURN',
                'this'
            ].join('\n');
            const expected_params = { where_this_property: 'that', where_this_other_property: 'not that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with skip and limit', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property', 'that')
                .return('this')
                .skip(1)
                .limit(1)
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) ',
                'RETURN',
                'this',
                'SKIP 1',
                'LIMIT 1'
            ].join('\n');
            const expected_params = { where_this_property: 'that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with a with statement', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .whereId('this', 1)
                .with('this')
                .match('that', model)
                .whereId('that', 2)
                .return('this', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (id(this) = $where_this_id) ',
                'WITH this',
                '',
                'MATCH',
                '(that:QueryBuilderTest)',
                'WHERE (id(that) = $where_that_id) ',
                'RETURN',
                'this,that'
            ].join('\n');

            const expected_params = { where_this_id: new Integer(1), where_that_id: new Integer(2) };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with an order statement', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property', 'that')
                .return('this')
                .orderBy('this.property', 'ASC')
                .skip(20)
                .limit(10)
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) ',
                'RETURN',
                'this',
                'ORDER BY',
                'this.property ASC',
                'SKIP 20',
                'LIMIT 10'
            ].join('\n');
            const expected_params = { where_this_property: 'that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        })

        it('should build a query with multiple order statements', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property', 'that')
                .return('this')
                .orderBy('this.property', 'ASC')
                .orderBy('this.other', 'DESC')
                .skip(20)
                .limit(10)
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) ',
                'RETURN',
                'this',
                'ORDER BY',
                'this.property ASC,this.other DESC',
                'SKIP 20',
                'LIMIT 10'
            ].join('\n');
            const expected_params = { where_this_property: 'that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with an array of string order statements', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property', 'that')
                .return('this')
                .orderBy(['this.property', 'this.other'])
                .skip(20)
                .limit(10)
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) ',
                'RETURN',
                'this',
                'ORDER BY',
                'this.property,this.other',
                'SKIP 20',
                'LIMIT 10'
            ].join('\n');
            const expected_params = { where_this_property: 'that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with an order object', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property', 'that')
                .return('this')
                .orderBy({ 'this.property': 'DESC' })
                .skip(20)
                .limit(10)
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) ',
                'RETURN',
                'this',
                'ORDER BY',
                'this.property DESC',
                'SKIP 20',
                'LIMIT 10'
            ].join('\n');
            const expected_params = { where_this_property: 'that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with an array of order object', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .where('this.property', 'that')
                .return('this')
                .orderBy([{ field: 'this.property', order: 'ASC' }, { field: 'this.that', order: 'DESC' }])
                .skip(20)
                .limit(10)
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (this.property = $where_this_property) ',
                'RETURN',
                'this',
                'ORDER BY',
                'this.property ASC,this.that DESC',
                'SKIP 20',
                'LIMIT 10'
            ].join('\n');
            const expected_params = { where_this_property: 'that' };

            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with a relationship type', () => {
            const builder = new Builder();
            const rel = new RelationshipType('test', 'relationships', 'REL_TO', 'OUT');

            const { query, params } = builder
                .match('this', model)
                .relationship(rel)
                .to('that', model)
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)-[:`REL_TO`]->(that:QueryBuilderTest)',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a query with a relationship to anything', () => {
            const builder = new Builder();
            const rel = new RelationshipType('test', 'relationships', 'REL_TO', 'OUT');

            const { query, params } = builder
                .match('this', model)
                .relationship(rel)
                .toAnything()
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)-[:`REL_TO`]->()',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a query with an outwards relationship', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .relationship('REL_TO', 'out')
                .to('that', model)
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)-[:`REL_TO`]->(that:QueryBuilderTest)',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a query with an inwards relationship', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .relationship('REL_TO', 'in')
                .to('that', model)
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)<-[:`REL_TO`]-(that:QueryBuilderTest)',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a query with an outwards relationship with alias', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .relationship('REL_TO', 'out', 'rel')
                .to('that', model)
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)-[rel:`REL_TO`]->(that:QueryBuilderTest)',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a query with an outwards relationship with alias and properties', () => {
            const builder = new Builder();
            const { query, params } = builder
                .match('this', model)
                .relationship('REL_TO', 'out', 'rel')
                .to('that', model, {name: 'name'})
                .return('this', 'rel', 'that')
                .build();
            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)-[rel:`REL_TO`]->(that:QueryBuilderTest { name: $that_name })',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');
            
            const expected_params = { that_name: 'name' };
            expect(query).to.equal(expected);
            expect(params).to.deep.equal(expected_params);
        });

        it('should build a query with an outwards relationship with alias but no type', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .relationship(false, 'out', 'rel')
                .to('that', model)
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)-[rel]->(that:QueryBuilderTest)',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a query with multiple relationship types', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .relationship(['REL_1_TO', 'REL_2_TO'], 'out', 'rel')
                .to('that', model)
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)-[rel:`REL_1_TO`|`REL_2_TO`]->(that:QueryBuilderTest)',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });


        it('should build a query with an outwards relationship with alias and traversal', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .relationship('REL_TO', 'out', 'rel', '1..3')
                .to('that', model)
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)-[rel:`REL_TO`*1..3]->(that:QueryBuilderTest)',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a query with an optional match', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .optionalMatch('this')
                .relationship('REL_TO', 'out')
                .to('that', model)
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                '',
                'OPTIONAL MATCH',
                '(this)-[:`REL_TO`]->(that:QueryBuilderTest)',
                '',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a query with multiple inline properties', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model, { id: 1, name: 'name' })
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest { id: $this_id, name: $this_name })',
                '',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a query with a negative where condition', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .whereNot('this.name', 'adam')
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (NOT this.name = $where_this_name) ',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should handle a query with multiple clauses on the same property', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .whereNot('this.name', 'Adam')
                .whereNot('this.name', 'Lauren')
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (NOT this.name = $where_this_name AND NOT this.name = $where_this_name_2) ',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should handle a query with a between statement', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .whereBetween('this.age', 18, 21)
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE ($where_this_age_floor <= this.age <= $where_this_age_ceiling) ',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should handle a query with a not between statement', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .whereNotBetween('this.age', 18, 21)
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                'WHERE (NOT $where_this_age_floor <= this.age <= $where_this_age_ceiling) ',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });
    });

    describe('DELETE', () => {
        it('should build a delete query', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .delete('this')
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                '',
                'DELETE',
                'this',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a detach delete query', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model)
                .detachDelete('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest)',
                '',
                'DETACH DELETE',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });
    });

    describe('CREATE', () => {
        it('should build a create query', () => {
            const builder = new Builder();

            const { query, params } = builder
                .create('this', model)
                .set('this.prop1', 'value1')
                .set('this.prop2', 'value2')
                .build();

            const expected = [
                'CREATE',
                '(this:QueryBuilderTest)',
                '',
                'SET',
                'this.prop1 = $set_0, this.prop2 = $set_1',
            ].join('\n');

            expect(query).to.equal(expected);
            expect(params).to.deep.equal({
                'set_0': 'value1',
                'set_1': 'value2',
            });
        });

        it('should build a create query with a relationship', () => {
            const builder = new Builder();

            const { query, params } = builder
                .create('this', model)
                .relationship('REL_TO', 'out')
                .to('that', model)
                .set('this.prop1', 'value1')
                .set('this.prop2', 'value2')
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'CREATE',
                '(this:QueryBuilderTest)-[:`REL_TO`]->(that:QueryBuilderTest)',
                '',
                'SET',
                'this.prop1 = $set_0, this.prop2 = $set_1',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should build a create query with multiple inline properties', () => {
            const builder = new Builder();

            const { query, params } = builder
                .create('this', model, { id: 1, name: 'name' })
                .return('this')
                .build();

            const expected = [
                'CREATE',
                '(this:QueryBuilderTest { id: $this_id, name: $this_name })',
                '',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });
    });

    describe('MERGE', () => {
        it('should build a merge query', () => {
            const builder = new Builder();

            const { query, params } = builder
                .merge('this', model)
                .set('this.prop1', 'value1')
                .set('this.prop2', 'value2')
                .build();

            const expected = [
                'MERGE',
                '(this:QueryBuilderTest)',
                '',
                'SET',
                'this.prop1 = $set_0, this.prop2 = $set_1',
            ].join('\n');

            expect(query).to.equal(expected);
            expect(params).to.deep.equal({
                'set_0': 'value1',
                'set_1': 'value2',
            });
        });

        it('should build a merge query with a relationship', () => {
            const builder = new Builder();

            const { query, params } = builder
                .merge('this', model)
                .relationship('REL_TO', 'out')
                .to('that', model)
                .set('this.prop1', 'value1')
                .set('this.prop2', 'value2')
                .return('this', 'rel', 'that')
                .build();

            const expected = [
                'MERGE',
                '(this:QueryBuilderTest)-[:`REL_TO`]->(that:QueryBuilderTest)',
                '',
                'SET',
                'this.prop1 = $set_0, this.prop2 = $set_1',
                'RETURN',
                'this,rel,that'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should merge with inline property', () => {
            const builder = new Builder();

            const { query, params } = builder
                .merge('this', model, { id: 1 })
                .return('this')
                .build();

            const expected = [
                'MERGE',
                '(this:QueryBuilderTest { id: $this_id })',
                '',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should merge with multiple inline properties', () => {
            const builder = new Builder();

            const { query, params } = builder
                .merge('this', model, { id: 1, name: 'name' })
                .return('this')
                .build();

            const expected = [
                'MERGE',
                '(this:QueryBuilderTest { id: $this_id, name: $this_name })',
                '',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
        });

        it('should combine match and merge', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model, { id: 1 })
                .match('that', model, { id: 2 })
                .merge('this')
                    .relationship('TO', 'out', 'r')
                    .to('that')
                .set('r.value', 'something')
                .return('this', 'r', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest { id: $this_id })',
                '',
                'MATCH',
                '(that:QueryBuilderTest { id: $that_id })',
                '',
                'MERGE',
                '(this)-[r:`TO`]->(that)',
                '',
                'SET',
                'r.value = $set_0',
                'RETURN',
                'this,r,that'
            ].join('\n');

            expect(query).to.equal(expected);
            expect(params).to.deep.equal({ this_id: 1, that_id: 2, set_0: 'something' })
        });

        it('should combine match, merge and remove', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model, { id: 1 })
                .match('that', model, { id: 2 })
                .merge('this')
                    .relationship('TO', 'out', 'r')
                    .to('that')
                .set('r.value', 'something')
                .remove('this:Label', 'that:Label')
                .return('this', 'r', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest { id: $this_id })',
                '',
                'MATCH',
                '(that:QueryBuilderTest { id: $that_id })',
                '',
                'MERGE',
                '(this)-[r:`TO`]->(that)',
                '',
                'REMOVE',
                'this:Label, that:Label',
                'SET',
                'r.value = $set_0',
                'RETURN',
                'this,r,that'
            ].join('\n');

            expect(query).to.equal(expected);
            expect(params).to.deep.equal({ this_id: 1, that_id: 2, set_0: 'something' })
        });


        it('should combine match, merge, remove, set, on create set and on match set', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model, { id: 1 })
                .match('that', model, { id: 2 })
                .merge('this')
                    .relationship('TO', 'out', 'r')
                    .to('that')
                .set('r.value', 'something')
                .onCreateSet('r.another', 'something else')
                .onMatchSet('r.number', 10)
                .onMatchSet('r.boolean', true)
                .remove('this:Label', 'that:Label')
                .return('this', 'r', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest { id: $this_id })',
                '',
                'MATCH',
                '(that:QueryBuilderTest { id: $that_id })',
                '',
                'MERGE',
                '(this)-[r:`TO`]->(that)',
                '',
                'REMOVE',
                'this:Label, that:Label',
                'ON CREATE SET',
                'r.another = $set_1',
                'ON MATCH SET',
                'r.number = $set_2, r.boolean = $set_3',
                'SET',
                'r.value = $set_0',
                'RETURN',
                'this,r,that'
            ].join('\n');

            expect(query).to.equal(expected);
            expect(params).to.deep.equal({
                this_id: 1, 
                that_id: 2, 
                set_0: 'something',
                set_1: 'something else',
                set_2: 10,
                set_3: true,
            })
        });

        it('should accept an object of set values', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model, { id: 1 })
                .match('that', model, { id: 2 })
                .merge('this')
                    .relationship('TO', 'out', 'r')
                    .to('that')
                .set({
                    'r.value': 'something'
                })
                .onCreateSet({
                    'r.another': 'something else'
                })
                .onMatchSet({
                    'r.number': 10
                })
                .onMatchSet({
                    'r.boolean': true
                })
                .remove('this:Label', 'that:Label')
                .return('this', 'r', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest { id: $this_id })',
                '',
                'MATCH',
                '(that:QueryBuilderTest { id: $that_id })',
                '',
                'MERGE',
                '(this)-[r:`TO`]->(that)',
                '',
                'REMOVE',
                'this:Label, that:Label',
                'ON CREATE SET',
                'r.another = $set_1',
                'ON MATCH SET',
                'r.number = $set_2, r.boolean = $set_3',
                'SET',
                'r.value = $set_0',
                'RETURN',
                'this,r,that'
            ].join('\n');

            expect(query).to.equal(expected);
            expect(params).to.deep.equal({
                this_id: 1, 
                that_id: 2, 
                set_0: 'something',
                set_1: 'something else',
                set_2: 10,
                set_3: true,
            });
        });
        
        it('should accept raw values for set', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model, { id: 1 })
                .match('that', model, { id: 2 })
                .set('this:Label, that:OtherLabel')
                .return('this', 'that')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest { id: $this_id })',
                '',
                'MATCH',
                '(that:QueryBuilderTest { id: $that_id })',
                '',
                'SET',
                'this:Label, that:OtherLabel',
                'RETURN',
                'this,that'
            ].join('\n');

            expect(query).to.equal(expected);
            expect(params).to.deep.equal({
                this_id: 1, 
                that_id: 2, 
            });
        });

        it('should accept a mutation for SET', () => {
            const builder = new Builder();

            const { query, params } = builder
                .match('this', model, {id: 1})
                .set('this', {foo: "bar"}, '+=')
                .return('this')
                .build();

            const expected = [
                'MATCH',
                '(this:QueryBuilderTest { id: $this_id })',
                '',
                'SET',
                'this += $set_0',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
            expect(params).to.deep.equal({
                this_id: 1, 
                set_0: {foo: "bar"},
            });
        });
        
        it('should accept a mutation for onCreateSet, onMatchSet', () => {
            const builder = new Builder();

            const { query, params } = builder
                .merge('this', model, {id: 1})
                .onCreateSet('this', {foo: "bar"}, '+=')
                .onMatchSet('this', {foo: "baz"}, '+=')
                .return('this')
                .build();

            const expected = [
                'MERGE',
                '(this:QueryBuilderTest { id: $this_id })',
                '',
                'ON CREATE SET',
                'this += $set_0',
                'ON MATCH SET',
                'this += $set_1',
                'RETURN',
                'this'
            ].join('\n');

            expect(query).to.equal(expected);
            expect(params).to.deep.equal({
                this_id: 1, 
                set_0: {foo: "bar"},
                set_1: {foo: "baz"},
            });
        });

    });

    describe('::execute', () => {
        it('should execute a query in read mode by default', done => {
            (new Builder(instance))
                .match('n')
                .return('count(n) as count')
                .execute()
                .then(res => {
                    expect(res.records).to.be.an('array');
                    expect(res.records.length).to.equal(1);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should execute a query in write mode', done => {
            (new Builder(instance))
                .match('n')
                .return('count(n) as count')
                .execute(mode.READ)
                .then(res => {
                    expect(res.records).to.be.an('array');
                    expect(res.records.length).to.equal(1);
                })
                .then(() => done())
                .catch(e => done(e));
        });

        it('should execute a query in write mode', done => {
            (new Builder(instance))
                .match('n')
                .return('count(n) as count')
                .execute(mode.WRITE)
                .then(res => {
                    expect(res.records).to.be.an('array');
                    expect(res.records.length).to.equal(1);
                })
                .then(() => done())
                .catch(e => done(e));
        });
    });

    describe('WhereStatement', done => {
        it('should use a specific connector', () => {
            const statement = new WhereStatement();
            statement.setConnector('OR')

            expect(statement._connector).to.equal('OR');
        });
    });

});