"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var NodeCollection = function () {
    function NodeCollection(neode, values) {
        _classCallCheck(this, NodeCollection);

        this._neode = neode;
        this._values = values;
    }

    _createClass(NodeCollection, [{
        key: "get",
        value: function get(index) {
            return this._values[index];
        }
    }, {
        key: "map",
        value: function map(fn) {
            return this._values.map(fn);
        }
    }, {
        key: "forEach",
        value: function forEach(fn) {
            return this._values.forEach(fn);
        }
    }, {
        key: "length",
        get: function get() {
            return this._values.length;
        }
    }]);

    return NodeCollection;
}();

exports.default = NodeCollection;