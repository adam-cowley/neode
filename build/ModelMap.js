'use strict';

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Model = require('./Model');

var _Model2 = _interopRequireDefault(_Model);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var ModelMap = function () {

    /**
     * @constuctor
     *
     * @param {Neode} neode
     */
    function ModelMap(neode) {
        _classCallCheck(this, ModelMap);

        this._neode = neode;
        this.models = new Map();
    }

    /**
     * Check if a model has been defined
     *
     * @param  {String} key
     * @return {bool}
     */


    _createClass(ModelMap, [{
        key: 'has',
        value: function has(key) {
            return this.models.has(key);
        }

        /**
         * Namesof the models defined.
         *
         * @return {Array<String>}
         */

    }, {
        key: 'keys',
        value: function keys() {
            return [].concat(_toConsumableArray(this.models.keys()));
        }

        /**
         * Getter
         *
         * @param  {String}
         * @return {Model|false}
         */

    }, {
        key: 'get',
        value: function get(key) {
            return this.models.get(key);
        }

        /**
         * Setter
         *
         * @param  {String} key
         * @param  {Model}  value
         * @return {ModelMap}
         */

    }, {
        key: 'set',
        value: function set(key, value) {
            this.models.set(key, value);

            return this;
        }

        /**
         * Run a forEach function on the models
         *
         * @param  {Function}
         * @return {void}
         */

    }, {
        key: 'forEach',
        value: function forEach(fn) {
            return this.models.forEach(fn);
        }

        /**
         * Get the definition for an array labels
         *
         * @param  {Array} labels
         * @return {Definition}
         */

    }, {
        key: 'getByLabels',
        value: function getByLabels(labels) {
            if (!Array.isArray(labels)) {
                labels = [labels];
            }

            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = this.models[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var entry = _step.value;

                    var _entry = _slicedToArray(entry, 2),
                        name = _entry[0],
                        definition = _entry[1]; // eslint-disable-line no-unused-vars

                    if (definition.labels().sort().join(':') == labels.sort().join(':')) {
                        return definition;
                    }
                }
            } catch (err) {
                _didIteratorError = true;
                _iteratorError = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion && _iterator.return) {
                        _iterator.return();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            return false;
        }

        /**
         * Extend a model with extra configuration
         *
         * @param  {String} name   Original Model to clone
         * @param  {String} as     New Model name
         * @param  {Object} using  Schema changes
         * @return {Model}
         */

    }, {
        key: 'extend',
        value: function extend(name, as, using) {
            // Get Original Model
            var original = this.models.get(name);

            // Add new Labels
            var labels = original.labels().slice(0);
            labels.push(as);
            labels.sort();

            // Merge Schema
            var schema = Object.assign({}, original.schema(), using);

            // Create and set
            var model = new _Model2.default(this._neode, as, schema);

            model.setLabels.apply(model, _toConsumableArray(labels));

            this.models.set(as, model);

            return model;
        }
    }]);

    return ModelMap;
}();

exports.default = ModelMap;