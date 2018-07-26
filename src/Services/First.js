import Builder, {mode} from '../Query/Builder';
import { eagerNode, } from '../Query/EagerUtils';

export default function First(neode, model, key, value) {
    const alias = 'this';

    const builder = new Builder(neode);

    // Match
    builder.match(alias, model);

    // Where
    if (typeof key == 'object') {
        // Process a map of properties
        Object.keys(key).forEach(property => {
            builder.where(`${alias}.${property}`, key[ property ]);
        });
    }
    else {
        // Straight key/value lookup
        builder.where(`${alias}.${key}`, value);
    }

    const output = eagerNode(neode, 1, alias, model);

    return builder.return(output)
        .limit(1)
        .execute(mode.READ)
        .then(res => neode.hydrateFirst(res, alias, model));
}