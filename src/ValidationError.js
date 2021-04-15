export const ERROR_VALIDATION = 'ERROR_VALIDATION';

export default class ValidationError extends Error {
    constructor(details, input, _joiError) {
        super(ERROR_VALIDATION, 422);

        this.details = details;
        this.input = input;
        this._joiError = _joiError;
    }
}