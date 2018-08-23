/*
import GenerateDefaultValues from './GenerateDefaultValues';
import Node from '../Node';
import Validator from './Validator';
import { DIRECTION_IN, DIRECTION_OUT } from '../RelationshipType';
import { eagerNode } from '../Query/EagerUtils';

const MAX_CREATE_DEPTH = 99;
const ORIGINAL_ALIAS = 'this';
*/
import GenerateDefaultValues from './GenerateDefaultValues';
import Validator from './Validator';
import Builder, { mode, } from '../Query/Builder';
import { eagerNode, } from '../Query/EagerUtils';
import { addNodeToStatement, ORIGINAL_ALIAS } from './WriteUtils';


export default function MergeOn(neode, model, merge_on, properties) {
    return GenerateDefaultValues(neode, model, properties)
        .then(properties => Validator(neode, model, properties))
        .then(properties => {
            const alias = ORIGINAL_ALIAS;

            const builder = new Builder(neode);

            addNodeToStatement(neode, builder, alias, model, properties, [ alias ], 'merge', merge_on);

            // Output
            const output = eagerNode(neode, 1, alias, model);

            return builder.return(output)
                .execute(mode.WRITE)
                .then(res => neode.hydrateFirst(res, alias));
        });
}