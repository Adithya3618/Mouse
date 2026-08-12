// Generates the random "starting number" a participant counts backward
// from for a subtraction condition. A new number is drawn for each of the
// three conditions (3, 7, 17) and must differ from the immediately
// preceding condition's number.

export function generateStartingNumber({ min, max }, previousNumber = null) {
    if (max < min) {
        throw new RangeError('max must be greater than or equal to min');
    }
    if (min === max) {
        if (previousNumber === min) {
            throw new RangeError('Cannot generate a number different from the previous one when min === max.');
        }
        return min;
    }

    let candidate;
    do {
        candidate = Math.floor(Math.random() * (max - min + 1)) + min;
    } while (candidate === previousNumber);

    return candidate;
}
