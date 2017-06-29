import GenerateDefaultValues from './GenerateDefaultValues';
import Validator from './Validator';

export default function Create(neode, model, properties) {
    return GenerateDefaultValues(neode, model, properties)
        .then(properties => Validator(neode, model, properties))
        .then(properties => {
            // Check we have properties
            if (Object.keys(properties).length == 0) {
                throw new Error('There are no properties set for this Node');
            }

            const labels = model.labels().join(":");
            const query = `CREATE (node:${labels} {properties}) RETURN node`;

            return neode.cypher(query, {properties})
                .then(res => {
                    return res.records[0].get('node');
                });
        });
}