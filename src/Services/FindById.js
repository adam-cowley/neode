import Builder, {mode} from '../Query/Builder';
import { eagerNode, } from '../Query/EagerUtils';

export default function FindById(neode, model, id) {
    const alias = 'this';

    const builder = new Builder(neode);

    return builder.match(alias, model)
        .whereId(alias, id)
        .return( eagerNode(neode, 1, alias, model) )
        .limit(1)
        .execute(mode.READ)
        .then(res => neode.hydrateFirst(res, alias, model));
}