'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.valueToJson = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); /* eslint indent: 0 */


exports.valueToCypher = valueToCypher;

var _neo4jDriver = require('neo4j-driver');

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 * Convert a raw property into a JSON friendly format
 *
 * @param  {Property}   property
 * @param  {Mixed}      value
 * @return {Mixed}
 */
function _valueToJson(property, value) {
    if (_neo4jDriver.v1.isInt(value)) {
        return value.toNumber();
    } else if (_neo4jDriver.v1.temporal.isDate(value) || _neo4jDriver.v1.temporal.isDateTime(value) || _neo4jDriver.v1.temporal.isTime(value) || _neo4jDriver.v1.temporal.isLocalDateTime(value) || _neo4jDriver.v1.temporal.isLocalTime(value) || _neo4jDriver.v1.temporal.isDuration(value)) {
        return value.toString();
    } else if (_neo4jDriver.v1.spatial.isPoint(value)) {
        switch (value.srid.toString()) {
            // SRID values: @https://neo4j.com/docs/developer-manual/current/cypher/functions/spatial/
            case '4326':
                // WGS 84 2D
                return { longitude: value.x, latitude: value.y };

            case '4979':
                // WGS 84 3D
                return { longitude: value.x, latitude: value.y, height: value.z };

            case '7203':
                // Cartesian 2D
                return { x: value.x, y: value.y };

            case '9157':
                // Cartesian 3D
                return { x: value.x, y: value.y, z: value.z };
        }
    }

    return value;
}

/**
 * Convert a property into a cypher value
 *
 * @param {Property} property
 * @param {Mixed}    value
 * @return {Mixed}
 */
exports.valueToJson = _valueToJson;
function valueToCypher(property, value) {
    if (property.convertToInteger() && value !== null && value !== undefined) {
        value = _neo4jDriver.v1.int(value);
    }

    return value;
}

var Entity = function () {
    function Entity() {
        _classCallCheck(this, Entity);
    }

    _createClass(Entity, [{
        key: 'id',


        /**
         * Get Internal Node ID
         *
         * @return {int}
         */
        value: function id() {
            return this._identity.toNumber();
        }

        /**
         * Return internal ID as a Neo4j Integer
         *
         * @return {Integer}
         */

    }, {
        key: 'identity',
        value: function identity() {
            return this._identity;
        }

        /**
         * Return the Node's properties as an Object
         *
         * @return {Object}
         */

    }, {
        key: 'properties',
        value: function properties() {
            var _this = this;

            var output = {};

            var model = this._model || this._definition;

            model.properties().forEach(function (property, key) {
                if (!property.hidden() && _this._properties.has(key)) {
                    output[key] = _this.valueToJson(property, _this._properties.get(key));
                }
            });

            return output;
        }

        /**
         * Get a property for this node
         *
         * @param  {String} property Name of property
         * @param  {or}     default  Default value to supply if none exists
         * @return {mixed}
         */

    }, {
        key: 'get',
        value: function get(property) {
            var or = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

            // If property is set, return that
            if (this._properties.has(property)) {
                return this._properties.get(property);
            }
            // If property has been set in eager, return that
            else if (this._eager && this._eager.has(property)) {
                    return this._eager.get(property);
                }

            return or;
        }

        /**
         * Convert a raw property into a JSON friendly format
         *
         * @param  {Property}   property
         * @param  {Mixed}      value
         * @return {Mixed}
         */

    }, {
        key: 'valueToJson',
        value: function valueToJson(property, value) {
            return _valueToJson(property, value);
        }
    }]);

    return Entity;
}();

exports.default = Entity;