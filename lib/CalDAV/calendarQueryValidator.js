/*
 * @package jsDAV
 * @subpackage CalDAV
 * @copyright Copyright(c) 2013 Mike de Boer. <info AT mikedeboer DOT nl>
 * @author Oleg Elifantiev <oleg@elifantiev.ru>
 * @license http://github.com/mikedeboer/jsDAV/blob/master/LICENSE MIT License
 */


'use strict';

var Base = require('./../shared/base');
var Exc = require("./../shared/exceptions");
var Util = require("./../shared/util");
var jsVObject_Node = require('./../VObject/node');

/**
 *
 * @param {Function} continuator
 * @returns {Function}
 */
function mkCommonValidator(continuator) {

    return function(component, filter) {
        /**
         *  The CALDAV:prop-filter XML element is empty and a property of
         * the type specified by the "name" attribute exists in the
         * enclosing calendar component;
         *
         * or:
         *
         *  The CALDAV:prop-filter XML element contains a CALDAV:is-not-
         * defined XML element and no property of the type specified by
         * the "name" attribute exists in the enclosing calendar
         * component;
         */
        var result = this._checkChildPresence(component, filter);

        if (result.stop) {
            return result.result;
        }

        return continuator.call(this, result.children, filter);
    }
}


var jsDAV_CalendarQueryValidator = module.exports = Base.extend({

    /**
     * Verify if a list of filters applies to the calendar data object
     *
     * The list of filters must be formatted as parsed by \Sabre\CalDAV\CalendarQueryParser
     *
     * @param {jsVObject_Component} vObject
     * @param {Array} filter
     * @return bool
     */
    validate: function (vObject, filter) {

        /**
         * Definition:
         *   <!ELEMENT filter (comp-filter)>
         */
        if (filter) {

            if (vObject.name == filter.name) {
                return this._validateFilterSet(vObject, filter['comp-filters'], this._validateCompFilter) &&
                       this._validateFilterSet(vObject, filter['prop-filters'], this._validatePropFilter);
            } else {
                return false;
            }


        } else {
            return true;
        }


    },

    _validateFilterSet: function(vObject, filters, validator) {

        var i, l, filter;

        for(i = 0, l = filters.length; i < l; i++) {
            filter = filters[i];

            if (!validator.call(this, vObject, filter)) {
                return false;
            }
        }

        return true;

    },

    _anyChildMatches: function(children, filter, validator) {

        var child, i, l;

        for(i = 0, l = children.length; i < l; i++) {

            child = children[i];

            if (validator.call(this, child, filter)) {
                return true;
            }

        }

        return false;
    },

    _allChildMatches: function(children, validator, filter) {

        var child, i, l;

        for(i = 0, l = children.length; i < l; i++) {

            child = children[i];

            if (!validator.call(this, child, filter)) {
                return false;
            }

        }

        return true;
    },

    _checkChildPresence: function(vObject, filter) {
        var
            componentName = filter.name,
            isChildPresent = vObject.isset(componentName),
            negateChildPresence = filter['is-not-defined'],
            children = isChildPresent && vObject.select(componentName);

        return {
            children: children,
            stop: !(isChildPresent && !negateChildPresence),
            result: isChildPresent ^ negateChildPresence
        };
    },

    _validateTimeRangeOnComponent: function(component, timeRangeFilter) {

        if (timeRangeFilter) {

            if (!this._anyChildMatches(component.getChildren(), timeRangeFilter, this._validateTimeRange)) {
                return false;
            }

        }

        return true;
    },

    _validateCompFilter: mkCommonValidator(function(children, filter) {

        var node = children[0];

        if (!this._validateTimeRangeOnComponent(children[0], filter['time-range'])) {
            return false;
        }

        return this._validateFilterSet(node, filter['comp-filters'], this._validateCompFilter) &&
            this._validateFilterSet(node, filter['prop-filters'], this._validatePropFilter);

    }),

    _validatePropFilter: mkCommonValidator(function(children, filter) {

        return this._anyChildMatches(children, filter, function(child, filter){

            if (!this._validateTimeRange(child, filter['time-range'])) {
                return false;
            }

            if (!this._validateTextMatch(child, filter['text-match'])) {
                return false;
            }

            return this._validateFilterSet(child, filter['param-filters'], this._validateParamFilter);
        });

    }),

    _validateParamFilter: mkCommonValidator(function(children, filter) {

        return this._validateTextMatch(children[0], filter['text-match']);

    }),

    /**
     * This method checks the validity of a text-match.
     *
     * A single text-match should be specified as well as the specific property
     * or parameter we need to validate.
     *
     * @param {jsVObject_Node|String} component Value to check against.
     * @param {Object} textMatch
     * @return bool
     */
    _validateTextMatch: function (component, textMatch) {

        if (component.hasFeature && component.hasFeature(jsVObject_Node)) {
            component = component.getValue();
        }

        var isMatching = Util.textMatch(component, textMatch.value, textMatch['match-type']);

        return (textMatch['negate-condition'] ^ isMatching);

    },

    /**
     * Validates if a component matches the given time range.
     *
     * This is all based on the rules specified in rfc4791, which are quite
     * complex.
     *
     * @param {jsVObject_Node} component
     * @param {Object} [filter]
     * @param {Date} [filter.start]
     * @param {Date} [filter.end]
     * @return bool
     */
    _validateTimeRange: function (component, filter) {

        if (!filter) {
            return true;
        }


        var start = filter.start, end = filter.end;

        if (!start) {
            start = new Date(1900, 1, 1);
        }
        if (!end) {
            end = new Date(3000, 1, 1);
        }

        switch (component.name) {

            case 'VEVENT' :
            case 'VTODO' :
            case 'VJOURNAL' :

                return component.isInTimeRange(start, end);

            case 'VALARM' :
                // It actually does not make too much sense to check alarms.
                // It caused a bug before because there was a just a big comment without any return nor break statement.
                // As a result, it returns the same as VFREEBUSY case.
                return false;
                
            case 'VFREEBUSY' :
                 throw Exc.NotImplemented('time-range filters are currently not supported on ' + component.name + ' components');

            case 'COMPLETED' :
            case 'CREATED' :
            case 'DTEND' :
            case 'DTSTAMP' :
            case 'DTSTART' :
            case 'DUE' :
            case 'LAST-MODIFIED' :
                return (start <= component.getDateTime() && end >= component.getDateTime());

            default :
                throw Exc.BadRequest('You cannot create a time-range filter on a ' + component.name + ' component');

        }

    }

});
