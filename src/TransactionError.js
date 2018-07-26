export const ERROR_TRANSACTION_FAILED = 'ERROR_TRANSACTION_FAILED';

export default class TransactionError extends Error {
    constructor(errors) {
        super(ERROR_TRANSACTION_FAILED, 500);

        this.errors = errors;
    }
}