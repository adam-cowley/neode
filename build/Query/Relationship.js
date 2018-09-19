'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _RelationshipType = require('../RelationshipType');

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Relationship = function () {
    function Relationship(relationship, direction, alias, traversals) {
        _classCallCheck(this, Relationship);

        this._relationship = relationship;
        this._direction = direction ? direction.toUpperCase() : '';
        this._alias = alias;
        this._traversals = traversals;
    }

    _createClass(Relationship, [{
        key: 'toString',
        value: function toString() {
            var dir_in = this._direction == _RelationshipType.DIRECTION_IN || this._direction == _RelationshipType.ALT_DIRECTION_IN ? '<' : '';
            var dir_out = this._direction == _RelationshipType.DIRECTION_OUT || this._direction == _RelationshipType.ALT_DIRECTION_OUT ? '>' : '';
            var alias = this._alias ? '' + this._alias : '';

            var relationship = this._relationship || '';

            if (Array.isArray(relationship)) {
                relationship = relationship.join('`|`');
            }

            if (relationship != '') {
                relationship = ':`' + relationship + '`';
            }

            var traversals = this._traversals ? '*' + this._traversals : '';

            var rel = this._relationship || this._alias || this._traversals ? '[' + alias + relationship + traversals + ']' : '';

            return dir_in + '-' + rel + '-' + dir_out;
        }
    }]);

    return Relationship;
}();

exports.default = Relationship;