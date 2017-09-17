import Builder from '../Query/Builder';
import { eager } from '../Factory';

export default function Find(neode, model, key, value) {
    const alias = 'this';
    const output = [alias];

    const builder = new Builder(neode);

    builder.match(alias, model);

    if (typeof key == 'object') {
        Object.keys(key).map(property => {
            builder.where(`${alias}.${property}`, key[ property ]);
        });
    }
    else {
        builder.where(`${alias}.${key}`, value);
    }

    // Load Eager Relationships
    model.eager().forEach(relationship => {
        const key = `${eager}${relationship.type()}`;

        builder.optionalMatch(alias)
            .relationship(relationship.relationship(), relationship.direction())
            .to(key, relationship.target());

        output.push(`COLLECT(${key}) as ${key}`);
    });

    return builder.return(output)
        .limit(1)
        .execute()
        .then(res => neode.hydrateFirst(res, alias, model));


/*
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



    // Complete Query
    builder.orderBy(order)
        .skip(skip)
        .limit(limit)
        .return(...output);

    return builder.execute()
        .then(res => neode.hydrate(res, alias));
    */
}