import Builder from '../Query/Builder';
import { eager } from '../Factory';

export default function FindAll(neode, model, properties, order, limit, skip) {
    const alias = 'this';
    const output = [alias];

    // Prefix key on Properties
    if (properties) {
        Object.keys(properties).forEach(key => {
            properties[ `${alias}.${key}` ] = properties[ key ];

            delete properties[ key ];
        });
    }

    // Prefix key on Order
    if (typeof order == 'string') {
        order = `${alias}.${order}`;
    }
    else if (typeof order == 'object') {
        Object.keys(order).forEach(key => {
            order[ `${alias}.${key}` ] = order[ key ];

            delete order[ key ];
        });
    }

    const builder = new Builder(neode);

    // Match
    builder.match(alias, model)
        .where(properties);

    // Load Eager Relationships
    model.eager().forEach(relationship => {
        const key = `${eager}${relationship.type()}`;

        builder.optionalMatch(alias)
            .relationship(relationship.relationship(), relationship.direction())
            .to(key, relationship.target())

        output.push(`COLLECT(${key}) as ${key}`);
    })

    // Complete Query
    builder.orderBy(order)
        .skip(skip)
        .limit(limit)
        .return(...output);

    return builder.execute()
        .then(res => neode.hydrate(res, alias));
}