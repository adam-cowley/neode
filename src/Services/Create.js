import GenerateDefaultValues from './GenerateDefaultValues';
import Node from '../Node';
import Validator from './Validator';
import { DIRECTION_IN, DIRECTION_OUT } from '../RelationshipType';
import Builder, {mode} from '../Query/Builder';
import { eagerNode, } from '../Query/EagerUtils';
import { v1 as neo4j } from 'neo4j-driver';
import { valueToCypher } from '../Entity';

const MAX_CREATE_DEPTH = 99;
const ORIGINAL_ALIAS = 'this';

/**
 * Add a node to the current statement
 * 
 * @param {Neode}   neode       Neode instance
 * @param {Builder} builder     Query builder
 * @param {String}  alias       Alias
 * @param {Model}   model       Model
 * @param {Object}  properties  Map of properties
 * @param {Array}   aliases         Aliases to carry through in with statement
 */
function addNodeToStatement(neode, builder, alias, model, properties, aliases = []) {
    // Inline Properties
    const inline_properties = {};

    // Calculate Set Properties
    model.properties().forEach(property => {
        const name = property.name();

        if ( properties.hasOwnProperty(name) ) {
            const value = valueToCypher( property, properties[ name ] );

            inline_properties[ name ] = value;
        }
    });

    if ( aliases.indexOf(alias) == -1 ) {
        aliases.push(alias);
    }

    // Create
    builder.create(alias, model, inline_properties);

    // Relationships
    model.relationships().forEach((relationship, key, map) => {
        if ( properties.hasOwnProperty(key) ) {
            let value = properties[ key ];

            const rel_alias = `${alias}_${key}_rel`;
            const target_alias = `${alias}_${key}_node`;

            // Carry alias through
            builder.with(...aliases);

            switch ( relationship.type() ) {
                // Single Relationship
                case 'relationship':
                    addRelationshipToStatement(neode, builder, alias, rel_alias, target_alias, relationship, value, aliases);
                    break;

                // Array of Relationships
                case 'relationships':
                    if ( !Array.isArray(value) ) value = [ value ];

                    value.forEach((value, idx) => {
                        // Carry alias through
                        addRelationshipToStatement(neode, builder, alias, rel_alias + idx, target_alias + idx, relationship, value, aliases);
                    });

                    break;

                // Single Node
                case 'node':
                    addNodeRelationshipToStatement(neode, builder, alias, rel_alias, target_alias, relationship, value, aliases);
                    break;

                // Array of Nodes
                case 'nodes':
                    if ( !Array.isArray(value) ) value = [ value ];

                    value.forEach((value, idx) => {
                        addNodeRelationshipToStatement(neode, builder, alias, rel_alias + idx, target_alias + idx, relationship, value, aliases);
                    });

                    break;
            }
        }
    });


    return builder;
}

/**
 * Add a relationship to the current statement
 * 
 * @param {Neode}           neode           Neode instance
 * @param {Builder}         builder         Query builder
 * @param {String}          alias           Current node alias
 * @param {String}          rel_alias       Generated alias for the relationship
 * @param {String}          target_alias    Generated alias for the relationship
 * @param {Relationship}    relationship    Model
 * @param {Object}          value           Value map
 * @param {Array}           aliases         Aliases to carry through in with statement
 */
function addRelationshipToStatement(neode, builder, alias, rel_alias, target_alias, relationship, value, aliases) {
    if ( aliases.length > MAX_CREATE_DEPTH ) {
        return;
    }

    // Extract Node
    const node_alias = relationship.nodeAlias();
    let node_value = value[ node_alias ];

    delete value[ node_alias ];

    // Create Node

    // If Node is passed, attempt to create a relationship to that specific node
    if ( node_value instanceof Node ) {
        builder.match(target_alias)
            .whereId(target_alias, node_value.identity())
    }

    // If Primary key is passed then try to match on that
    else if ( typeof node_value == 'string' || typeof node_value == 'number' ) {
        const model = neode.model( relationship.target() );

        builder.merge(target_alias, model, {
            [ model.primaryKey() ]: node_value
        });
    }

    // If Map is passed, attempt to create that node and then relate
    else if ( Object.keys(node_value).length ) {
        const model = neode.model( relationship.target() );
        node_value = GenerateDefaultValues.async(neode, model, node_value);

        addNodeToStatement(neode, builder, target_alias, model, node_value, aliases);
    }

    // Create the Relationship
    builder.create(alias)
        .relationship( relationship.relationship(), relationship.direction(), rel_alias )
        .to(target_alias)

    // Set Relationship Properties
    relationship.properties().forEach(property => {
        const name = property.name();

        if ( value.hasOwnProperty( property.name() ) ) {
            builder.set(`${rel_alias}.${property.name()}`, value[ property.name() ] );
        }
    });
}

/**
 * Add a node relationship to the current statement
 * 
 * @param {Neode}           neode           Neode instance
 * @param {Builder}         builder         Query builder
 * @param {String}          alias           Current node alias
 * @param {String}          rel_alias       Generated alias for the relationship
 * @param {String}          target_alias    Generated alias for the relationship
 * @param {Relationship}    relationship    Model
 * @param {Object}          value           Value map
 * @param {Array}           aliases         Aliases to carry through in with statement
 */
function addNodeRelationshipToStatement(neode, builder, alias, rel_alias, target_alias, relationship, value, aliases) {
    if ( aliases.length > MAX_CREATE_DEPTH ) {
        return;
    }

    // If Node is passed, attempt to create a relationship to that specific node
    if ( value instanceof Node ) {
        builder.match(target_alias)
            .whereId(target_alias, value.identity())
    }
    // If Primary key is passed then try to match on that
    else if ( typeof value == 'string' || typeof value == 'number' ) {
        const model = neode.model( relationship.target() );

        builder.merge(target_alias, model, {
            [ model.primaryKey() ]: value
        });
    }
    // If Map is passed, attempt to create that node and then relate
    // TODO: What happens when we need to validate this?
    else if ( Object.keys(value).length ) {
        const model = neode.model( relationship.target() );
        value = GenerateDefaultValues.async(neode, model, value);

        addNodeToStatement(neode, builder, target_alias, model, value, aliases);
    }
    
    // Create the Relationship
    builder.create(alias)
        .relationship( relationship.relationship(), relationship.direction(), rel_alias )
        .to(target_alias);
}

export default function Create(neode, model, properties) {
    return GenerateDefaultValues(neode, model, properties)
        .then(properties => Validator(neode, model, properties))
        .then(properties => {
            const alias = ORIGINAL_ALIAS;

            const builder = new Builder(neode);

            addNodeToStatement(neode, builder, alias, model, properties, [ alias ]);

            // Output
            const output = eagerNode(neode, 1, alias, model);

            return builder.return(output)
                .execute(mode.WRITE)
                .then(res => neode.hydrateFirst(res, alias));

        })
}
