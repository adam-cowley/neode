import {assert, expect} from 'chai';
import Builder from '../../src/Query/Builder';
import Integer from 'neo4j-driver/lib/v1/integer';
import RelationshipType from '../../src/RelationshipType';

describe('Query/Builder.js', () => {
    const instance = require('../instance');

    const label = 'QueryBuilderTest';

    const model = instance.model(label, {
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

    it('should return new query builder from Neode instance', () => {
        const query = instance.query();

        expect(query).to.be.an.instanceOf(Builder);
    });

    it('should build a match query on internal ID', () => {
        const builder = new Builder();

        const {query, params} = builder
            .match('this', model)
            .whereId('this', 1)
            .return('this')
            .build();

        const expected = [
            'MATCH',
            '(this:QueryBuilderTest)',
            'WHERE (id(this) = {where_id_this}) ',
            'RETURN',
            'this'
        ].join('\n');
        const expected_params = {where_id_this: new Integer(1)};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a double match query on internal IDs', () => {
        const builder = new Builder();

        const {query, params} = builder
            .match('this', model)
            .whereId('this', 1)
            .match('that', model)
            .whereId('that', 2)
            .return('this', 'that')
            .build();

        const expected = [
            'MATCH',
            '(this:QueryBuilderTest)',
            'WHERE (id(this) = {where_id_this}) ',
            'MATCH',
            '(that:QueryBuilderTest)',
            'WHERE (id(that) = {where_id_that}) ',
            'RETURN',
            'this,that'
        ].join('\n');

        const expected_params = {where_id_this: new Integer(1), where_id_that: new Integer(2)};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a query with a where clause', () => {
        const builder = new Builder();

        const {query, params} = builder
            .match('this', model)
            .where('this.property', 'that')
            .return('this')
            .build();

        const expected = [
            'MATCH',
            '(this:QueryBuilderTest)',
            'WHERE (this.property = {where_this_property}) ',
            'RETURN',
            'this'
        ].join('\n');
        const expected_params = {where_this_property: 'that'};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a query with two where clauses', () => {
        const builder = new Builder();

        const {query, params} = builder
            .match('this', model)
            .where('this.property', 'that')
            .where('this.other_property', 'not that')
            .return('this')
            .build();

        const expected = [
            'MATCH',
            '(this:QueryBuilderTest)',
            'WHERE (this.property = {where_this_property} AND this.other_property = {where_this_other_property}) ',
            'RETURN',
            'this'
        ].join('\n');
        const expected_params = {where_this_property: 'that', where_this_other_property: 'not that'};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build an `or` query', () => {
        const builder = new Builder();

        const {query, params} = builder
            .match('this', model)
            .where('this.property', 'that')
            .or('this.other_property', 'not that')
            .return('this')
            .build();

        const expected = [
            'MATCH',
            '(this:QueryBuilderTest)',
            'WHERE (this.property = {where_this_property}) OR (this.other_property = {where_this_other_property}) ',
            'RETURN',
            'this'
        ].join('\n');
        const expected_params = {where_this_property: 'that', where_this_other_property: 'not that'};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a query with skip and limit', () => {
        const builder = new Builder();

        const {query, params} = builder
            .match('this', model)
            .where('this.property', 'that')
            .return('this')
            .skip(1)
            .limit(1)
            .build();

        const expected = [
            'MATCH',
            '(this:QueryBuilderTest)',
            'WHERE (this.property = {where_this_property}) ',
            'RETURN',
            'this',
            'SKIP 1',
            'LIMIT 1'
        ].join('\n');
        const expected_params = {where_this_property: 'that'};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a query with a with statement', () => {
        const builder = new Builder();

        const {query, params} = builder
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
            'WHERE (id(this) = {where_id_this}) ',
            'WITH this',
            '',
            'MATCH',
            '(that:QueryBuilderTest)',
            'WHERE (id(that) = {where_id_that}) ',
            'RETURN',
            'this,that'
        ].join('\n');

        const expected_params = {where_id_this: new Integer(1), where_id_that: new Integer(2)};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a query with an order statement', () => {
        const builder = new Builder();

        const {query, params} = builder
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
            'WHERE (this.property = {where_this_property}) ',
            'RETURN',
            'this',
            'ORDER BY',
            'this.property ASC',
            'SKIP 20',
            'LIMIT 10'
        ].join('\n');
        const expected_params = {where_this_property: 'that'};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    })

    it('should build a query with multiple order statements', () => {
        const builder = new Builder();

        const {query, params} = builder
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
            'WHERE (this.property = {where_this_property}) ',
            'RETURN',
            'this',
            'ORDER BY',
            'this.property ASC,this.other DESC',
            'SKIP 20',
            'LIMIT 10'
        ].join('\n');
        const expected_params = {where_this_property: 'that'};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a query with an array of string order statements', () => {
        const builder = new Builder();

        const {query, params} = builder
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
            'WHERE (this.property = {where_this_property}) ',
            'RETURN',
            'this',
            'ORDER BY',
            'this.property,this.other',
            'SKIP 20',
            'LIMIT 10'
        ].join('\n');
        const expected_params = {where_this_property: 'that'};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a query with an order object', () => {
        const builder = new Builder();

        const {query, params} = builder
            .match('this', model)
            .where('this.property', 'that')
            .return('this')
            .orderBy({'this.property': 'DESC'})
            .skip(20)
            .limit(10)
            .build();

        const expected = [
            'MATCH',
            '(this:QueryBuilderTest)',
            'WHERE (this.property = {where_this_property}) ',
            'RETURN',
            'this',
            'ORDER BY',
            'this.property DESC',
            'SKIP 20',
            'LIMIT 10'
        ].join('\n');
        const expected_params = {where_this_property: 'that'};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a query with an array of order object', () => {
        const builder = new Builder();

        const {query, params} = builder
            .match('this', model)
            .where('this.property', 'that')
            .return('this')
            .orderBy([{field: 'this.property', order: 'ASC'}, {field: 'this.that', order: 'DESC'}])
            .skip(20)
            .limit(10)
            .build();

        const expected = [
            'MATCH',
            '(this:QueryBuilderTest)',
            'WHERE (this.property = {where_this_property}) ',
            'RETURN',
            'this',
            'ORDER BY',
            'this.property ASC,this.that DESC',
            'SKIP 20',
            'LIMIT 10'
        ].join('\n');
        const expected_params = {where_this_property: 'that'};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

    it('should build a query with a relationship type', () => {
        const builder = new Builder();

        const rel = new RelationshipType('test', 'REL_TO', 'OUT');

        const {query, params} = builder
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

    it('should build a query with an outwards relationship', () => {
        const builder = new Builder();

        const {query, params} = builder
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

        const {query, params} = builder
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

        const {query, params} = builder
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

    it('should build a query with an outwards relationship with alias but no type', () => {
        const builder = new Builder();

        const {query, params} = builder
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

    it('should build a query with an outwards relationship with alias and traversal', () => {
        const builder = new Builder();

        const {query, params} = builder
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

        const {query, params} = builder
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

    it('should build a delete query', () => {
        const builder = new Builder();

        const {query, params} = builder
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



});