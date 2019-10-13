import {assert, expect} from 'chai';
import { eagerNode, eagerRelationship, eagerPattern, } from '../../src/Query/EagerUtils';

describe('Query/EagerUtils.js', () => {
    const instance = require('../instance')();
    const model = instance.model('EagerUtilTest', {
        name: 'string',
        number: 'number',
        directorRel: {
            type: 'relationship',
            relationship: 'DIRECTED',
            direction: 'in',
            target: 'Person',
            alias: 'director',

            eager: true,

            properties: {
                salary: 'float',
            },
        },
        actorRels: {
            type: 'relationships',
            relationship: 'ACTED_IN',
            direction: 'in',
            target: 'Person',
            alias: 'actor',

            eager: true,
        },
        directorNode: {
            type: 'node',
            relationship: 'DIRECTED',
            direction: 'in',
            target: 'Person',

            eager: true,
        },
        actorNodes: {
            type: 'nodes',
            relationship: 'ACTED_IN',
            direction: 'in',
            target: 'Person',

            eager: true,
        },
        nonEager: {
            type: 'nodes',
            relationship: 'SHOULD_BE_IGNORED',
            direction: 'in',
            target: 'Person',

        },
    });

    instance.model('Movie', {
        title: 'string',
    });

    instance.model('Person', {
        name: 'string',
        movies: {
            type: 'nodes',
            relationship: 'ACTED_IN',
            direction: 'out',
            target: 'Movie',
            alias: 'movie',

            eager: true,
        },
    });

    after(done => {
        instance.close();
        done();
    });

    describe('eagerPattern', () => {
        it('should build a pattern for `node` and append [0]', () => {
            const rel = model.relationship('directorNode');
            const output = eagerPattern(instance, 1, 'this', rel).replace(/\n/g, '').replace(/\s\s/g, '');
            const expected = 'directorNode: [ (this)<-[this_directorNode_rel:`DIRECTED`]-(this_directorNode_node:Person) |this_directorNode_node { .*,__EAGER_ID__: id(this_directorNode_node),__EAGER_LABELS__: labels(this_directorNode_node)';

            expect(output.indexOf(expected)).to.equal(0);
            expect(output.substr(-3)).to.equal('[0]');
        });

        it('should build a pattern for `nodes`', () => {
            const rel = model.relationship('actorNodes');
            const output = eagerPattern(instance, 1, 'this', rel).replace(/\n/g, '').replace(/\s\s/g, '');
            const expected = 'actorNodes: [ (this)<-[this_actorNodes_rel:`ACTED_IN`]-(this_actorNodes_node:Person) |this_actorNodes_node { .*,__EAGER_ID__: id(this_actorNodes_node),__EAGER_LABELS__: labels(this_actorNodes_node)';

            expect(output.indexOf(expected)).to.equal(0);
        });

        it('should build a pattern for `relationship` and append [0]', () => {
            const rel = model.relationship('directorRel');
            const output = eagerPattern(instance, 1, 'this', rel).replace(/\n/g, '').replace(/\s\s/g, '');
            const expected = 'directorRel: [ (this)<-[this_directorRel_rel:`DIRECTED`]-(this_directorRel_node:Person) |this_directorRel_rel { .*,__EAGER_ID__: id(this_directorRel_rel),__EAGER_TYPE__: type(this_directorRel_rel),director:this_directorRel_node { .*,__EAGER_ID__: id(this_directorRel_node),__EAGER_LABELS__: labels(this_directorRel_node),movies: [ (this_directorRel_node)-[this_directorRel_node_movies_rel:`ACTED_IN`]->(this_directorRel_node_movies_node:Movie) |this_directorRel_node_movies_node { .*,__EAGER_ID__: id(this_directorRel_node_movies_node),__EAGER_LABELS__: labels(this_directorRel_node_movies_node)} ]}} ][0]';

            expect(output).to.equal(expected);
        });

        it('should build a pattern for `relationships`', () => {
            const rel = model.relationship('actorRels');
            const output = eagerPattern(instance, 1, 'this', rel).replace(/\n/g, '').replace(/\s\s/g, '');

            const expected = 'actorRels: [ (this)<-[this_actorRels_rel:`ACTED_IN`]-(this_actorRels_node:Person) |this_actorRels_rel { .*,__EAGER_ID__: id(this_actorRels_rel),__EAGER_TYPE__: type(this_actorRels_rel),actor:this_actorRels_node { .*,__EAGER_ID__: id(this_actorRels_node),__EAGER_LABELS__: labels(this_actorRels_node),movies: [ (this_actorRels_node)-[this_actorRels_node_movies_rel:`ACTED_IN`]->(this_actorRels_node_movies_node:Movie) |this_actorRels_node_movies_node { .*,__EAGER_ID__: id(this_actorRels_node_movies_node),__EAGER_LABELS__: labels(this_actorRels_node_movies_node)} ]}} ]';

            expect(output).to.equal(expected);
        });
    });

    describe('eagerNode', () => {
        const pattern = eagerNode(instance, 1, 'this', model).replace(/\n/g, ' ').replace(/\s{2,}/g, '');

        it('should request properties and ids for a node', () => {
            const props = `this {.*,__EAGER_ID__: id(this),__EAGER_LABELS__: labels(this)`;

            expect( pattern.indexOf(props) > -1 ).to.equal(true);
        });

        it('should request an eager `node`', () => {
            const props = 'directorNode: [ (this)<-[this_directorNode_rel:`DIRECTED`]-(this_directorNode_node:Person) |this_directorNode_node {.*,__EAGER_ID__: id(this_directorNode_node),__EAGER_LABELS__: labels(this_directorNode_node)';
            expect( pattern.indexOf(props) > -1 ).to.equal(true);
        });

        it('should request a nested eager statement', () => {
            const props = 'movies: [ (this_directorRel_node)-[this_directorRel_node_movies_rel:`ACTED_IN`]->(this_directorRel_node_movies_node:Movie) |this_directorRel_node_movies_node {.*,__EAGER_ID__: id(this_directorRel_node_movies_node),__EAGER_LABELS__: labels(this_directorRel_node_movies_node)} ]}} ]';
            expect( pattern.indexOf(props) > -1 ).to.equal(true);
        });


        it('should request eager `nodes`', () => {
            const props = 'actorNodes: [ (this)<-[this_actorNodes_rel:`ACTED_IN`]-(this_actorNodes_node:Person) |this_actorNodes_node {.*,__EAGER_ID__: id(this_actorNodes_node),__EAGER_LABELS__: labels(this_actorNodes_node)';
            expect( pattern.indexOf(props) > -1 ).to.equal(true);
        });

        it('should request an eager `relationship`', () => {
            const props = 'directorRel: [ (this)<-[this_directorRel_rel:`DIRECTED`]-(this_directorRel_node:Person) |this_directorRel_rel {.*,__EAGER_ID__: id(this_directorRel_rel),__EAGER_TYPE__: type(this_directorRel_rel)';
            const director_props = 'director:this_directorRel_node {.*,__EAGER_ID__: id(this_directorRel_node),__EAGER_LABELS__: labels(this_directorRel_node)';

            expect( pattern.indexOf(props) > -1 ).to.equal(true);
            expect( pattern.indexOf(director_props) > -1 ).to.equal(true);
        });

        it('should request eager `relationships`', () => {
            const props = 'actorRels: [ (this)<-[this_actorRels_rel:`ACTED_IN`]-(this_actorRels_node:Person) |this_actorRels_rel {.*,__EAGER_ID__: id(this_actorRels_rel),__EAGER_TYPE__: type(this_actorRels_rel),actor:this_actorRels_node {.*,__EAGER_ID__: id(this_actorRels_node),__EAGER_LABELS__: labels(this_actorRels_node),movies: [ (this_actorRels_node)-[this_actorRels_node_movies_rel:`ACTED_IN`]->(this_actorRels_node_movies_node:Movie) |this_actorRels_node_movies_node {.*,__EAGER_ID__: id(this_actorRels_node_movies_node),__EAGER_LABELS__: labels(this_actorRels_node_movies_node)} ]}} ]';
            expect( pattern.indexOf(props) > -1 ).to.equal(true);
        });
    });

});