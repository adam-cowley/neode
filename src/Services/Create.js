import GenerateDefaultValues from './GenerateDefaultValues';
import Validator from './Validator';
import { DIRECTION_IN, DIRECTION_OUT } from '../RelationshipType';
import Builder, {mode} from '../Query/Builder';
import { eagerNode, } from '../Query/EagerUtils';
import { v1 as neo4j } from 'neo4j-driver';
import { addNodeToStatement, ORIGINAL_ALIAS } from './WriteUtils';

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
