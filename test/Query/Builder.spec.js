import {assert, expect} from 'chai';
import Builder from '../../src/Query/Builder';

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
        const expected_params = {where_id_this: 1};

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

        const expected_params = {where_id_this: 1, where_id_that: 2};

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

        const expected_params = {where_id_this: 1, where_id_that: 2};

        expect(query).to.equal(expected);
        expect(params).to.deep.equal(expected_params);
    });

});