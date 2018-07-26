export const ERROR_VALIDATION = 'ERROR_VALIDATION';

export default class ValidationError extends Error {
    constructor(details, input) {
        super(ERROR_VALIDATION, 422);

        this.details = details;
        this.input = input;
    }
}