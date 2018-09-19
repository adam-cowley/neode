'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/**
 *  Container holding information for a property.
 * 
 * TODO: Schema validation to enforce correct data types
 */
var Property = function () {
    function Property(name, schema) {
        var _this = this;

        _classCallCheck(this, Property);

        if (typeof schema == 'string') {
            schema = { type: schema };
        }

        this._name = name;
        this._schema = schema;

        // TODO: Clean Up
        Object.keys(schema).forEach(function (key) {
            _this['_' + key] = schema[key];
        });
    }

    _createClass(Property, [{
        key: 'name',
        value: function name() {
            return this._name;
        }
    }, {
        key: 'type',
        value: function type() {
            return this._schema.type;
        }
    }, {
        key: 'primary',
        value: function primary() {
            return this._primary || false;
        }
    }, {
        key: 'unique',
        value: function unique() {
            return this._unique || false;
        }
    }, {
        key: 'exists',
        value: function exists() {
            return this._exists || false;
        }
    }, {
        key: 'required',
        value: function required() {
            return this._exists || this._required || false;
        }
    }, {
        key: 'indexed',
        value: function indexed() {
            return this._index || false;
        }
    }, {
        key: 'protected',
        value: function _protected() {
            return this._primary || this._protected;
        }
    }, {
        key: 'hidden',
        value: function hidden() {
            return this._hidden;
        }
    }, {
        key: 'readonly',
        value: function readonly() {
            return this._readonly || false;
        }
    }, {
        key: 'convertToInteger',
        value: function convertToInteger() {
            return this._type == 'int' || this._type == 'integer';
        }
    }]);

    return Property;
}();

exports.default = Property;