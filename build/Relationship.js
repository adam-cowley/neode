"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Relationship = function () {

    /**
     * Constructor
     *
     * @param  {Neode}            neode         Neode Instance
     * @param  {RelationshipType} type          Relationship Type definition
     * @param  {Relationship}     relationship  Neo4j Relationship
     * @param  {Node}             from          Start node for the relationship
     * @param  {Node}             to            End node for the relationship
     * @return {Relationship}
     */
    function Relationship(neode, type, relationship, from, to) {
        _classCallCheck(this, Relationship);

        this._neode = neode;
        this._type = type;
        this._relationship = relationship;
        this._from = from;
        this._to = to;
        this._type = type;

        this._deleted = false;
    }

    /**
     * Relationship Type definition for this node
     *
     * @return {Model}
     */


    _createClass(Relationship, [{
        key: "type",
        value: function type() {
            return this._type;
        }

        /**
         * Get Internal Relationship ID
         *
         * @return {int}
         */

    }, {
        key: "id",
        value: function id() {
            return this._relationship.identity.toNumber();
        }

        /**
         * Return Internal Relationship ID as Neo4j Integer
         *
         * @return {Integer}
         */

    }, {
        key: "idInt",
        value: function idInt() {
            return this._relationship.identity;
        }

        /**
         * Get Properties for this Relationship
         *
         * @return {Object}
         */

    }, {
        key: "properties",
        value: function properties() {
            return this._relationship.properties;
        }

        /**
         * Get a property for this node
         *
         * @param  {String} property Name of property
         * @param  {or}     default  Default value to supply if none exists
         * @return {mixed}
         */

    }, {
        key: "get",
        value: function get(property) {
            var or = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;

            return this._relationship.properties[property] || or;
        }

        /**
         * Get originating node for this relationship
         *
         * @return Node
         */

    }, {
        key: "from",
        value: function from() {
            return this._from;
        }

        /**
         * Get destination node for this relationship
         *
         * @return Node
         */

    }, {
        key: "to",
        value: function to() {
            return this._to;
        }
    }]);

    return Relationship;
}();

exports.default = Relationship;