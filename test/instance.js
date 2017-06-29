import Neode from '../src/index';

require('dotenv').config();



const connection_string = `${process.env.NEO4J_PROTOCOL}://${process.env.NEO4J_HOST}`;
const username = process.env.NEO4J_USERNAME;
const password = process.env.NEO4J_PASSWORD;

module.exports = new Neode(connection_string, username, password);